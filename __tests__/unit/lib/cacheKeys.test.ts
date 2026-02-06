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

const TEST_ORG = 'org_test_123';

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
    it('should generate key for device with org prefix', () => {
      const key = deviceKey(TEST_ORG, 'device_001');

      expect(key).toBe(`org:${TEST_ORG}:device:device_001`);
    });

    it('should handle various device ID formats', () => {
      expect(deviceKey(TEST_ORG, '123')).toBe(`org:${TEST_ORG}:device:123`);
      expect(deviceKey(TEST_ORG, 'sensor-temp-001')).toBe(`org:${TEST_ORG}:device:sensor-temp-001`);
    });
  });

  describe('devicesListKey()', () => {
    it('should generate default key without filters', () => {
      const key = devicesListKey(TEST_ORG);

      expect(key).toBe(`org:${TEST_ORG}:devices:list:default`);
    });

    it('should generate key with single filter', () => {
      const key = devicesListKey(TEST_ORG, { status: 'active' });

      expect(key).toBe(`org:${TEST_ORG}:devices:list:status:active`);
    });

    it('should generate key with multiple filters sorted alphabetically', () => {
      const key = devicesListKey(TEST_ORG, { status: 'active', floor: 1, type: 'temperature' });

      expect(key).toBe(`org:${TEST_ORG}:devices:list:floor:1:status:active:type:temperature`);
    });

    it('should exclude undefined and null values', () => {
      const key = devicesListKey(TEST_ORG, { status: 'active', floor: undefined, type: null });

      expect(key).toBe(`org:${TEST_ORG}:devices:list:status:active`);
    });

    it('should handle empty filters object', () => {
      const key = devicesListKey(TEST_ORG, {});

      expect(key).toBe(`org:${TEST_ORG}:devices:list:default`);
    });
  });

  describe('metadataKey()', () => {
    it('should generate default key without params', () => {
      const key = metadataKey(TEST_ORG);

      expect(key).toBe(`org:${TEST_ORG}:metadata:default`);
    });

    it('should generate key with params', () => {
      const key = metadataKey(TEST_ORG, { include: 'buildings' });

      expect(key).toBe(`org:${TEST_ORG}:metadata:include:buildings`);
    });
  });

  describe('healthKey()', () => {
    it('should generate default key without filters', () => {
      const key = healthKey(TEST_ORG);

      expect(key).toBe(`org:${TEST_ORG}:health:default`);
    });

    it('should generate key with filters', () => {
      const key = healthKey(TEST_ORG, { building: 'HQ', floor: 2 });

      expect(key).toBe(`org:${TEST_ORG}:health:building:HQ:floor:2`);
    });
  });

  describe('latestReadingsKey()', () => {
    it('should generate key with no device IDs or types', () => {
      const key = latestReadingsKey(TEST_ORG);

      expect(key).toBe(`org:${TEST_ORG}:readings:latest:devices:all:types:all`);
    });

    it('should generate key with device IDs', () => {
      const key = latestReadingsKey(TEST_ORG, ['device_001', 'device_002']);

      expect(key).toContain('devices:device_001,device_002');
    });

    it('should generate key with types', () => {
      const key = latestReadingsKey(TEST_ORG, [], ['temperature', 'humidity']);

      expect(key).toContain('types:humidity,temperature');
    });

    it('should sort device IDs and types for consistency', () => {
      const key1 = latestReadingsKey(TEST_ORG, ['b', 'a'], ['temp', 'co2']);
      const key2 = latestReadingsKey(TEST_ORG, ['a', 'b'], ['co2', 'temp']);

      expect(key1).toBe(key2);
    });

    it('should handle empty arrays', () => {
      const key = latestReadingsKey(TEST_ORG, [], []);

      expect(key).toBe(`org:${TEST_ORG}:readings:latest:devices:all:types:all`);
    });
  });

  describe('analyticsKey()', () => {
    it('should generate key with endpoint', () => {
      const key = analyticsKey(TEST_ORG, 'anomalies');

      expect(key).toBe(`org:${TEST_ORG}:analytics:anomalies:default`);
    });

    it('should generate key with endpoint and params', () => {
      const key = analyticsKey(TEST_ORG, 'energy', { startTime: '2024-01-01', endTime: '2024-01-31' });

      expect(key).toContain(`org:${TEST_ORG}:analytics:energy:`);
      expect(key).toContain('endTime:2024-01-31');
      expect(key).toContain('startTime:2024-01-01');
    });
  });

  // ==========================================================================
  // Pattern Generators
  // ==========================================================================

  describe('Pattern Generators', () => {
    it('devicePattern() should generate wildcard pattern with org prefix', () => {
      expect(devicePattern(TEST_ORG)).toBe(`org:${TEST_ORG}:device:*`);
    });

    it('devicesListPattern() should generate wildcard pattern with org prefix', () => {
      expect(devicesListPattern(TEST_ORG)).toBe(`org:${TEST_ORG}:devices:list:*`);
    });

    it('metadataPattern() should generate wildcard pattern with org prefix', () => {
      expect(metadataPattern(TEST_ORG)).toBe(`org:${TEST_ORG}:metadata:*`);
    });

    it('healthPattern() should generate wildcard pattern with org prefix', () => {
      expect(healthPattern(TEST_ORG)).toBe(`org:${TEST_ORG}:health:*`);
    });

    it('readingsPattern() should generate wildcard pattern with org prefix', () => {
      expect(readingsPattern(TEST_ORG)).toBe(`org:${TEST_ORG}:readings:latest:*`);
    });

    it('analyticsPattern() should generate wildcard pattern with org prefix', () => {
      expect(analyticsPattern(TEST_ORG)).toBe(`org:${TEST_ORG}:analytics:*`);
    });
  });

  // ==========================================================================
  // Org Isolation
  // ==========================================================================

  describe('Org Isolation', () => {
    it('should generate different keys for different orgs', () => {
      const key1 = devicesListKey('org_a', { status: 'active' });
      const key2 = devicesListKey('org_b', { status: 'active' });

      expect(key1).not.toBe(key2);
      expect(key1).toContain('org:org_a:');
      expect(key2).toContain('org:org_b:');
    });

    it('should generate different patterns for different orgs', () => {
      const pattern1 = devicePattern('org_a');
      const pattern2 = devicePattern('org_b');

      expect(pattern1).not.toBe(pattern2);
    });
  });
});
