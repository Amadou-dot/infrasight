/**
 * OPT-IN: executes the cache commit script against a REAL Redis.
 *
 * WHY THIS EXISTS SEPARATELY. The cross-process half of the stale-write guard
 * (see the "LAYER 2 OF 2" section of lib/cache/cache.ts) is a Lua script, and
 * every other test in the suite fakes `eval` with the compare-and-set CONTRACT
 * rather than executing Lua. `__tests__/unit/lib/cache.test.ts` asserts the
 * script's semantics structurally, which catches a deleted compare — but only
 * a real server proves the script actually behaves that way when Redis runs it.
 *
 * SKIPPED, NOT FAILED, when `REDIS_TEST_URL` is unset. CI has no Redis and must
 * not grow a dependency on one; this is a check a person re-runs on demand.
 * When the variable IS set, the suite runs for real and a connection failure is
 * a genuine failure — you asked for it explicitly.
 *
 *   docker run -d --name p4-redis -p 63790:6379 redis:7-alpine
 *   REDIS_TEST_URL=redis://127.0.0.1:63790 \
 *     npx jest __tests__/integration/cache-commit-script.redis.test.ts
 *   docker rm -f p4-redis
 *
 * The script is EXTRACTED FROM THE SOURCE by regex rather than retyped here, so
 * this cannot drift from what ships. If the constant is ever renamed, the
 * extraction fails loudly instead of silently testing a stale copy.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

/** Silent, visible skip: jest reports the whole block as skipped. */
const describeWithRedis = REDIS_TEST_URL ? describe : describe.skip;

function extractCommitScript(): string {
  const source = readFileSync(join(process.cwd(), 'lib/cache/cache.ts'), 'utf8');
  const match = source.match(/const COMMIT_IF_EPOCH_UNCHANGED = `([\s\S]*?)`;/);

  if (!match)
    throw new Error(
      'Could not extract COMMIT_IF_EPOCH_UNCHANGED from lib/cache/cache.ts. ' +
        'If the constant was renamed, update this extraction — do not inline a copy of the script.'
    );

  return match[1];
}

describeWithRedis('cache commit script against a real Redis (opt-in: REDIS_TEST_URL)', () => {
  const SCRIPT = extractCommitScript();

  // Namespaced so this never touches keys belonging to whoever owns the server
  // it is pointed at. No FLUSHALL anywhere in this file, deliberately.
  const PREFIX = `p4-commit-script:${process.pid}:${Date.now()}`;
  const VALUE_KEY = `${PREFIX}:value`;
  const EPOCH_KEY = `${VALUE_KEY}::epoch`;

  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(REDIS_TEST_URL as string, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
  });

  afterAll(async () => {
    if (!redis) return;
    await redis.del(VALUE_KEY, EPOCH_KEY);
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.del(VALUE_KEY, EPOCH_KEY);
  });

  /** Mirrors commitIfEpochUnchanged's call exactly. */
  function commit(value: string, observedEpoch: string, ttl = 60) {
    return redis.eval(SCRIPT, 2, VALUE_KEY, EPOCH_KEY, String(ttl), value, observedEpoch);
  }

  it('should commit when the key was never invalidated', async () => {
    await expect(commit('v1', '')).resolves.toBe(1);

    expect(await redis.get(VALUE_KEY)).toBe('v1');
    expect(await redis.ttl(VALUE_KEY)).toBeGreaterThan(0);
  });

  // THE race. A reader observed "no epoch", an invalidation bumped it, and the
  // reader's late write must not resurrect the pre-mutation value.
  it('should refuse a write whose observed epoch is stale', async () => {
    await redis.incr(EPOCH_KEY);

    await expect(commit('stale', '')).resolves.toBe(0);
    expect(await redis.get(VALUE_KEY)).toBeNull();
  });

  it('should commit when the observed epoch still matches', async () => {
    await redis.incr(EPOCH_KEY);
    const observed = (await redis.get(EPOCH_KEY)) as string;

    await expect(commit('v2', observed)).resolves.toBe(1);
    expect(await redis.get(VALUE_KEY)).toBe('v2');
  });

  it('should leave an already-committed value alone when it refuses', async () => {
    await redis.incr(EPOCH_KEY);
    const observed = (await redis.get(EPOCH_KEY)) as string;
    await commit('v2', observed);

    // A second invalidation lands; the holder of the now-stale observation
    // must not overwrite what is there.
    await redis.incr(EPOCH_KEY);

    await expect(commit('stale', observed)).resolves.toBe(0);
    expect(await redis.get(VALUE_KEY)).toBe('v2');
  });

  // readEpoch() returns this sentinel when the epoch read itself fails. It has
  // to fail CLOSED: an unreadable epoch must never look like "never invalidated".
  it('should refuse the unreadable-epoch sentinel', async () => {
    await expect(commit('stale', '\u0000unreadable')).resolves.toBe(0);
    expect(await redis.get(VALUE_KEY)).toBeNull();
  });

  // An epoch that aged out is indistinguishable from "never invalidated", so a
  // caller still holding a numeric observation must be refused.
  it('should refuse when the epoch expired under a non-empty observation', async () => {
    await expect(commit('stale', '7')).resolves.toBe(0);
    expect(await redis.get(VALUE_KEY)).toBeNull();
  });
});
