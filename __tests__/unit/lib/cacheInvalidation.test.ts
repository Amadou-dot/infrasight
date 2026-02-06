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

const TEST_ORG = 'org_test_123';

// Mock the cache module
jest.mock('@/lib/cache/cache', () => ({
  del: jest.fn().mockResolvedValue(1),
  delPattern: jest.fn().mockResolvedValue(5),
}));

// Mock the cache keys module with orgId parameter
jest.mock('@/lib/cache/keys', () => ({
  deviceKey: jest.fn((orgId: string, id: string) => `org:${orgId}:device:${id}`),
  devicesListPattern: jest.fn((orgId: string) => `org:${orgId}:devices:list:*`),
  metadataPattern: jest.fn((orgId: string) => `org:${orgId}:metadata:*`),
  healthPattern: jest.fn((orgId: string) => `org:${orgId}:health:*`),
  readingsPattern: jest.fn((orgId: string) => `org:${orgId}:readings:latest:*`),
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
      await invalidateDevice(TEST_ORG, 'device_001');

      expect(cacheModule.del).toHaveBeenCalledWith(`org:${TEST_ORG}:device:device_001`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:devices:list:*`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:metadata:*`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:health:*`);
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.del as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      // Should not throw
      await expect(invalidateDevice(TEST_ORG, 'device_001')).resolves.not.toThrow();
    });
  });

  describe('invalidateAllDevices()', () => {
    it('should invalidate all device-related caches', async () => {
      await invalidateAllDevices(TEST_ORG);

      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:device:*`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:devices:list:*`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:metadata:*`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:health:*`);
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateAllDevices(TEST_ORG)).resolves.not.toThrow();
    });
  });

  describe('invalidateOnDeviceCreate()', () => {
    it('should invalidate lists and metadata but not specific devices', async () => {
      await invalidateOnDeviceCreate(TEST_ORG);

      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:devices:list:*`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:metadata:*`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:health:*`);
      // Should NOT invalidate individual device caches
      expect(cacheModule.delPattern).not.toHaveBeenCalledWith(`org:${TEST_ORG}:device:*`);
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateOnDeviceCreate(TEST_ORG)).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // READINGS INVALIDATION
  // ==========================================================================

  describe('invalidateReadings()', () => {
    it('should invalidate readings and health caches', async () => {
      await invalidateReadings(TEST_ORG);

      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:readings:latest:*`);
      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:health:*`);
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateReadings(TEST_ORG)).resolves.not.toThrow();
    });
  });

  describe('invalidateDeviceReadings()', () => {
    it('should invalidate readings cache for specific devices', async () => {
      await invalidateDeviceReadings(TEST_ORG, ['device_001', 'device_002']);

      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:readings:latest:*`);
    });

    it('should do nothing when device IDs array is empty', async () => {
      await invalidateDeviceReadings(TEST_ORG, []);

      expect(cacheModule.delPattern).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateDeviceReadings(TEST_ORG, ['device_001'])).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // HEALTH INVALIDATION
  // ==========================================================================

  describe('invalidateHealthCache()', () => {
    it('should invalidate health cache', async () => {
      await invalidateHealthCache(TEST_ORG);

      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:health:*`);
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateHealthCache(TEST_ORG)).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // METADATA INVALIDATION
  // ==========================================================================

  describe('invalidateMetadata()', () => {
    it('should invalidate metadata cache', async () => {
      await invalidateMetadata(TEST_ORG);

      expect(cacheModule.delPattern).toHaveBeenCalledWith(`org:${TEST_ORG}:metadata:*`);
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(invalidateMetadata(TEST_ORG)).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // FULL CACHE CLEAR
  // ==========================================================================

  describe('clearAllCaches()', () => {
    it('should clear all application caches', async () => {
      await clearAllCaches();

      expect(cacheModule.delPattern).toHaveBeenCalledWith('org:*:device:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('org:*:devices:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('org:*:metadata:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('org:*:health:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('org:*:readings:*');
      expect(cacheModule.delPattern).toHaveBeenCalledWith('org:*:analytics:*');
    });

    it('should handle errors gracefully', async () => {
      (cacheModule.delPattern as jest.Mock).mockRejectedValueOnce(new Error('Redis error'));

      await expect(clearAllCaches()).resolves.not.toThrow();
    });
  });
});
