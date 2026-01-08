/**
 * Rate Limiter Tests
 *
 * Tests for sliding window rate limiting functionality.
 */

import {
  checkRateLimit,
  checkMultipleRateLimits,
  resetRateLimit,
  getRateLimitStatus,
  type RateLimitResult,
} from '@/lib/ratelimit/limiter';
import type { RateLimitConfig } from '@/lib/ratelimit/config';
import * as redisModule from '@/lib/redis/client';
import { resetMetrics } from '@/lib/monitoring/metrics';

// Mock the Redis client module
jest.mock('@/lib/redis/client', () => ({
  getRedisClient: jest.fn(),
  isRedisAvailable: jest.fn(),
}));

// Mock logger to suppress output during tests
jest.mock('@/lib/monitoring/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    rateLimit: jest.fn(),
  },
}));

// Mock metrics to verify rate limit hits are recorded
jest.mock('@/lib/monitoring/metrics', () => ({
  recordRateLimitHit: jest.fn(),
  resetMetrics: jest.fn(),
}));

describe('Rate Limiter', () => {
  const testConfig: RateLimitConfig = {
    name: 'test-limit',
    max: 10,
    windowSeconds: 60,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();
  });

  // ==========================================================================
  // checkRateLimit()
  // ==========================================================================

  describe('checkRateLimit()', () => {
    describe('Graceful degradation', () => {
      it('should allow all requests when Redis client is null', async () => {
        (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

        const result = await checkRateLimit('test-user', testConfig);

        expect(result).toEqual({
          allowed: true,
          current: 0,
          limit: 10,
          resetIn: 0,
          remaining: 10,
        });
      });

      it('should allow all requests when Redis is not available', async () => {
        const mockRedis = {};
        (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
        (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(false);

        const result = await checkRateLimit('test-user', testConfig);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10);
      });
    });

    describe('Rate limiting logic', () => {
      it('should allow request when under limit', async () => {
        const mockPipeline = {
          zremrangebyscore: jest.fn().mockReturnThis(),
          zcard: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([
            [null, 0], // zremrangebyscore result
            [null, 5], // zcard result - 5 requests in window
            [null, 1], // zadd result
            [null, 1], // expire result
          ]),
        };
        const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
        (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
        (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

        const result = await checkRateLimit('test-user', testConfig);

        expect(result.allowed).toBe(true);
        expect(result.current).toBe(6); // 5 + 1 for current request
        expect(result.limit).toBe(10);
        expect(result.remaining).toBe(4); // 10 - 6 = 4
      });

      it('should deny request when at limit', async () => {
        const mockPipeline = {
          zremrangebyscore: jest.fn().mockReturnThis(),
          zcard: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([
            [null, 0],
            [null, 10], // At limit
            [null, 1],
            [null, 1],
          ]),
        };
        const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
        (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
        (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

        const result = await checkRateLimit('test-user', testConfig);

        expect(result.allowed).toBe(false);
        expect(result.current).toBe(11);
        expect(result.remaining).toBe(0);
        expect(result.retryAfter).toBe(60);
      });

      it('should deny request when over limit', async () => {
        const mockPipeline = {
          zremrangebyscore: jest.fn().mockReturnThis(),
          zcard: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([
            [null, 0],
            [null, 15], // Over limit
            [null, 1],
            [null, 1],
          ]),
        };
        const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
        (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
        (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

        const result = await checkRateLimit('test-user', testConfig);

        expect(result.allowed).toBe(false);
        expect(result.retryAfter).toBeDefined();
      });

      it('should use correct Redis key format', async () => {
        const mockPipeline = {
          zremrangebyscore: jest.fn().mockReturnThis(),
          zcard: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([
            [null, 0],
            [null, 0],
            [null, 1],
            [null, 1],
          ]),
        };
        const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
        (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
        (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

        await checkRateLimit('192.168.1.1', testConfig);

        // Key should be in format ratelimit:{config.name}:{identifier}
        expect(mockPipeline.zremrangebyscore).toHaveBeenCalled();
        expect(mockPipeline.expire).toHaveBeenCalledWith(
          'ratelimit:test-limit:192.168.1.1',
          70 // windowSeconds + 10 buffer
        );
      });
    });

    describe('Error handling', () => {
      it('should fail open on pipeline error', async () => {
        const mockPipeline = {
          zremrangebyscore: jest.fn().mockReturnThis(),
          zcard: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockRejectedValue(new Error('Redis error')),
        };
        const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
        (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
        (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

        const result = await checkRateLimit('test-user', testConfig);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10);
      });

      it('should fail open when pipeline returns null', async () => {
        const mockPipeline = {
          zremrangebyscore: jest.fn().mockReturnThis(),
          zcard: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(null),
        };
        const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
        (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
        (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

        const result = await checkRateLimit('test-user', testConfig);

        expect(result.allowed).toBe(true);
      });
    });
  });

  // ==========================================================================
  // checkMultipleRateLimits()
  // ==========================================================================

  describe('checkMultipleRateLimits()', () => {
    it('should return allowed with infinity when no limits provided', async () => {
      const result = await checkMultipleRateLimits([]);

      expect(result).toEqual({
        allowed: true,
        current: 0,
        limit: Infinity,
        resetIn: 0,
        remaining: Infinity,
      });
    });

    it('should return first denied result when any limit exceeded', async () => {
      // Mock two different rate limit checks
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn()
          .mockResolvedValueOnce([
            [null, 0],
            [null, 5], // First limit: 5 requests (allowed)
            [null, 1],
            [null, 1],
          ])
          .mockResolvedValueOnce([
            [null, 0],
            [null, 20], // Second limit: 20 requests (denied if limit is 10)
            [null, 1],
            [null, 1],
          ]),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const ipConfig: RateLimitConfig = { name: 'ip-limit', max: 100, windowSeconds: 60 };
      const deviceConfig: RateLimitConfig = { name: 'device-limit', max: 10, windowSeconds: 60 };

      const result = await checkMultipleRateLimits([
        { identifier: '192.168.1.1', config: ipConfig },
        { identifier: 'device_001', config: deviceConfig },
      ]);

      expect(result.allowed).toBe(false);
    });

    it('should return result with highest usage ratio when all allowed', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn()
          .mockResolvedValueOnce([
            [null, 0],
            [null, 5], // 5/100 = 5% usage
            [null, 1],
            [null, 1],
          ])
          .mockResolvedValueOnce([
            [null, 0],
            [null, 8], // 8/10 = 80% usage (higher)
            [null, 1],
            [null, 1],
          ]),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const ipConfig: RateLimitConfig = { name: 'ip-limit', max: 100, windowSeconds: 60 };
      const deviceConfig: RateLimitConfig = { name: 'device-limit', max: 10, windowSeconds: 60 };

      const result = await checkMultipleRateLimits([
        { identifier: '192.168.1.1', config: ipConfig },
        { identifier: 'device_001', config: deviceConfig },
      ]);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10); // Should be the device limit (higher usage)
    });
  });

  // ==========================================================================
  // resetRateLimit()
  // ==========================================================================

  describe('resetRateLimit()', () => {
    it('should return false when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await resetRateLimit('test-user', 'test-limit');

      expect(result).toBe(false);
    });

    it('should delete rate limit key successfully', async () => {
      const mockRedis = { del: jest.fn().mockResolvedValue(1) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await resetRateLimit('test-user', 'test-limit');

      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('ratelimit:test-limit:test-user');
    });

    it('should return false on Redis error', async () => {
      const mockRedis = { del: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await resetRateLimit('test-user', 'test-limit');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // getRateLimitStatus()
  // ==========================================================================

  describe('getRateLimitStatus()', () => {
    it('should return default status when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await getRateLimitStatus('test-user', testConfig);

      expect(result).toEqual({
        allowed: true,
        current: 0,
        limit: 10,
        resetIn: 0,
        remaining: 10,
      });
    });

    it('should return current status without incrementing', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 7], // 7 requests in window
        ]),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await getRateLimitStatus('test-user', testConfig);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(7);
      expect(result.remaining).toBe(3); // 10 - 7 = 3
      // Should NOT have zadd call (no increment)
      expect(mockPipeline.zcard).toHaveBeenCalled();
    });

    it('should return not allowed when at limit', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 10], // At limit
        ]),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await getRateLimitStatus('test-user', testConfig);

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(10);
      expect(result.remaining).toBe(0);
    });

    it('should return default status on error', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Redis error')),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await getRateLimitStatus('test-user', testConfig);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
    });
  });
});
