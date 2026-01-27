/**
 * Sliding Window Rate Limiter
 *
 * Implements sliding window rate limiting using Redis sorted sets.
 * Falls back gracefully when Redis is unavailable (fail-open).
 *
 * Algorithm:
 * 1. Use a sorted set with timestamps as scores
 * 2. Remove entries outside the current window
 * 3. Count remaining entries
 * 4. Add new entry if under limit
 */

import { getRedisClient, isRedisAvailable } from '../redis/client';
import { logger } from '../monitoring/logger';
import { recordRateLimitHit } from '../monitoring/metrics';
import type { RateLimitConfig } from './config';

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current request count in window */
  current: number;
  /** Maximum allowed requests */
  limit: number;
  /** Seconds until window resets */
  resetIn: number;
  /** Remaining requests in window */
  remaining: number;
  /** Retry-After seconds (only set if rate limited) */
  retryAfter?: number;
}

/**
 * Check rate limit using sliding window algorithm
 *
 * @param identifier - Unique identifier (IP, device ID, API key)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const redis = getRedisClient();

  // Graceful degradation: allow all requests if Redis unavailable
  if (!redis || !isRedisAvailable()) {
    logger.debug('Rate limiter degraded: Redis unavailable', { identifier });
    return {
      allowed: true,
      current: 0,
      limit: config.max,
      resetIn: 0,
      remaining: config.max,
    };
  }

  const key = `ratelimit:${config.name}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  try {
    // Use pipeline for atomic operations
    const pipeline = redis.pipeline();

    // 1. Remove entries outside the current window
    pipeline.zremrangebyscore(key, 0, windowStart);

    // 2. Count entries in current window
    pipeline.zcard(key);

    // 3. Add current request timestamp (unique key with random suffix)
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);

    // 4. Set key expiry (window + buffer for cleanup)
    pipeline.expire(key, config.windowSeconds + 10);

    const results = await pipeline.exec();

    if (!results) throw new Error('Pipeline returned null');

    // Get current count from zcard (index 1 in pipeline)
    const currentCount = (results[1]?.[1] as number) || 0;

    const allowed = currentCount < config.max;
    const resetIn = Math.ceil(config.windowSeconds);
    const remaining = Math.max(0, config.max - currentCount - 1);

    if (!allowed) {
      // Log and record rate limit hit
      logger.rateLimit(identifier, config.name, currentCount + 1, config.max);
      recordRateLimitHit(config.name.includes('device') ? 'device' : 'ip');
    }

    return {
      allowed,
      current: currentCount + 1,
      limit: config.max,
      resetIn,
      remaining: allowed ? remaining : 0,
      retryAfter: allowed ? undefined : resetIn,
    };
  } catch (error) {
    logger.error('Rate limit check failed', { identifier, config: config.name }, error as Error);

    // Fail open - allow request if Redis operation fails
    return {
      allowed: true,
      current: 0,
      limit: config.max,
      resetIn: 0,
      remaining: config.max,
    };
  }
}

/**
 * Check multiple rate limits in parallel
 * Returns the most restrictive result (first denial or highest usage)
 *
 * @param limits - Array of identifier/config pairs to check
 * @returns Most restrictive rate limit result
 */
export async function checkMultipleRateLimits(
  limits: Array<{ identifier: string; config: RateLimitConfig }>
): Promise<RateLimitResult> {
  if (limits.length === 0)
    return {
      allowed: true,
      current: 0,
      limit: Infinity,
      resetIn: 0,
      remaining: Infinity,
    };

  // Check all limits in parallel
  const results = await Promise.all(
    limits.map(({ identifier, config }) => checkRateLimit(identifier, config))
  );

  // Find the first denied result
  const denied = results.find(r => !r.allowed);
  if (denied) return denied;

  // All allowed - return the one with highest usage ratio
  return results.reduce((prev, curr) => {
    const prevRatio = prev.current / prev.limit;
    const currRatio = curr.current / curr.limit;
    return currRatio > prevRatio ? curr : prev;
  });
}

/**
 * Reset rate limit for an identifier (for testing or admin operations)
 */
export async function resetRateLimit(identifier: string, configName: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) return false;

  try {
    const key = `ratelimit:${configName}:${identifier}`;
    await redis.del(key);
    return true;
  } catch (error) {
    logger.error('Failed to reset rate limit', { identifier, config: configName }, error as Error);
    return false;
  }
}

/**
 * Get current rate limit status without incrementing
 */
export async function getRateLimitStatus(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const redis = getRedisClient();

  if (!redis || !isRedisAvailable())
    return {
      allowed: true,
      current: 0,
      limit: config.max,
      resetIn: 0,
      remaining: config.max,
    };

  const key = `ratelimit:${config.name}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  try {
    // Clean up and count in pipeline
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);

    const results = await pipeline.exec();
    const currentCount = (results?.[1]?.[1] as number) || 0;

    return {
      allowed: currentCount < config.max,
      current: currentCount,
      limit: config.max,
      resetIn: config.windowSeconds,
      remaining: Math.max(0, config.max - currentCount),
    };
  } catch {
    return {
      allowed: true,
      current: 0,
      limit: config.max,
      resetIn: 0,
      remaining: config.max,
    };
  }
}
