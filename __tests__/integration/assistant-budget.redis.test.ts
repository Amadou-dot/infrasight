import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { reauthorizeAssistant, type DatasetScope } from '@/lib/assistant/access';
import { reserve } from '@/lib/assistant/budget';
import { admitBudget } from '@/lib/assistant/budget-store';
import { getRedisClient } from '@/lib/redis/client';

jest.mock('@/lib/assistant/access', () => ({ reauthorizeAssistant: jest.fn() }));
jest.mock('@/lib/redis/client', () => ({ getRedisClient: jest.fn() }));

// Run with REDIS_TEST_URL pointing to a disposable Redis 7 instance.
const redisUrl = process.env.REDIS_TEST_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis('assistant budget against real Redis', () => {
  const prefix = `assistant-budget-test:${randomUUID()}:`;
  const primary = { userId: 'user-1', orgId: 'org-1' };
  const secondary = { userId: 'user-2', orgId: 'org-2' };
  let redis: Redis;
  let competingRedis: Redis;
  let fixtureMonth: number;
  let now: number;

  function connect() {
    return new Redis(redisUrl!, {
      keyPrefix: prefix,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
  }

  function dayKey(time: number) {
    return `{assistant-budget}:day:${new Date(time).toISOString().slice(0, 10)}`;
  }

  function monthKey(time: number) {
    return `{assistant-budget}:month:${new Date(time).toISOString().slice(0, 7)}`;
  }

  function nextMonthStart() {
    const next = new Date(fixtureMonth);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next.getTime();
  }

  function useFixtureClock() {
    for (const client of [redis, competingRedis]) {
      const evalScript = client.eval.bind(client);
      const time = () => [Math.floor(now / 1_000), (now % 1_000) * 1_000];
      jest.spyOn(client, 'time').mockImplementation(async () => time());
      // Substitute just Redis TIME. Redis executes the shipped Lua with real keys and storage.
      jest.spyOn(client, 'eval').mockImplementation((script, numberOfKeys, ...args) => {
        const lua = script.toString();
        const fixture = lua.replaceAll("redis.call('TIME')", `{${time().join(',')}}`);
        if (fixture === lua) throw new Error('Budget clock fixture did not replace Redis TIME');
        return evalScript(fixture, numberOfKeys, ...args);
      });
    }
  }

  function quotaError(retryAfter: number) {
    return { statusCode: 429, metadata: { retryAfter } };
  }

  function dropNextEvalReply(client: Redis) {
    const evalScript = client.eval.bind(client);
    let droppedReply: unknown;
    jest.spyOn(client, 'eval').mockImplementationOnce(async (script, numberOfKeys, ...args) => {
      droppedReply = await evalScript(script, numberOfKeys, ...args);
      throw new Error('Simulated lost Redis reply');
    });
    return () => droppedReply;
  }

  beforeAll(async () => {
    redis = connect();
    competingRedis = connect();
    await Promise.all([redis.connect(), competingRedis.connect()]);
    const [seconds] = await redis.time();
    const current = new Date(Number(seconds) * 1_000);
    // Redis also runs its own key expiry. Keep fixture timestamps in the future.
    fixtureMonth = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1);
  });

  beforeEach(() => {
    now = fixtureMonth + 12 * 60 * 60 * 1_000;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (redis.status !== 'ready') return;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`);
      if (keys.length) await redis.del(...keys.map(key => key.slice(prefix.length)));
      cursor = next;
    } while (cursor !== '0');
  });

  afterAll(() => {
    redis?.disconnect();
    competingRedis?.disconnect();
  });

  it.each([
    { cap: 'daily', day: 1_980_000, month: 0, retryAfter: 43_200 },
    { cap: 'monthly', day: 0, month: 19_980_000, retryAfter: 0 },
  ])('admits only one organization for the last $0.02 of $cap budget', async fixture => {
    useFixtureClock();
    await Promise.all([
      redis.set(dayKey(now), fixture.day),
      redis.set(monthKey(now), fixture.month),
    ]);

    const results = await Promise.allSettled([
      admitBudget(redis, primary, randomUUID()),
      admitBudget(competingRedis, secondary, randomUUID()),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const retryAfter = fixture.retryAfter || (nextMonthStart() - now) / 1_000;
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: quotaError(retryAfter),
    });
    expect(await redis.mget(dayKey(now), monthKey(now))).toEqual([
      String(fixture.day + 20_000),
      String(fixture.month + 20_000),
    ]);
  });

  it('counts cancellations in a rolling five-admission user limit across organizations', async () => {
    useFixtureClock();
    const sameUserOtherOrg = { ...primary, orgId: secondary.orgId };
    for (let index = 0; index < 5; index += 1) {
      const lease = await admitBudget(redis, primary, randomUUID());
      await lease.settle();
      now += 1_000;
    }

    await expect(admitBudget(competingRedis, sameUserOtherOrg, randomUUID())).rejects.toMatchObject(
      quotaError(55)
    );
    now += 54_999;
    await expect(admitBudget(redis, primary, randomUUID())).rejects.toMatchObject(quotaError(1));
    now += 1;
    const next = await admitBudget(competingRedis, sameUserOtherOrg, randomUUID());
    await expect(next.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 0 });
  });

  it('limits each user to 50 admissions per UTC day', async () => {
    useFixtureClock();
    for (let index = 0; index < 50; index += 1) {
      const lease = await admitBudget(redis, primary, randomUUID());
      await lease.settle();
      now += 60_000;
    }

    const sameUserOtherOrg = { ...primary, orgId: secondary.orgId };
    await expect(admitBudget(competingRedis, sameUserOtherOrg, randomUUID())).rejects.toMatchObject(
      quotaError(40_200)
    );
    now = fixtureMonth + 24 * 60 * 60 * 1_000;
    const next = await admitBudget(redis, primary, randomUUID());
    await expect(next.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 0 });
  });

  it('limits a user to one active lease across organizations', async () => {
    useFixtureClock();
    const first = await admitBudget(redis, primary, randomUUID());
    const sameUserOtherOrg = { ...primary, orgId: secondary.orgId };
    now += 10_000;
    await expect(admitBudget(competingRedis, sameUserOtherOrg, randomUUID())).rejects.toMatchObject(
      quotaError(35)
    );
    await first.settle();
    await expect(
      admitBudget(competingRedis, sameUserOtherOrg, randomUUID())
    ).resolves.toBeDefined();
  });

  it('limits an organization to three active users', async () => {
    useFixtureClock();
    const first = await admitBudget(redis, primary, randomUUID());
    now += 5_000;
    await admitBudget(redis, { ...primary, userId: 'user-2' }, randomUUID());
    await admitBudget(competingRedis, { ...primary, userId: 'user-3' }, randomUUID());

    const fourthUser = { ...primary, userId: 'user-4' };
    await expect(admitBudget(redis, fourthUser, randomUUID())).rejects.toMatchObject(
      quotaError(40)
    );
    await first.settle();
    await expect(admitBudget(redis, fourthUser, randomUUID())).resolves.toBeDefined();
  });

  it('reclaims an expired slot while retaining an unresolved submission', async () => {
    useFixtureClock();
    const original = await admitBudget(redis, primary, randomUUID());
    await original.begin(1);
    now += 44_999;
    await expect(admitBudget(competingRedis, primary, randomUUID())).rejects.toMatchObject(
      quotaError(1)
    );

    now += 1;
    const replacement = await admitBudget(competingRedis, primary, randomUUID());
    await expect(original.settle()).resolves.toEqual({
      status: 'retained',
      chargedMicrodollars: 20_000,
    });
    expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['40000', '40000']);
    await expect(admitBudget(redis, primary, randomUUID())).rejects.toMatchObject(quotaError(45));
    await replacement.settle();
    expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['20000', '20000']);
  });

  it('refuses to begin a provider attempt after its lease expires', async () => {
    useFixtureClock();
    const lease = await admitBudget(redis, primary, randomUUID());
    now += 45_000;
    await expect(lease.begin(1)).rejects.toMatchObject({ statusCode: 503 });
    await expect(lease.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 0 });
  });

  it('makes duplicate usage and settlement idempotent using the live Redis clock', async () => {
    const [seconds] = await redis.time();
    const admissionTime = Number(seconds) * 1_000;
    const lease = await admitBudget(redis, primary, randomUUID());
    await lease.begin(1);
    await Promise.all([lease.record(1, 750), lease.record(1, 750)]);
    await lease.begin(2);
    await lease.record(2, 225);
    const outcome = { status: 'settled', chargedMicrodollars: 975 };
    await expect(Promise.all([lease.settle(), lease.settle()])).resolves.toEqual([
      outcome,
      outcome,
    ]);
    expect(await redis.mget(dayKey(admissionTime), monthKey(admissionTime))).toEqual([
      '975',
      '975',
    ]);
  });

  it('rejects the second claimant of a request ID even after cancellation', async () => {
    useFixtureClock();
    const requestId = randomUUID();
    const results = await Promise.allSettled([
      admitBudget(redis, primary, requestId),
      admitBudget(competingRedis, secondary, requestId),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lease = results.find(result => result.status === 'fulfilled')?.value;
    if (!lease) throw new Error('Missing winning lease');
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { statusCode: 409 },
    });
    expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['20000', '20000']);
    await expect(lease.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 0 });
    await expect(admitBudget(redis, secondary, requestId)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['0', '0']);
  });

  it('refunds only its own unissued hold when the admission reply is lost', async () => {
    const [seconds] = await redis.time();
    const admissionTime = Number(seconds) * 1_000;
    const spendKeys = [dayKey(admissionTime), monthKey(admissionTime)];
    // Fill two organization slots so the replacement needs both the lost user's and org's slots.
    await admitBudget(redis, { ...primary, userId: 'user-2' }, randomUUID());
    await admitBudget(redis, { ...primary, userId: 'user-3' }, randomUUID());
    expect(await redis.mget(...spendKeys)).toEqual(['40000', '40000']);

    const lostRequestId = randomUUID();
    const lostReply = dropNextEvalReply(redis);
    await expect(admitBudget(redis, primary, lostRequestId)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(lostReply()).toEqual(['ok']);
    expect(await redis.mget(...spendKeys)).toEqual(['40000', '40000']);
    await expect(admitBudget(competingRedis, primary, lostRequestId)).rejects.toMatchObject({
      statusCode: 409,
    });

    const requestId = randomUUID();
    const issued = await admitBudget(redis, primary, requestId);
    const duplicateReply = dropNextEvalReply(competingRedis);
    await expect(admitBudget(competingRedis, primary, requestId)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(duplicateReply()).toEqual(['duplicate']);
    expect(await redis.mget(...spendKeys)).toEqual(['60000', '60000']);
    await issued.begin(1);
    await issued.record(1, 750);
    await expect(issued.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 750 });
    expect(await redis.mget(...spendKeys)).toEqual(['40750', '40750']);
  });

  it('retains the full reservation when usage after a submission is unknown', async () => {
    useFixtureClock();
    await redis.set(dayKey(now), 1_980_000);
    const lease = await admitBudget(redis, primary, randomUUID());
    await lease.begin(1);
    await expect(lease.begin(1)).rejects.toMatchObject({ statusCode: 503 });
    await lease.record(1, null);
    await lease.record(1, null);
    await expect(lease.begin(2)).rejects.toMatchObject({ statusCode: 503 });
    await expect(lease.settle()).resolves.toEqual({
      status: 'retained',
      chargedMicrodollars: 20_000,
    });
    await expect(admitBudget(competingRedis, secondary, randomUUID())).rejects.toMatchObject(
      quotaError(43_200)
    );
    expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['2000000', '20000']);
  });

  it('prevents an attempt replay after Redis committed the start but the caller lost its reply', async () => {
    const lease = await admitBudget(redis, primary, randomUUID());
    const droppedReply = dropNextEvalReply(redis);

    await expect(lease.begin(1)).rejects.toMatchObject({ statusCode: 503 });
    expect(droppedReply()).toEqual(['ok']);
    await expect(lease.begin(1)).rejects.toMatchObject({ statusCode: 503 });
    await expect(lease.begin(2)).rejects.toMatchObject({ statusCode: 503 });
    await expect(lease.settle()).resolves.toEqual({
      status: 'retained',
      chargedMicrodollars: 20_000,
    });
  });

  it('keeps the full reserve when two conflicting receipts arrive for an attempt', async () => {
    useFixtureClock();
    const lease = await admitBudget(redis, primary, randomUUID());
    await lease.begin(1);
    await lease.record(1, 750);
    await expect(lease.record(1, 250)).rejects.toMatchObject({ statusCode: 503 });
    await expect(lease.settle()).resolves.toEqual({
      status: 'retained',
      chargedMicrodollars: 20_000,
    });
    expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['20000', '20000']);
  });

  it('fails closed on an unusable spend bucket without admitting the request', async () => {
    useFixtureClock();
    await redis.set(dayKey(now), 40_000);
    await redis.zadd(monthKey(now), 0, 'invalid-type');
    const requestId = randomUUID();
    await expect(admitBudget(redis, primary, requestId)).rejects.toMatchObject({ statusCode: 503 });
    expect(await redis.get(dayKey(now))).toBe('40000');

    await redis.del(monthKey(now));
    const lease = await admitBudget(redis, primary, requestId);
    await expect(lease.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 0 });
  });

  it('settles a pre-midnight request into its original month after the UTC day changes', async () => {
    useFixtureClock();
    now = fixtureMonth + (24 * 60 * 60 - 2) * 1_000;
    const oldDay = dayKey(now);
    const old = await admitBudget(redis, primary, randomUUID());
    await old.begin(1);
    await old.record(1, 750);

    now += 3_000;
    // Match the synthetic clock's boundary by expiring the old key on the real server.
    await redis.pexpire(oldDay, 0);
    await admitBudget(competingRedis, secondary, randomUUID());

    await expect(old.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 750 });
    expect(await redis.mget(oldDay, dayKey(now), monthKey(now))).toEqual([null, '20000', '20750']);
  });

  it('leaves the new UTC month untouched when a previous-month lease settles', async () => {
    useFixtureClock();
    now = nextMonthStart() - 2_000;
    const oldDay = dayKey(now);
    const oldMonth = monthKey(now);
    const requestId = randomUUID();
    const requestHash = createHash('sha256').update(requestId).digest('hex').slice(0, 32);
    const ledger = `{assistant-budget}:request:${requestHash}`;
    const old = await admitBudget(redis, primary, requestId);
    await expect(redis.pexpiretime(ledger)).resolves.toBe(nextMonthStart() + 60_000);
    await old.begin(1);
    await old.record(1, 750);

    now += 3_000;
    await Promise.all([redis.pexpire(oldDay, 0), redis.pexpire(oldMonth, 0)]);
    await admitBudget(competingRedis, secondary, randomUUID());

    await expect(old.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 750 });
    expect(await redis.mget(oldDay, oldMonth, dayKey(now), monthKey(now))).toEqual([
      null,
      null,
      '20000',
      '20000',
    ]);
  });

  it('resolves a UTC month boundary between requesting the time and running admission Lua', async () => {
    useFixtureClock();
    now = nextMonthStart() - 1;
    const oldTime = now;
    const staleHint = await redis.time();
    now += 1;
    jest.mocked(redis.time).mockResolvedValueOnce(staleHint);

    await admitBudget(redis, primary, randomUUID());
    expect(
      await redis.mget(dayKey(oldTime), monthKey(oldTime), dayKey(now), monthKey(now))
    ).toEqual([null, null, '20000', '20000']);
  });

  describe('through the assistant budget lease', () => {
    function scope(identity = primary): DatasetScope {
      return {
        ...identity,
        sessionId: 'session-test',
        datasetId: 'dataset-test',
        policyVersion: 'assistant-pilot-v1',
        asOf: new Date().toISOString(),
      };
    }

    const response = {
      model: 'gpt-6-luna',
      service_tier: 'default',
      usage: {
        input_tokens: 100,
        input_tokens_details: {
          cached_tokens: 20,
          cache_write_tokens: 20,
          cache_write_tokens_details: { ttl_30m_tokens: 10, ttl_12h_tokens: 10 },
        },
        output_tokens: 10,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 110,
      },
    };

    beforeEach(async () => {
      jest.mocked(getRedisClient).mockReturnValue(redis);
      jest.mocked(reauthorizeAssistant).mockResolvedValue(undefined);
      const [seconds] = await redis.time();
      now = Number(seconds) * 1_000;
    });

    it('reduces the Redis hold to the priced usage after settlement', async () => {
      const lease = await reserve(scope());
      expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['20000', '20000']);

      const caller = new AbortController();
      await expect(lease.runAttempt(100, caller.signal, async () => response)).resolves.toBe(
        response
      );
      await expect(lease.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 15 });
      expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['15', '15']);
    });

    it('charges only the first receipt when the second start reply is lost before generation', async () => {
      const lease = await reserve(scope());
      const caller = new AbortController();
      await expect(lease.runAttempt(100, caller.signal, async () => response)).resolves.toBe(
        response
      );

      const droppedReply = dropNextEvalReply(redis);
      const generate = jest.fn(async () => response);
      await expect(lease.runAttempt(100, caller.signal, generate)).rejects.toMatchObject({
        statusCode: 503,
      });
      expect(droppedReply()).toEqual(['ok']);
      expect(generate).not.toHaveBeenCalled();
      await expect(lease.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 15 });
      expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['15', '15']);
    });

    it.each(['before commit', 'after commit'])(
      'settles a known receipt when its record write fails %s',
      async phase => {
        const lease = await reserve(scope());
        const caller = new AbortController();
        let droppedReply: (() => unknown) | undefined;
        const generate = jest.fn(async () => {
          if (phase === 'before commit')
            jest
              .spyOn(redis, 'eval')
              .mockRejectedValueOnce(new Error('Simulated Redis write failure'));
          else droppedReply = dropNextEvalReply(redis);

          return response;
        });

        await expect(lease.runAttempt(100, caller.signal, generate)).rejects.toMatchObject({
          statusCode: 503,
        });
        expect(generate).toHaveBeenCalledTimes(1);
        if (phase === 'after commit') expect(droppedReply?.()).toEqual(['ok']);
        await expect(lease.settle()).resolves.toEqual({
          status: 'settled',
          chargedMicrodollars: 15,
        });
        expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['15', '15']);
      }
    );

    it('retains a full hold for unknown usage and denies generation once the quota is exhausted', async () => {
      await redis.set(dayKey(now), 1_980_000);
      const lease = await reserve(scope());
      const caller = new AbortController();
      const generate = jest.fn(async () => ({ ...response, usage: undefined }));

      await expect(lease.runAttempt(100, caller.signal, generate)).rejects.toMatchObject({
        statusCode: 503,
        metadata: { budgetStatus: 'usage_unknown' },
      });
      await expect(lease.runAttempt(100, caller.signal, generate)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(generate).toHaveBeenCalledTimes(1);
      await expect(lease.settle()).resolves.toEqual({
        status: 'retained',
        chargedMicrodollars: 20_000,
      });

      const deniedGenerate = jest.fn(async () => response);
      await expect(
        reserve(scope(secondary)).then(other =>
          other.runAttempt(100, caller.signal, deniedGenerate)
        )
      ).rejects.toMatchObject({ statusCode: 429, metadata: { retryAfter: expect.any(Number) } });
      expect(deniedGenerate).not.toHaveBeenCalled();
      expect(await redis.mget(dayKey(now), monthKey(now))).toEqual(['2000000', '20000']);
    });
  });
});
