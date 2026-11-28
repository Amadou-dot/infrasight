import { createHash, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { ApiError } from '@/lib/errors/ApiError';
import type { DatasetScope } from './access';
import { ADMIT_BUDGET, USE_BUDGET } from './budget-scripts';
import { BUDGET_LIMITS } from './pricing';

type Settlement = { status: 'settled' | 'retained'; chargedMicrodollars: number };

export interface StoredBudget {
  begin(attempt: number): Promise<void>;
  cancelUnsubmitted(attempt: number): Promise<void>;
  record(attempt: number, chargeMicrodollars: number | null): Promise<void>;
  settle(): Promise<Settlement>;
}

const PREFIX = '{assistant-budget}';
const DAY_MS = 86_400_000;

function hash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 32);
}

function unavailable(): ApiError {
  return ApiError.serviceUnavailable('Assistant budget is unavailable');
}

async function utcPeriods(redis: Redis) {
  try {
    const [seconds] = await redis.time();
    if (!/^\d+$/.test(String(seconds))) throw unavailable();
    const date = new Date(Number(seconds) * 1000);
    const day = date.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const dayEnd = Date.parse(day + 'T00:00:00Z') + DAY_MS;
    const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    return { day, month, dayEnd, monthEnd };
  } catch {
    throw unavailable();
  }
}

async function evaluate(redis: Redis, script: string, keys: string[], args: (string | number)[]) {
  let result: unknown;
  try {
    result = await redis.eval(script, keys.length, ...keys, ...args);
  } catch {
    throw unavailable();
  }
  if (!Array.isArray(result)) throw unavailable();
  if (result.length === 1 && result[0] === 'duplicate')
    throw ApiError.conflict('Assistant request already admitted');
  if (result.length === 2 && result[0] === 'limit') {
    const retry = result[1];
    if (Number.isSafeInteger(retry) && retry > 0) throw ApiError.rateLimitExceeded(retry);
  }
  return result;
}

function confirm(reply: unknown[]) {
  if (reply.length !== 1 || reply[0] !== 'ok') throw unavailable();
}

function checkAttempt(attempt: number) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > BUDGET_LIMITS.maxAttempts)
    throw unavailable();
}

export async function admitBudget(
  redis: Redis,
  ctx: Pick<DatasetScope, 'userId' | 'orgId'>,
  requestId: string
): Promise<StoredBudget> {
  const user = hash(ctx.userId);
  const org = hash(ctx.orgId);
  const request = hash(requestId.toLowerCase());
  const owner = randomUUID();

  for (let lookup = 0; lookup < 2; lookup++) {
    const { day, month, dayEnd, monthEnd } = await utcPeriods(redis);
    const keys = [
      `${PREFIX}:request:${request}`,
      `${PREFIX}:day:${day}`,
      `${PREFIX}:month:${month}`,
      `${PREFIX}:requests:${day}:${user}`,
      `${PREFIX}:minute:${user}`,
      `${PREFIX}:user:${user}`,
      `${PREFIX}:org:${org}`,
    ];
    const args = [owner, dayEnd, monthEnd];
    // Retain this admission's original periods and private ownership token.
    const transition = (...operation: (string | number)[]) =>
      evaluate(redis, USE_BUDGET, keys, [...args, ...operation]);
    try {
      const reply = await evaluate(redis, ADMIT_BUDGET, keys, args);
      if (reply.length === 1 && reply[0] === 'rollover') continue;
      confirm(reply);
    } catch (error) {
      // Redis may have committed even though this caller never received a
      // lease. Make one owner-checked recovery attempt. If Redis is still
      // unavailable, its original reservation remains charged.
      if (error instanceof ApiError && error.statusCode === 503)
        await transition('cancel-unpublished').catch(() => undefined);

      throw error;
    }

    return {
      async begin(attempt) {
        checkAttempt(attempt);
        confirm(await transition('begin', attempt));
      },
      async cancelUnsubmitted(attempt) {
        checkAttempt(attempt);
        confirm(await transition('cancel-unsubmitted', attempt));
      },
      async record(attempt, chargeMicrodollars) {
        checkAttempt(attempt);
        if (chargeMicrodollars !== null && !Number.isSafeInteger(chargeMicrodollars)) {
          // Persist uncertainty even if an invalid receipt conflicts with a known one.
          confirm(await transition('record', attempt, 'invalid'));
          return;
        }
        confirm(await transition('record', attempt, chargeMicrodollars ?? 'unknown'));
      },
      async settle() {
        const [status, chargedMicrodollars, ...extra] = await transition('settle');
        if (
          extra.length ||
          (status !== 'settled' && status !== 'retained') ||
          !Number.isSafeInteger(chargedMicrodollars) ||
          chargedMicrodollars < 0 ||
          chargedMicrodollars > BUDGET_LIMITS.reservationMicrodollars ||
          (status === 'retained' && chargedMicrodollars !== BUDGET_LIMITS.reservationMicrodollars)
        )
          throw unavailable();
        return { status, chargedMicrodollars };
      },
    };
  }
  throw unavailable();
}
