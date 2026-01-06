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
  /** Health analytics - 30 seconds (frequently updated) */
  HEALTH: parseInt(process.env.CACHE_HEALTH_TTL || '30', 10),
  /** Individual device config - 5 minutes */
  DEVICE: 300,
  /** Latest readings - 10 seconds (very dynamic) */
  READINGS_LATEST: 10,
  /** Analytics data - 1 minute */
  ANALYTICS: 60,
  /** Device lists - 30 seconds */
  DEVICES_LIST: 30,
} as const;

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
export async function set<T>(
  key: string,
  value: T,
  options: CacheOptions
): Promise<boolean> {
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

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return 0;

  try {
    const deleted = await redis.del(...keys);

    if (deleted > 0) {
      recordCacheEvent('invalidate');
    }

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

  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return 0;

  try {
    let cursor = '0';
    let totalDeleted = 0;

    // Use SCAN to find keys matching pattern (non-blocking)
    do {
      const [newCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = newCursor;

      if (keys.length > 0) {
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
  // Try cache first
  const cached = await get<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Fetch fresh data
  const fresh = await fetchFn();

  // Cache the result (non-blocking)
  set(key, fresh, options).catch(() => {
    // Error already logged in set()
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

    for (const entry of entries) {
      pipeline.setex(entry.key, entry.ttl, JSON.stringify(entry.value));
    }

    await pipeline.exec();
    return entries.length;
  } catch (error) {
    logger.warn('Cache mset failed', { count: entries.length }, error as Error);
    return 0;
  }
}
