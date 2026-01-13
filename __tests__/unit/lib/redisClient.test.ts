/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Redis Client Tests
 *
 * Tests for Redis client singleton and utility functions.
 */

describe('Redis Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...originalEnv };
    // Reset global cache
    delete (global as unknown as { redis: unknown }).redis;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ==========================================================================
  // getRedisClient()
  // ==========================================================================

  describe('getRedisClient()', () => {
    it('should return null when REDIS_URL is not configured', () => {
      delete process.env.REDIS_URL;

      const { getRedisClient } = require('@/lib/redis/client');
      const client = getRedisClient();

      expect(client).toBeNull();
    });

    it('should create a client when REDIS_URL is configured', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      // Mock ioredis before requiring the module
      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn(),
          disconnect: jest.fn(),
        }));
      });

      const { getRedisClient } = require('@/lib/redis/client');
      const client = getRedisClient();

      expect(client).not.toBeNull();
    });

    it('should return cached client on subsequent calls', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn(),
          disconnect: jest.fn(),
        }));
      });

      const { getRedisClient } = require('@/lib/redis/client');
      const client1 = getRedisClient();
      const client2 = getRedisClient();

      // Both calls should return the same client instance
      expect(client1).toBe(client2);
    });

    it('should handle TLS configuration for rediss:// URLs', () => {
      process.env.REDIS_URL = 'rediss://localhost:6379';

      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn(),
          disconnect: jest.fn(),
        }));
      });

      const { getRedisClient } = require('@/lib/redis/client');
      const client = getRedisClient();

      expect(client).not.toBeNull();
    });

    it('should handle REDIS_TLS environment variable', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.REDIS_TLS = 'true';

      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn(),
          disconnect: jest.fn(),
        }));
      });

      const { getRedisClient } = require('@/lib/redis/client');
      const client = getRedisClient();

      expect(client).not.toBeNull();
    });
  });

  // ==========================================================================
  // isRedisAvailable()
  // ==========================================================================

  describe('isRedisAvailable()', () => {
    it('should return false when redis is not initialized', () => {
      const { isRedisAvailable } = require('@/lib/redis/client');
      expect(isRedisAvailable()).toBe(false);
    });

    it('should return false when client exists but not connected', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn(),
          disconnect: jest.fn(),
        }));
      });

      const { getRedisClient, isRedisAvailable } = require('@/lib/redis/client');
      getRedisClient(); // Initialize client

      // Connection status defaults to false
      expect(isRedisAvailable()).toBe(false);
    });
  });

  // ==========================================================================
  // waitForRedis()
  // ==========================================================================

  describe('waitForRedis()', () => {
    it('should return false when no REDIS_URL configured', async () => {
      delete process.env.REDIS_URL;

      const { waitForRedis } = require('@/lib/redis/client');
      const result = await waitForRedis(100);

      expect(result).toBe(false);
    });

    it('should timeout if connection takes too long', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn(),
          disconnect: jest.fn(),
        }));
      });

      const { getRedisClient, waitForRedis } = require('@/lib/redis/client');
      getRedisClient(); // Initialize client

      const result = await waitForRedis(50);

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // closeRedisConnection()
  // ==========================================================================

  describe('closeRedisConnection()', () => {
    it('should do nothing when no client exists', async () => {
      const { closeRedisConnection } = require('@/lib/redis/client');
      await expect(closeRedisConnection()).resolves.toBeUndefined();
    });

    it('should close the connection when client exists', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const mockQuit = jest.fn().mockResolvedValue(undefined);
      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: mockQuit,
          disconnect: jest.fn(),
        }));
      });

      const {
        getRedisClient,
        closeRedisConnection,
        isRedisAvailable,
      } = require('@/lib/redis/client');
      getRedisClient(); // Create client

      await closeRedisConnection();

      // Should reset the global cache
      expect(isRedisAvailable()).toBe(false);
    });

    it('should force disconnect if quit fails', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const mockDisconnect = jest.fn();
      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn().mockRejectedValue(new Error('Quit failed')),
          disconnect: mockDisconnect,
        }));
      });

      const { getRedisClient, closeRedisConnection } = require('@/lib/redis/client');
      getRedisClient();

      await closeRedisConnection();

      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // safeRedisCommand()
  // ==========================================================================

  describe('safeRedisCommand()', () => {
    it('should return null when Redis client is not available', async () => {
      delete process.env.REDIS_URL;

      const { safeRedisCommand } = require('@/lib/redis/client');
      const result = await safeRedisCommand(
        async (client: { get: (key: string) => Promise<string> }) => {
          return client.get('key');
        }
      );

      expect(result).toBeNull();
    });

    it('should return null when Redis is not connected', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      jest.doMock('ioredis', () => {
        return jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          connect: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn(),
          disconnect: jest.fn(),
          get: jest.fn(),
        }));
      });

      const { getRedisClient, safeRedisCommand } = require('@/lib/redis/client');
      getRedisClient();

      // isRedisAvailable returns false by default
      const result = await safeRedisCommand(
        async (client: { get: (key: string) => Promise<string> }) => {
          return client.get('key');
        }
      );

      expect(result).toBeNull();
    });
  });
});
