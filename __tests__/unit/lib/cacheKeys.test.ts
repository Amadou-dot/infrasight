/**
 * Cache Keys Tests
 *
 * Tests for cache key generators and patterns.
 */

import {
  CACHE_PREFIXES,
  deviceKey,
  devicesListKey,
  metadataKey,
  healthKey,
  latestReadingsKey,
  analyticsKey,
  devicePattern,
  devicesListPattern,
  metadataPattern,
  healthPattern,
  readingsPattern,
  analyticsPattern,
} from '@/lib/cache/keys';

describe('Cache Keys', () => {
  // ==========================================================================
  // CACHE_PREFIXES
  // ==========================================================================

  describe('CACHE_PREFIXES', () => {
    it('should define all cache prefixes', () => {
      expect(CACHE_PREFIXES.DEVICE).toBe('device');
      expect(CACHE_PREFIXES.DEVICES_LIST).toBe('devices:list');
      expect(CACHE_PREFIXES.METADATA).toBe('metadata');
      expect(CACHE_PREFIXES.HEALTH).toBe('health');
      expect(CACHE_PREFIXES.READINGS_LATEST).toBe('readings:latest');
      expect(CACHE_PREFIXES.ANALYTICS).toBe('analytics');
    });
  });

  // ==========================================================================
  // Key Generators
  // ==========================================================================

  describe('deviceKey()', () => {
    it('should generate key for device', () => {
      const key = deviceKey('device_001');

      expect(key).toBe('device:device_001');
    });

    it('should handle various device ID formats', () => {
      expect(deviceKey('123')).toBe('device:123');
      expect(deviceKey('sensor-temp-001')).toBe('device:sensor-temp-001');
    });
  });

  describe('devicesListKey()', () => {
    it('should generate default key without filters', () => {
      const key = devicesListKey();

      expect(key).toBe('devices:list:default');
    });

    it('should generate key with single filter', () => {
      const key = devicesListKey({ status: 'active' });

      expect(key).toBe('devices:list:status:active');
    });

    it('should generate key with multiple filters sorted alphabetically', () => {
      const key = devicesListKey({ status: 'active', floor: 1, type: 'temperature' });

      expect(key).toBe('devices:list:floor:1:status:active:type:temperature');
    });

    it('should exclude undefined and null values', () => {
      const key = devicesListKey({ status: 'active', floor: undefined, type: null });

      expect(key).toBe('devices:list:status:active');
    });

    it('should handle empty filters object', () => {
      const key = devicesListKey({});

      expect(key).toBe('devices:list:default');
    });
  });

  describe('metadataKey()', () => {
    it('should generate default key without params', () => {
      const key = metadataKey();

      expect(key).toBe('metadata:default');
    });

    it('should generate key with params', () => {
      const key = metadataKey({ include: 'buildings' });

      expect(key).toBe('metadata:include:buildings');
    });
  });

  describe('healthKey()', () => {
    it('should generate default key without filters', () => {
      const key = healthKey();

      expect(key).toBe('health:default');
    });

    it('should generate key with filters', () => {
      const key = healthKey({ building: 'HQ', floor: 2 });

      expect(key).toBe('health:building:HQ:floor:2');
    });
  });

  describe('latestReadingsKey()', () => {
    it('should generate key with no device IDs or types', () => {
      const key = latestReadingsKey();

      expect(key).toBe('readings:latest:devices:all:types:all');
    });

    it('should generate key with device IDs', () => {
      const key = latestReadingsKey(['device_001', 'device_002']);

      expect(key).toContain('devices:device_001,device_002');
    });

    it('should generate key with types', () => {
      const key = latestReadingsKey([], ['temperature', 'humidity']);

      expect(key).toContain('types:humidity,temperature');
    });

    it('should sort device IDs and types for consistency', () => {
      const key1 = latestReadingsKey(['b', 'a'], ['temp', 'co2']);
      const key2 = latestReadingsKey(['a', 'b'], ['co2', 'temp']);

      expect(key1).toBe(key2);
    });

    it('should handle empty arrays', () => {
      const key = latestReadingsKey([], []);

      expect(key).toBe('readings:latest:devices:all:types:all');
    });
  });

  describe('analyticsKey()', () => {
    it('should generate key with endpoint', () => {
      const key = analyticsKey('anomalies');

      expect(key).toBe('analytics:anomalies:default');
    });

    it('should generate key with endpoint and params', () => {
      const key = analyticsKey('energy', { startTime: '2024-01-01', endTime: '2024-01-31' });

      expect(key).toContain('analytics:energy:');
      expect(key).toContain('endTime:2024-01-31');
      expect(key).toContain('startTime:2024-01-01');
    });
  });

  // ==========================================================================
  // Pattern Generators
  // ==========================================================================

  describe('Pattern Generators', () => {
    it('devicePattern() should generate wildcard pattern', () => {
      expect(devicePattern()).toBe('device:*');
    });

    it('devicesListPattern() should generate wildcard pattern', () => {
      expect(devicesListPattern()).toBe('devices:list:*');
    });

    it('metadataPattern() should generate wildcard pattern', () => {
      expect(metadataPattern()).toBe('metadata:*');
    });

    it('healthPattern() should generate wildcard pattern', () => {
      expect(healthPattern()).toBe('health:*');
    });

    it('readingsPattern() should generate wildcard pattern', () => {
      expect(readingsPattern()).toBe('readings:latest:*');
    });

    it('analyticsPattern() should generate wildcard pattern', () => {
      expect(analyticsPattern()).toBe('analytics:*');
    });
  });
});
