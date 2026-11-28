import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { ApiError } from '@/lib/errors';
import { logger } from '@/lib/monitoring/logger';
import { getRedisClient } from '@/lib/redis/client';
import { untilAborted } from './abort';
import { reauthorizeAssistant, type DatasetScope } from './access';
import { admitBudget, type StoredBudget } from './budget-store';
import {
  assertBudgetConfiguration,
  BUDGET_LIMITS,
  GENERATION_POLICY,
  priceResponse,
} from './pricing';

type Generate<T> = (
  policy: typeof GENERATION_POLICY,
  options: { maxRetries: 0; signal: AbortSignal }
) => Promise<T>;

export interface BudgetLease {
  /** Pass the counted input for the complete generation request, including tools and instructions. */
  runAttempt<T>(inputTokens: number, signal: AbortSignal, generate: Generate<T>): Promise<T>;
  /** Call in finally. Accounting continues after a disconnect and settlement can be retried. */
  settle(): ReturnType<StoredBudget['settle']>;
}

function interrupted(signal: AbortSignal) {
  return signal.reason?.name === 'TimeoutError'
    ? ApiError.serviceUnavailable('Assistant request timed out')
    : new DOMException('Assistant request cancelled', 'AbortError');
}

async function waitForCaller<T>(signal: AbortSignal, work: () => Promise<T>) {
  try {
    return await untilAborted(signal, work);
  } catch (error) {
    if (signal.aborted) throw interrupted(signal);
    throw error;
  }
}

function budgetUnavailable() {
  return ApiError.serviceUnavailable('Assistant budget storage is unavailable');
}

function continueAfterResponse(work: Promise<unknown>) {
  const cleanup = work.catch(() =>
    logger.warn('Assistant budget settlement could not be confirmed')
  );
  // Keep the actual Redis work alive on serverless hosts when the caller has already timed out.
  after(() => cleanup);
}

async function accounting<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw budgetUnavailable();
  }
}

/** Acquire one hold for a question. Its identity and time anchor come from the server-side pilot gate. */
export async function reserve(
  scope: DatasetScope,
  requestId: string = randomUUID(),
  callerSignal?: AbortSignal
): Promise<BudgetLease> {
  assertBudgetConfiguration();
  if (!requestId || requestId.length > 128)
    throw ApiError.badRequest('Invalid assistant request ID');
  const remaining = Math.min(
    BUDGET_LIMITS.requestMs,
    Date.parse(scope.asOf) + BUDGET_LIMITS.requestMs - Date.now()
  );
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw ApiError.serviceUnavailable('Assistant request timed out');
  const deadline = AbortSignal.timeout(remaining);
  const requestSignal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  await waitForCaller(requestSignal, () => reauthorizeAssistant(scope));
  const admission = accounting(() => {
    const redis = getRedisClient();
    if (!redis) throw budgetUnavailable();
    return admitBudget(redis, scope, requestId);
  });
  let stored: StoredBudget;
  try {
    stored = await waitForCaller(requestSignal, () => admission);
    if (requestSignal.aborted) throw interrupted(requestSignal);
  } catch (error) {
    // A late admission never reached the caller and cannot have submitted anything.
    if (requestSignal.aborted)
      continueAfterResponse(
        admission.then(
          lease => lease.settle(),
          () => undefined
        )
      );
    throw error;
  }

  let nextAttempt = 1;
  let closed = false;
  let pending: Promise<unknown> | undefined;
  let outstandingWrite: (() => Promise<void>) | undefined;
  let settlement: ReturnType<StoredBudget['settle']> | undefined;
  let cleanupRegistered = false;

  async function persistReceipt() {
    if (!outstandingWrite) return;
    await accounting(outstandingWrite);
    outstandingWrite = undefined;
  }

  async function submit<T>(
    inputTokens: number,
    signal: AbortSignal,
    generate: Generate<T>
  ): Promise<T> {
    if (
      !Number.isSafeInteger(inputTokens) ||
      inputTokens < 1 ||
      inputTokens > BUDGET_LIMITS.maxInputTokens
    )
      throw ApiError.badRequest('Assistant input is outside its token budget');
    if (nextAttempt > BUDGET_LIMITS.maxAttempts)
      throw ApiError.conflict('Assistant generation limit reached');
    assertBudgetConfiguration();
    await waitForCaller(signal, () => reauthorizeAssistant(scope));
    if (closed) throw ApiError.conflict('Assistant budget lease is closed');
    const attempt = nextAttempt++;
    // Only this owner can submit. Until the callback runs, a lost claim acknowledgement
    // can be reconciled at zero even if Redis committed the claim.
    outstandingWrite = () => stored.cancelUnsubmitted(attempt);
    try {
      await accounting(() => stored.begin(attempt));
    } catch (error) {
      await persistReceipt();
      throw error;
    }
    if (signal.aborted || closed) {
      await persistReceipt();
      if (signal.aborted) throw interrupted(signal);
      throw ApiError.conflict('Assistant budget lease is closed');
    }

    let response: T;
    outstandingWrite = () => stored.record(attempt, null);
    try {
      response = await untilAborted(signal, () =>
        generate(GENERATION_POLICY, { signal, maxRetries: 0 })
      );
    } catch {
      // A timeout or disconnect does not tell us whether the provider billed this attempt.
      await persistReceipt();
      if (signal.aborted) throw interrupted(signal);
      throw ApiError.serviceUnavailable('Assistant generation could not be confirmed', {
        budgetStatus: 'usage_unknown',
      });
    }
    const cost = priceResponse(response);
    const charge = cost.status === 'known' ? cost.microdollars : null;
    outstandingWrite = () => stored.record(attempt, charge);
    await persistReceipt();
    if (cost.status !== 'known')
      throw ApiError.serviceUnavailable('Assistant usage could not be priced', {
        budgetStatus: cost.status,
      });
    if (signal.aborted) throw interrupted(signal);
    return response;
  }

  async function finalize() {
    await pending?.catch(() => undefined);
    // The original charge survives a failed write or lost reply. Replay it before refunding.
    await persistReceipt();
    return accounting(() => stored.settle());
  }

  function finishOnce() {
    settlement ??= finalize().catch(error => {
      settlement = undefined;
      throw error;
    });
    return settlement;
  }

  function continueSettlement() {
    if (cleanupRegistered) return;
    continueAfterResponse(finishOnce());
    cleanupRegistered = true;
  }

  return {
    async runAttempt<T>(inputTokens: number, caller: AbortSignal, generate: Generate<T>) {
      if (closed || pending) throw ApiError.conflict('Assistant budget lease is closed or busy');
      const signal = AbortSignal.any([requestSignal, caller]);
      if (signal.aborted) throw interrupted(signal);
      const operation = submit(inputTokens, signal, generate)
        .catch(error => {
          closed = true;
          throw error;
        })
        .finally(() => {
          pending = undefined;
        });
      pending = operation;
      try {
        return await waitForCaller(signal, () => operation);
      } catch (error) {
        closed = true;
        if (signal.aborted) continueSettlement();
        throw error;
      }
    },
    async settle() {
      closed = true;
      if (requestSignal.aborted) {
        continueSettlement();
        throw interrupted(requestSignal);
      }
      try {
        return await waitForCaller(requestSignal, finishOnce);
      } catch (error) {
        if (requestSignal.aborted) continueSettlement();
        throw error;
      }
    },
  };
}
