/**
 * Cache Invalidation Tests
 *
 * Tests for cache invalidation strategies.
 */

import {
  invalidateDevice,
  invalidateAllDevices,
  invalidateOnDeviceCreate,
  invalidateReadings,
  invalidateDeviceReadings,
  invalidateHealthCache,
  invalidateMetadata,
  clearAllCaches,
} from '@/lib/cache/invalidation';
import * as cacheModule from '@/lib/cache/cache';

// Mock the cache module
jest.mock('@/lib/cache/cache', () => ({
  del: jest.fn().mockResolvedValue(1),
  delPattern: jest.fn().mockResolvedValue(5),
}));

// Mock the cache keys module
jest.mock('@/lib/cache/keys', () => ({
  deviceKey: jest.fn((id: string) => `device:${id}`),
  devicesListPattern: jest.fn(() => 'devices:list:*'),
  metadataPattern: jest.fn(() => 'metadata:*'),
  healthPattern: jest.fn(() => 'health:*'),
  readingsPattern: jest.fn(() => 'readings:*'),
}));

// Mock logger to suppress output during tests
jest.mock('@/lib/monitoring/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

describe('Cache Invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // DEVICE INVALIDATION
  // ==========================================================================

  describe('invalidateDevice()', () => {
    it('should invalidate specific device and related caches', async () => {
      await invalidateDevice('device_001');

      expect(cacheModule.del).toHaveBeenCalledWith('device:device_001');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('devices:list:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('metadata:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('health:*');
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.del as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      // Should not throw
      await expect(invalidateDevice('device_001')).resolves.not.toThrow();
    });
  });

  describe('invalidateAllDevices()', () => {
    it('should invalidate all device-related caches', async () => {
      await invalidateAllDevices();

      expect(cacheModule.delPattern).toHaveBeenCalledWith('device:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('devices:list:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('metadata:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('health:*');
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateAllDevices()).resolves.not.toThrow();
    });
  });

  describe('invalidateOnDeviceCreate()', () => {
    it('should invalidate lists and metadata but not specific devices', async () => {
      await invalidateOnDeviceCreate();

      expect(cacheModule.delPattern).toHaveBeenCalledWith('devices:list:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('metadata:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('health:*');
      // Should NOT invalidate individual device caches
      expect(cacheModule.delPattern).not.toHaveBeenCalledWith('device:*');
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateOnDeviceCreate()).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // READINGS INVALIDATION
  // ==========================================================================

  describe('invalidateReadings()', () => {
    it('should invalidate readings and health caches', async () => {
      await invalidateReadings();

      expect(cacheModule.delPattern).toHaveBeenCalledWith('readings:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('health:*');
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateReadings()).resolves.not.toThrow();
    });
  });

  describe('invalidateDeviceReadings()', () => {
    it('should invalidate readings cache for specific devices', async () => {
      await invalidateDeviceReadings(['device_001', 'device_002']);

      expect(cacheModule.delPattern).toHaveBeenCalledWith('readings:*');
    });

    it('should do nothing when device IDs array is empty', async () => {
      await invalidateDeviceReadings([]);

      expect(cacheModule.delPattern).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateDeviceReadings(['device_001'])).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // HEALTH INVALIDATION
  // ==========================================================================

  describe('invalidateHealthCache()', () => {
    it('should invalidate health cache', async () => {
      await invalidateHealthCache();

      expect(cacheModule.delPattern).toHaveBeenCalledWith('health:*');
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateHealthCache()).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // METADATA INVALIDATION
  // ==========================================================================

  describe('invalidateMetadata()', () => {
    it('should invalidate metadata cache', async () => {
      await invalidateMetadata();

      expect(cacheModule.delPattern).toHaveBeenCalledWith('metadata:*');
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateMetadata()).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // FULL CACHE CLEAR
  // ==========================================================================

  describe('clearAllCaches()', () => {
    it('should clear all application caches', async () => {
      await clearAllCaches();

      expect(cacheModule.delPattern).toHaveBeenCalledWith('device:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('devices:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('metadata:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('health:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('readings:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('analytics:*');
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(clearAllCaches()).resolves.not.toThrow();
    });
  });
});
