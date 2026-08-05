/**
 * Cache Manager
 *
 * Redis-backed caching with TTL and graceful degradation.
 * Provides cache-aside pattern with automatic serialization.
 */

import { getRedisClient, isRedisAvailable } from '../redis/client';
import { logger } from '../monitoring/logger';
import { recordCacheEvent } from '../monitoring/metrics';

// ============================================================================
// TYPES
// ============================================================================

export interface CacheOptions {
  /** Time-to-live in seconds */
  ttl: number;
}

// ============================================================================
// TTL CONFIGURATIONS
// ============================================================================

/**
 * Default TTL configurations (in seconds)
 * Configurable via environment variables
 */
export const CACHE_TTL = {
  /** Metadata endpoint - 10 minutes (device counts, manufacturers, etc.) */
  METADATA: parseInt(process.env.CACHE_METADATA_TTL || '600', 10),
  /** Health analytics - 60 seconds (needs to be fairly fresh) */
  HEALTH: parseInt(process.env.CACHE_HEALTH_TTL || '60', 10),
  /** Individual device config - 5 minutes */
  DEVICE: 300,
  /** Latest readings - 10 seconds (very dynamic) */
  READINGS_LATEST: 10,
  /** Analytics data - 1 minute */
  ANALYTICS: 60,
  /** Device lists - 30 seconds */
  DEVICES_LIST: 30,
  /** Maintenance forecast - 2 minutes */
  MAINTENANCE_FORECAST: parseInt(process.env.CACHE_MAINTENANCE_FORECAST_TTL || '120', 10),
  /** Anomalies - 1 minute */
  ANOMALIES: parseInt(process.env.CACHE_ANOMALIES_TTL || '60', 10),
} as const;

// ============================================================================
// STALE-WRITE GUARD, LAYER 1 OF 2: in-process invalidation generation
// ============================================================================

/**
 * `getOrSet` populates the cache AFTER awaiting its fetch, so without a guard
 * an invalidation landing in between is silently undone: a read that missed
 * just before a mutation repopulates the PRE-mutation value after the `del`
 * has already run, under a fresh full TTL, with no self-correction short of
 * that TTL expiring. On the alert rule cache (60s TTL, invalidated on every
 * rule create/update/delete) that is a disabled rule that keeps firing for up
 * to a minute after an operator switched it off.
 *
 * Every invalidation bumps a monotonic generation and records WHICH keys it
 * covered. `getOrSet` snapshots the generation before it reads and drops its
 * write if anything covering its key happened since.
 *
 * This layer is process-local, and it is the FAST path rather than the whole
 * answer. It costs no Redis round trip, and it is the only layer that can
 * catch a PATTERN invalidation for a key that was absent from Redis at scan
 * time (see the epoch section below for why that case is invisible there).
 *
 * It is not sufficient on its own: this app deploys to Vercel serverless, so
 * the PATCH that disables a rule and the ingest request that repopulates the
 * rule cache normally run on DIFFERENT function instances. Alone, this layer
 * would close the case that barely happens and leave the case that does.
 * Layer 2 covers that.
 */
interface InvalidationEvent {
  generation: number;
  /** True when this invalidation would have removed `key`. */
  covers: (key: string) => boolean;
}

let invalidationGeneration = 0;
const invalidationLog: InvalidationEvent[] = [];

/**
 * Highest generation whose event has been dropped from the bounded log. A
 * snapshot older than this predates an invalidation we can no longer inspect,
 * so it is treated as invalidated — the conservative direction (a skipped
 * cache write costs one extra fetch; a stale one serves wrong data for a TTL).
 * 0 means "nothing dropped yet".
 */
let truncatedThrough = 0;

/** Bounds memory on a long-lived process. Far above any realistic in-flight count. */
const INVALIDATION_LOG_LIMIT = 256;

function recordInvalidation(covers: (key: string) => boolean): void {
  invalidationGeneration += 1;
  invalidationLog.push({ generation: invalidationGeneration, covers });

  while (invalidationLog.length > INVALIDATION_LOG_LIMIT)
    truncatedThrough = invalidationLog.shift()!.generation;
}

function wasInvalidatedSince(key: string, snapshot: number): boolean {
  if (snapshot < truncatedThrough) return true;
  return invalidationLog.some(event => event.generation > snapshot && event.covers(key));
}

/**
 * Translate a Redis glob (`*`, `?`) into a key matcher, so a pattern
 * invalidation cancels in-flight writes for keys it would have deleted — and
 * only those. A pattern delete cannot simply consult its own SCAN results
 * here: the racing key is precisely the one absent from Redis at that moment.
 */
function globMatcher(pattern: string): (key: string) => boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${source}$`);
  return key => regex.test(key);
}

// ============================================================================
// STALE-WRITE GUARD, LAYER 2 OF 2: Redis per-key epoch
// ============================================================================

/**
 * Layer 1 cannot see across process boundaries, and on serverless the two
 * halves of the race are normally in different function instances. So the
 * version counter also lives in Redis, where both halves can see it:
 *
 *   - every invalidation INCRs `<key>::epoch` (best effort, see `bumpEpochs`)
 *   - `getOrSet` reads that epoch after its cache miss and before its fetch
 *   - the write commits through a Lua CAS that re-reads the epoch server-side
 *     and only SETEXes if it is byte-for-byte what the caller observed
 *
 * The CAS is what makes the stale write a genuine no-op rather than a narrowed
 * window: the compare and the write are one atomic Redis command, so no
 * invalidation can land between them.
 *
 * WHY LUA AND NOT WATCH/MULTI. `lib/redis/client.ts` hands every caller the
 * same ioredis singleton, and WATCH is per-CONNECTION state. Two concurrent
 * `getOrSet` calls sharing that connection would clobber each other's watch
 * set, and correctness would depend on request concurrency. Making it safe
 * would mean a dedicated connection per commit, which defeats the singleton on
 * a platform where connection count is the scarce resource. A single EVAL is
 * atomic server-side and connection-agnostic. Ioredis exposes `eval` directly,
 * so this needs nothing added to the client.
 *
 * REQUIRED ORDERING, relied on by every caller in `lib/cache/invalidation.ts`:
 * the epoch must be bumped AFTER the database mutation has committed. Given
 * that, a fetch which starts after the bump necessarily reads post-mutation
 * data and is safe to cache, which is what makes it correct to read the epoch
 * after the cache miss rather than before it.
 */

/**
 * How long an epoch outlives its last bump. Must comfortably exceed
 * (longest cache TTL + longest plausible fetch), so an epoch cannot expire
 * and restart at 1 underneath a snapshot old enough to match it again. The
 * longest TTL here is METADATA at 10 minutes.
 */
const EPOCH_TTL_SECONDS = 3600;

/** `''` means "no epoch recorded". INCR's first value is `1`, so they cannot collide. */
const EPOCH_ABSENT = '';

/**
 * Returned when the epoch could not be read. Contains a NUL byte, so it can
 * never equal a value INCR produced — the CAS therefore fails closed and the
 * write is skipped. An unreadable epoch must not be allowed to look like
 * "never invalidated".
 */
const EPOCH_UNREADABLE = '\u0000unreadable';

function epochKey(key: string): string {
  return `${key}::epoch`;
}

/** KEYS: [value key, epoch key]. ARGV: [ttl, serialized value, observed epoch]. */
const COMMIT_IF_EPOCH_UNCHANGED = `
local observed = ARGV[3]
local current = redis.call('GET', KEYS[2])
if current == false then current = '' end
if current ~= observed then return 0 end
redis.call('SETEX', KEYS[1], ARGV[1], ARGV[2])
return 1
`;

/**
 * Bump the epoch of every key an invalidation covers.
 *
 * BEST EFFORT, and deliberately so: it degrades exactly like the rest of this
 * module. `del()` already returns 0 and logs a warning when Redis misbehaves —
 * invalidation here has always been best-effort — so a failed bump must not
 * stop the DEL itself from being attempted, and must never throw into a
 * request. When it does fail, layer 1 is still in place within the instance.
 */
async function bumpEpochs(redis: NonNullable<ReturnType<typeof getRedisClient>>, keys: string[]) {
  if (keys.length === 0) return;

  try {
    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.incr(epochKey(key));
      pipeline.expire(epochKey(key), EPOCH_TTL_SECONDS);
    }
    await pipeline.exec();
  } catch (error) {
    logger.warn('Cache epoch bump failed; cross-process guard degraded for these keys', {
      keys,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Read the epoch a `getOrSet` must still see at commit time. Never throws. */
async function readEpoch(key: string): Promise<string> {
  const redis = getRedisClient();
  // No Redis means no cache write either (`commitIfEpochUnchanged` returns
  // false below), so the value here is moot — behave exactly as before.
  if (!redis || !isRedisAvailable()) return EPOCH_ABSENT;

  try {
    return (await redis.get(epochKey(key))) ?? EPOCH_ABSENT;
  } catch (error) {
    logger.warn('Cache epoch read failed', { key }, error as Error);
    return EPOCH_UNREADABLE;
  }
}

/**
 * Commit a `getOrSet` write only if nothing invalidated the key since
 * `observedEpoch` was read. Same graceful-degradation contract as `set()`:
 * returns false and logs on any failure, never throws into a request.
 */
async function commitIfEpochUnchanged<T>(
  key: string,
  value: T,
  options: CacheOptions,
  observedEpoch: string
): Promise<boolean> {
  if (!isCacheEnabled()) return false;

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return false;

  try {
    const committed = await redis.eval(
      COMMIT_IF_EPOCH_UNCHANGED,
      2,
      key,
      epochKey(key),
      String(options.ttl),
      JSON.stringify(value),
      observedEpoch
    );

    if (committed !== 1) {
      logger.debug('Cache write skipped: the key was invalidated in another process', { key });
      return false;
    }

    logger.cache('set', key);
    recordCacheEvent('set');
    return true;
  } catch (error) {
    logger.warn('Cache set failed', { key }, error as Error);
    return false;
  }
}

// ============================================================================
// CACHE OPERATIONS
// ============================================================================

/**
 * Check if caching is enabled
 */
export function isCacheEnabled(): boolean {
  return process.env.CACHE_ENABLED !== 'false';
}

/**
 * Get cached value
 *
 * @returns The cached value or null if not found/expired/error
 */
export async function get<T>(key: string): Promise<T | null> {
  if (!isCacheEnabled()) return null;

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return null;

  try {
    const cached = await redis.get(key);

    if (!cached) {
      logger.cache('miss', key);
      recordCacheEvent('miss');
      return null;
    }

    logger.cache('hit', key);
    recordCacheEvent('hit');

    return JSON.parse(cached) as T;
  } catch (error) {
    logger.warn('Cache get failed', { key }, error as Error);
    return null;
  }
}

/**
 * Set cached value with TTL
 *
 * @returns true if set successfully, false otherwise
 */
export async function set<T>(key: string, value: T, options: CacheOptions): Promise<boolean> {
  if (!isCacheEnabled()) return false;

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return false;

  try {
    const serialized = JSON.stringify(value);
    await redis.setex(key, options.ttl, serialized);

    logger.cache('set', key);
    recordCacheEvent('set');

    return true;
  } catch (error) {
    logger.warn('Cache set failed', { key }, error as Error);
    return false;
  }
}

/**
 * Delete cached value(s)
 *
 * @returns Number of keys deleted
 */
export async function del(...keys: string[]): Promise<number> {
  if (!isCacheEnabled() || keys.length === 0) return 0;

  // Recorded BEFORE the DEL is issued, and before the Redis availability
  // check, so an in-flight `getOrSet` is cancelled even if the DEL itself
  // never reaches Redis. Cancelling a write that did not need cancelling
  // costs one extra fetch; missing one serves pre-mutation data for a TTL.
  const invalidated = new Set(keys);
  recordInvalidation(key => invalidated.has(key));

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return 0;

  // Layer 2, and BEFORE the DEL for the same reason layer 1 is recorded first:
  // a `getOrSet` in another process that reads the epoch from here on must see
  // the bumped value. Self-contained failure handling, so a Redis fault here
  // cannot stop the DEL below from being attempted.
  await bumpEpochs(redis, keys);

  try {
    const deleted = await redis.del(...keys);

    if (deleted > 0) recordCacheEvent('invalidate');

    return deleted;
  } catch (error) {
    logger.warn('Cache delete failed', { keys }, error as Error);
    return 0;
  }
}

/**
 * Delete all keys matching a pattern
 *
 * @returns Number of keys deleted
 */
export async function delPattern(pattern: string): Promise<number> {
  if (!isCacheEnabled()) return 0;

  // Same ordering rationale as del() above.
  recordInvalidation(globMatcher(pattern));

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return 0;

  try {
    let cursor = '0';
    let totalDeleted = 0;

    // Use SCAN to find keys matching pattern (non-blocking)
    do {
      const [newCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;

      if (keys.length > 0) {
        // Cross-process cover for the keys this pattern actually matched.
        // RESIDUAL, by construction: a key ABSENT from Redis at scan time
        // cannot be enumerated here, and that is exactly the key a racing
        // `getOrSet` missed on. Layer 1's glob matcher is what covers that
        // case, and only within the instance — so a pattern invalidation is
        // strictly weaker cross-process than an exact-key `del`. Alert rules,
        // the subject of this guard, use `del(alertRulesKey())`.
        await bumpEpochs(redis, keys);
        totalDeleted += await redis.del(...keys);
      }
    } while (cursor !== '0');

    if (totalDeleted > 0) {
      logger.debug(`Cache pattern delete: ${pattern}`, { deleted: totalDeleted });
      recordCacheEvent('invalidate');
    }

    return totalDeleted;
  } catch (error) {
    logger.warn('Cache pattern delete failed', { pattern }, error as Error);
    return 0;
  }
}

/**
 * Get or set with callback (cache-aside pattern)
 *
 * @example
 * ```typescript
 * const devices = await getOrSet(
 *   deviceKey(id),
 *   () => DeviceV2.findById(id).lean(),
 *   { ttl: CACHE_TTL.DEVICE }
 * );
 * ```
 */
export async function getOrSet<T>(
  key: string,
  fetchFn: () => Promise<T>,
  options: CacheOptions
): Promise<T> {
  // Layer 1 snapshot, BEFORE the read: any invalidation from this point on
  // describes a mutation that `fresh` below may not contain.
  const snapshot = invalidationGeneration;

  // Try cache first
  const cached = await get<T>(key);
  if (cached !== null) return cached;

  // Layer 2 snapshot. Taken only on a MISS — a hit never writes, so the hot
  // path pays nothing — but before the fetch, so every invalidation this fetch
  // could fail to observe is one that lands after this read. That ordering is
  // sound because invalidations run AFTER their database mutation commits (see
  // the layer 2 header): a fetch starting after a bump reads post-mutation data.
  const observedEpoch = await readEpoch(key);

  // Fetch fresh data
  const fresh = await fetchFn();

  // The value is now known to predate any invalidation recorded since the
  // snapshot — writing it would resurrect the pre-mutation state under a fresh
  // TTL. Return it to THIS caller (it is what the fetch produced and the caller
  // is already committed to it) but do not publish it to everyone else.
  if (wasInvalidatedSince(key, snapshot)) {
    logger.debug('Cache write skipped: invalidated while the fetch was in flight', { key });
    return fresh;
  }

  // Cache the result (non-blocking). The epoch check is re-done inside the CAS
  // server-side, so unlike layer 1 this does not depend on the check and the
  // write sharing a synchronous turn — nothing can land between them at all.
  commitIfEpochUnchanged(key, fresh, options, observedEpoch).catch((err) => {
    logger.warn('Cache set failed in getOrSet', { key, error: err instanceof Error ? err.message : String(err) });
  });

  return fresh;
}

/**
 * Check if a key exists in cache
 */
export async function exists(key: string): Promise<boolean> {
  if (!isCacheEnabled()) return false;

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return false;

  try {
    return (await redis.exists(key)) === 1;
  } catch {
    return false;
  }
}

/**
 * Get TTL remaining for a key (in seconds)
 * Returns -1 if key exists but has no TTL, -2 if key doesn't exist
 */
export async function ttl(key: string): Promise<number> {
  if (!isCacheEnabled()) return -2;

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return -2;

  try {
    return await redis.ttl(key);
  } catch {
    return -2;
  }
}

/**
 * Set multiple values at once (useful for warming cache)
 */
export async function mset(
  entries: Array<{ key: string; value: unknown; ttl: number }>
): Promise<number> {
  if (!isCacheEnabled() || entries.length === 0) return 0;

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return 0;

  try {
    const pipeline = redis.pipeline();

    for (const entry of entries) pipeline.setex(entry.key, entry.ttl, JSON.stringify(entry.value));

    await pipeline.exec();
    return entries.length;
  } catch (error) {
    logger.warn('Cache mset failed', { count: entries.length }, error as Error);
    return 0;
  }
}
