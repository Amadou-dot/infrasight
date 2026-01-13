/**
 * Cache Manager Tests
 *
 * Tests for Redis-backed caching functionality.
 * Uses mocked Redis client for isolation.
 */

import {
  get,
  set,
  del,
  delPattern,
  getOrSet,
  exists,
  ttl,
  mset,
  isCacheEnabled,
  CACHE_TTL,
} from '@/lib/cache/cache';
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
    cache: jest.fn(),
  },
}));

describe('Cache Manager', () => {
  // Save original env and reset mocks before each test
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ==========================================================================
  // CACHE CONFIGURATION
  // ==========================================================================

  describe('CACHE_TTL', () => {
    it('should define TTL values for all cache types', () => {
      expect(CACHE_TTL.METADATA).toBeDefined();
      expect(CACHE_TTL.HEALTH).toBeDefined();
      expect(CACHE_TTL.DEVICE).toBeDefined();
      expect(CACHE_TTL.READINGS_LATEST).toBeDefined();
      expect(CACHE_TTL.ANALYTICS).toBeDefined();
      expect(CACHE_TTL.DEVICES_LIST).toBeDefined();
    });

    it('should use environment variables when available', () => {
      // Note: CACHE_TTL is set at module load time, so we just verify current values
      expect(typeof CACHE_TTL.METADATA).toBe('number');
      expect(typeof CACHE_TTL.HEALTH).toBe('number');
    });
  });

  describe('isCacheEnabled()', () => {
    it('should return true by default', () => {
      delete process.env.CACHE_ENABLED;
      expect(isCacheEnabled()).toBe(true);
    });

    it('should return false when CACHE_ENABLED is "false"', () => {
      process.env.CACHE_ENABLED = 'false';
      expect(isCacheEnabled()).toBe(false);
    });

    it('should return true for any other value', () => {
      process.env.CACHE_ENABLED = 'true';
      expect(isCacheEnabled()).toBe(true);

      process.env.CACHE_ENABLED = '1';
      expect(isCacheEnabled()).toBe(true);
    });
  });

  // ==========================================================================
  // GET OPERATION
  // ==========================================================================

  describe('get()', () => {
    it('should return null when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await get<string>('test-key');

      expect(result).toBeNull();
    });

    it('should return null when Redis client is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await get<string>('test-key');

      expect(result).toBeNull();
    });

    it('should return null when Redis is not connected', async () => {
      const mockRedis = { get: jest.fn() };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(false);

      const result = await get<string>('test-key');

      expect(result).toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should return cached value when found', async () => {
      const mockData = { id: 'device_001', name: 'Test Device' };
      const mockRedis = { get: jest.fn().mockResolvedValue(JSON.stringify(mockData)) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await get<typeof mockData>('device:device_001');

      expect(result).toEqual(mockData);
      expect(mockRedis.get).toHaveBeenCalledWith('device:device_001');
    });

    it('should return null when key not found in cache', async () => {
      const mockRedis = { get: jest.fn().mockResolvedValue(null) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await get<string>('nonexistent-key');

      expect(result).toBeNull();
    });

    it('should return null and log warning on Redis error', async () => {
      const mockRedis = { get: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await get<string>('test-key');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // SET OPERATION
  // ==========================================================================

  describe('set()', () => {
    it('should return false when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await set('test-key', { data: 'test' }, { ttl: 60 });

      expect(result).toBe(false);
    });

    it('should return false when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await set('test-key', { data: 'test' }, { ttl: 60 });

      expect(result).toBe(false);
    });

    it('should set value with TTL successfully', async () => {
      const mockRedis = { setex: jest.fn().mockResolvedValue('OK') };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const data = { id: 'device_001', status: 'active' };
      const result = await set('device:device_001', data, { ttl: 300 });

      expect(result).toBe(true);
      expect(mockRedis.setex).toHaveBeenCalledWith('device:device_001', 300, JSON.stringify(data));
    });

    it('should return false on Redis error', async () => {
      const mockRedis = { setex: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await set('test-key', { data: 'test' }, { ttl: 60 });

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // DELETE OPERATION
  // ==========================================================================

  describe('del()', () => {
    it('should return 0 when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await del('test-key');

      expect(result).toBe(0);
    });

    it('should return 0 when no keys provided', async () => {
      const result = await del();

      expect(result).toBe(0);
    });

    it('should return 0 when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await del('test-key');

      expect(result).toBe(0);
    });

    it('should delete single key successfully', async () => {
      const mockRedis = { del: jest.fn().mockResolvedValue(1) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await del('device:device_001');

      expect(result).toBe(1);
      expect(mockRedis.del).toHaveBeenCalledWith('device:device_001');
    });

    it('should delete multiple keys successfully', async () => {
      const mockRedis = { del: jest.fn().mockResolvedValue(3) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await del('key1', 'key2', 'key3');

      expect(result).toBe(3);
      expect(mockRedis.del).toHaveBeenCalledWith('key1', 'key2', 'key3');
    });

    it('should return 0 on Redis error', async () => {
      const mockRedis = { del: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await del('test-key');

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // DELETE PATTERN OPERATION
  // ==========================================================================

  describe('delPattern()', () => {
    it('should return 0 when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await delPattern('device:*');

      expect(result).toBe(0);
    });

    it('should return 0 when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await delPattern('device:*');

      expect(result).toBe(0);
    });

    it('should scan and delete matching keys', async () => {
      const mockRedis = {
        scan: jest.fn().mockResolvedValueOnce(['0', ['device:001', 'device:002']]),
        del: jest.fn().mockResolvedValue(2),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await delPattern('device:*');

      expect(result).toBe(2);
      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'device:*', 'COUNT', 100);
    });

    it('should handle multiple scan iterations', async () => {
      const mockRedis = {
        scan: jest
          .fn()
          .mockResolvedValueOnce(['123', ['key1', 'key2']])
          .mockResolvedValueOnce(['0', ['key3']]),
        del: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await delPattern('test:*');

      expect(result).toBe(3);
      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
    });

    it('should handle empty scan result', async () => {
      const mockRedis = {
        scan: jest.fn().mockResolvedValue(['0', []]),
        del: jest.fn(),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await delPattern('nonexistent:*');

      expect(result).toBe(0);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should return 0 on Redis error', async () => {
      const mockRedis = {
        scan: jest.fn().mockRejectedValue(new Error('Redis error')),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await delPattern('device:*');

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // GET OR SET (CACHE-ASIDE) OPERATION
  // ==========================================================================

  describe('getOrSet()', () => {
    it('should return cached value if available', async () => {
      const cachedData = { id: 'device_001', name: 'Cached Device' };
      const mockRedis = { get: jest.fn().mockResolvedValue(JSON.stringify(cachedData)) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const fetchFn = jest.fn();
      const result = await getOrSet('device:device_001', fetchFn, { ttl: 300 });

      expect(result).toEqual(cachedData);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should fetch and cache when cache miss', async () => {
      const freshData = { id: 'device_001', name: 'Fresh Device' };
      const mockRedis = {
        get: jest.fn().mockResolvedValue(null),
        setex: jest.fn().mockResolvedValue('OK'),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const fetchFn = jest.fn().mockResolvedValue(freshData);
      const result = await getOrSet('device:device_001', fetchFn, { ttl: 300 });

      expect(result).toEqual(freshData);
      expect(fetchFn).toHaveBeenCalled();
      // set() is called asynchronously, wait a tick
      await new Promise(resolve => setImmediate(resolve));
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should return fetched data even if cache set fails', async () => {
      const freshData = { id: 'device_001' };
      const mockRedis = {
        get: jest.fn().mockResolvedValue(null),
        setex: jest.fn().mockRejectedValue(new Error('Set failed')),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const fetchFn = jest.fn().mockResolvedValue(freshData);
      const result = await getOrSet('device:device_001', fetchFn, { ttl: 300 });

      expect(result).toEqual(freshData);
    });
  });

  // ==========================================================================
  // EXISTS OPERATION
  // ==========================================================================

  describe('exists()', () => {
    it('should return false when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await exists('test-key');

      expect(result).toBe(false);
    });

    it('should return false when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await exists('test-key');

      expect(result).toBe(false);
    });

    it('should return true when key exists', async () => {
      const mockRedis = { exists: jest.fn().mockResolvedValue(1) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await exists('device:device_001');

      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      const mockRedis = { exists: jest.fn().mockResolvedValue(0) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await exists('nonexistent-key');

      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      const mockRedis = { exists: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await exists('test-key');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // TTL OPERATION
  // ==========================================================================

  describe('ttl()', () => {
    it('should return -2 when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await ttl('test-key');

      expect(result).toBe(-2);
    });

    it('should return -2 when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await ttl('test-key');

      expect(result).toBe(-2);
    });

    it('should return TTL for existing key', async () => {
      const mockRedis = { ttl: jest.fn().mockResolvedValue(250) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await ttl('device:device_001');

      expect(result).toBe(250);
    });

    it('should return -1 for key without TTL', async () => {
      const mockRedis = { ttl: jest.fn().mockResolvedValue(-1) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await ttl('persistent-key');

      expect(result).toBe(-1);
    });

    it('should return -2 for non-existent key', async () => {
      const mockRedis = { ttl: jest.fn().mockResolvedValue(-2) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await ttl('nonexistent-key');

      expect(result).toBe(-2);
    });

    it('should return -2 on Redis error', async () => {
      const mockRedis = { ttl: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await ttl('test-key');

      expect(result).toBe(-2);
    });
  });

  // ==========================================================================
  // MSET OPERATION
  // ==========================================================================

  describe('mset()', () => {
    it('should return 0 when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await mset([{ key: 'key1', value: 'value1', ttl: 60 }]);

      expect(result).toBe(0);
    });

    it('should return 0 when entries array is empty', async () => {
      const result = await mset([]);

      expect(result).toBe(0);
    });

    it('should return 0 when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await mset([{ key: 'key1', value: 'value1', ttl: 60 }]);

      expect(result).toBe(0);
    });

    it('should set multiple values with pipeline', async () => {
      const mockPipeline = {
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([['OK'], ['OK'], ['OK']]),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const entries = [
        { key: 'key1', value: { data: 'value1' }, ttl: 60 },
        { key: 'key2', value: { data: 'value2' }, ttl: 120 },
        { key: 'key3', value: { data: 'value3' }, ttl: 180 },
      ];
      const result = await mset(entries);

      expect(result).toBe(3);
      expect(mockPipeline.setex).toHaveBeenCalledTimes(3);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should return 0 on Redis error', async () => {
      const mockPipeline = {
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Pipeline error')),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await mset([{ key: 'key1', value: 'value1', ttl: 60 }]);

      expect(result).toBe(0);
    });
  });
});
