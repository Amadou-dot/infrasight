/**
 * Device Validation Schema Tests
 *
 * Tests for Zod validation schemas in device.validation.ts
 */

import {
  createDeviceSchema,
  updateDeviceSchema,
  listDevicesQuerySchema,
  deviceIdParamSchema,
  deviceStatusSchema,
  deviceTypeSchema,
  deviceConfigurationSchema,
  deviceLocationSchema,
  deviceHealthSchema,
  deviceComplianceSchema,
} from '@/lib/validations/v2/device.validation';

describe('Device Validation Schemas', () => {
  // ==========================================================================
  // DEVICE STATUS SCHEMA TESTS
  // ==========================================================================

  describe('deviceStatusSchema', () => {
    it('should accept valid status values', () => {
      const validStatuses = ['active', 'maintenance', 'offline', 'decommissioned', 'error'];

      for (const status of validStatuses) {
        const result = deviceStatusSchema.safeParse(status);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toBe(status);
      }
    });

    it('should reject invalid status values', () => {
      const invalidStatuses = ['invalid', 'ACTIVE', 'Active', 'pending', ''];

      for (const status of invalidStatuses) {
        const result = deviceStatusSchema.safeParse(status);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // DEVICE TYPE SCHEMA TESTS
  // ==========================================================================

  describe('deviceTypeSchema', () => {
    it('should accept valid device types', () => {
      const validTypes = [
        'temperature',
        'humidity',
        'occupancy',
        'power',
        'co2',
        'pressure',
        'light',
        'motion',
        'air_quality',
        'water_flow',
        'gas',
        'vibration',
      ];

      for (const type of validTypes) {
        const result = deviceTypeSchema.safeParse(type);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid device types', () => {
      const invalidTypes = ['invalid', 'Temperature', 'POWER', 'door', 'window'];

      for (const type of invalidTypes) {
        const result = deviceTypeSchema.safeParse(type);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // DEVICE CONFIGURATION SCHEMA TESTS
  // ==========================================================================

  describe('deviceConfigurationSchema', () => {
    it('should accept valid configuration', () => {
      const validConfig = {
        threshold_warning: 25,
        threshold_critical: 30,
        sampling_interval: 60,
        calibration_offset: 0.5,
      };

      const result = deviceConfigurationSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should use default sampling interval', () => {
      const configWithoutInterval = {
        threshold_warning: 25,
        threshold_critical: 30,
      };

      const result = deviceConfigurationSchema.safeParse(configWithoutInterval);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.sampling_interval).toBe(60);
    });

    it('should reject invalid sampling interval', () => {
      const invalidConfigs = [
        { threshold_warning: 25, threshold_critical: 30, sampling_interval: 0 },
        { threshold_warning: 25, threshold_critical: 30, sampling_interval: 100000 },
      ];

      for (const config of invalidConfigs) {
        const result = deviceConfigurationSchema.safeParse(config);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // DEVICE LOCATION SCHEMA TESTS
  // ==========================================================================

  describe('deviceLocationSchema', () => {
    it('should accept valid location', () => {
      const validLocation = {
        building_id: 'building_001',
        floor: 5,
        room_name: 'Conference Room A',
        zone: 'East Wing',
        coordinates: { x: 100, y: 200 },
      };

      const result = deviceLocationSchema.safeParse(validLocation);
      expect(result.success).toBe(true);
    });

    it('should accept location without optional fields', () => {
      const minimalLocation = {
        building_id: 'building_001',
        floor: 1,
        room_name: 'Room 101',
      };

      const result = deviceLocationSchema.safeParse(minimalLocation);
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const invalidLocations = [
        { floor: 1, room_name: 'Room' }, // missing building_id
        { building_id: 'b1', room_name: 'Room' }, // missing floor
        { building_id: 'b1', floor: 1 }, // missing room_name
      ];

      for (const location of invalidLocations) {
        const result = deviceLocationSchema.safeParse(location);
        expect(result.success).toBe(false);
      }
    });

    it('should reject floor outside valid range', () => {
      const invalidFloors = [
        { building_id: 'b1', floor: -20, room_name: 'Room' }, // too low
        { building_id: 'b1', floor: 250, room_name: 'Room' }, // too high
      ];

      for (const location of invalidFloors) {
        const result = deviceLocationSchema.safeParse(location);
        expect(result.success).toBe(false);
      }
    });

    it('should accept valid basement floors', () => {
      const basementLocation = {
        building_id: 'building_001',
        floor: -5,
        room_name: 'Parking Level 5',
      };

      const result = deviceLocationSchema.safeParse(basementLocation);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // DEVICE HEALTH SCHEMA TESTS
  // ==========================================================================

  describe('deviceHealthSchema', () => {
    it('should accept valid health data', () => {
      const validHealth = {
        last_seen: new Date(),
        uptime_percentage: 99.5,
        error_count: 2,
        battery_level: 75,
        signal_strength: -45,
      };

      const result = deviceHealthSchema.safeParse(validHealth);
      expect(result.success).toBe(true);
    });

    it('should use defaults for missing optional fields', () => {
      const minimalHealth = {};

      const result = deviceHealthSchema.safeParse(minimalHealth);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uptime_percentage).toBe(100);
        expect(result.data.error_count).toBe(0);
      }
    });

    it('should reject battery level over 100', () => {
      const invalidHealth = {
        battery_level: 150,
      };

      const result = deviceHealthSchema.safeParse(invalidHealth);
      expect(result.success).toBe(false);
    });

    it('should reject negative battery level', () => {
      const invalidHealth = {
        battery_level: -10,
      };

      const result = deviceHealthSchema.safeParse(invalidHealth);
      expect(result.success).toBe(false);
    });

    it('should reject uptime percentage over 100', () => {
      const invalidHealth = {
        uptime_percentage: 110,
      };

      const result = deviceHealthSchema.safeParse(invalidHealth);
      expect(result.success).toBe(false);
    });

    it('should accept last_error with valid structure', () => {
      const healthWithError = {
        last_seen: new Date(),
        uptime_percentage: 95,
        error_count: 1,
        last_error: {
          timestamp: new Date(),
          message: 'Connection timeout',
          code: 'ERR_TIMEOUT',
        },
      };

      const result = deviceHealthSchema.safeParse(healthWithError);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // DEVICE COMPLIANCE SCHEMA TESTS
  // ==========================================================================

  describe('deviceComplianceSchema', () => {
    it('should accept valid compliance settings', () => {
      const validCompliance = {
        requires_encryption: true,
        data_classification: 'confidential',
        retention_days: 365,
      };

      const result = deviceComplianceSchema.safeParse(validCompliance);
      expect(result.success).toBe(true);
    });

    it('should use default values', () => {
      const emptyCompliance = {};

      const result = deviceComplianceSchema.safeParse(emptyCompliance);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.requires_encryption).toBe(false);
        expect(result.data.data_classification).toBe('internal');
        expect(result.data.retention_days).toBe(90);
      }
    });

    it('should reject invalid data classification', () => {
      const invalidCompliance = {
        data_classification: 'top_secret',
      };

      const result = deviceComplianceSchema.safeParse(invalidCompliance);
      expect(result.success).toBe(false);
    });

    it('should reject retention days less than 1', () => {
      const invalidCompliance = {
        retention_days: 0,
      };

      const result = deviceComplianceSchema.safeParse(invalidCompliance);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // CREATE DEVICE SCHEMA TESTS
  // ==========================================================================

  describe('createDeviceSchema', () => {
    const validDevice = {
      _id: 'device_001',
      serial_number: 'SN-12345',
      manufacturer: 'Test Corp',
      device_model: 'Model X',
      firmware_version: '1.0.0',
      type: 'temperature',
      configuration: {
        threshold_warning: 25,
        threshold_critical: 30,
      },
      location: {
        building_id: 'building_001',
        floor: 1,
        room_name: 'Room 101',
      },
    };

    it('should accept valid device data', () => {
      const result = createDeviceSchema.safeParse(validDevice);
      expect(result.success).toBe(true);
    });

    it('should apply default status', () => {
      const result = createDeviceSchema.safeParse(validDevice);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('active');
    });

    it('should apply default metadata', () => {
      const result = createDeviceSchema.safeParse(validDevice);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toBeDefined();
        expect(result.data.metadata?.tags).toEqual([]);
        expect(result.data.metadata?.department).toBe('unknown');
      }
    });

    it('should apply default compliance', () => {
      const result = createDeviceSchema.safeParse(validDevice);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.compliance).toBeDefined();
        expect(result.data.compliance?.requires_encryption).toBe(false);
        expect(result.data.compliance?.data_classification).toBe('internal');
      }
    });

    it('should reject missing required fields', () => {
      const requiredFields = [
        '_id',
        'serial_number',
        'manufacturer',
        'device_model',
        'firmware_version',
        'type',
        'configuration',
        'location',
      ];

      for (const field of requiredFields) {
        const deviceWithMissingField = { ...validDevice };
        delete (deviceWithMissingField as Record<string, unknown>)[field];

        const result = createDeviceSchema.safeParse(deviceWithMissingField);
        expect(result.success).toBe(false);
      }
    });

    it('should reject invalid device ID format', () => {
      const invalidIds = [
        { ...validDevice, _id: '' },
        { ...validDevice, _id: 'has spaces' },
        { ...validDevice, _id: 'has@special#chars' },
      ];

      for (const device of invalidIds) {
        const result = createDeviceSchema.safeParse(device);
        expect(result.success).toBe(false);
      }
    });

    it('should reject invalid serial number format', () => {
      const invalidSerialNumbers = [
        { ...validDevice, serial_number: '' },
        { ...validDevice, serial_number: 'has spaces' },
        { ...validDevice, serial_number: 'has@special' },
      ];

      for (const device of invalidSerialNumbers) {
        const result = createDeviceSchema.safeParse(device);
        expect(result.success).toBe(false);
      }
    });

    it('should reject invalid firmware version format', () => {
      const invalidVersions = [
        { ...validDevice, firmware_version: '' },
        { ...validDevice, firmware_version: 'invalid' },
        { ...validDevice, firmware_version: 'v1.0' },
      ];

      for (const device of invalidVersions) {
        const result = createDeviceSchema.safeParse(device);
        expect(result.success).toBe(false);
      }
    });

    it('should accept valid firmware version formats', () => {
      const validVersions = ['1.0.0', '2.1.3', '10.20.30', '1.0.0-beta', '2.0.0-rc1'];

      for (const version of validVersions) {
        const device = { ...validDevice, firmware_version: version };
        const result = createDeviceSchema.safeParse(device);
        expect(result.success).toBe(true);
      }
    });
  });

  // ==========================================================================
  // UPDATE DEVICE SCHEMA TESTS
  // ==========================================================================

  describe('updateDeviceSchema', () => {
    it('should accept partial updates', () => {
      const partialUpdate = {
        firmware_version: '2.0.0',
      };

      const result = updateDeviceSchema.safeParse(partialUpdate);
      expect(result.success).toBe(true);
    });

    it('should accept nested partial updates', () => {
      const nestedUpdate = {
        configuration: {
          threshold_warning: 28,
        },
        location: {
          floor: 3,
        },
      };

      const result = updateDeviceSchema.safeParse(nestedUpdate);
      expect(result.success).toBe(true);
    });

    it('should reject empty updates', () => {
      const emptyUpdate = {};

      const result = updateDeviceSchema.safeParse(emptyUpdate);
      expect(result.success).toBe(false);
    });

    it('should accept status transitions', () => {
      const statusUpdates = [
        { status: 'maintenance' },
        { status: 'offline' },
        { status: 'active' },
        { status: 'error', status_reason: 'Connection lost' },
      ];

      for (const update of statusUpdates) {
        const result = updateDeviceSchema.safeParse(update);
        expect(result.success).toBe(true);
      }
    });

    it('should accept health updates', () => {
      const healthUpdate = {
        health: {
          battery_level: 50,
          signal_strength: -60,
        },
      };

      const result = updateDeviceSchema.safeParse(healthUpdate);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // LIST DEVICES QUERY SCHEMA TESTS
  // ==========================================================================

  describe('listDevicesQuerySchema', () => {
    it('should accept empty query (defaults applied)', () => {
      const result = listDevicesQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.include_deleted).toBe(false);
        expect(result.data.only_deleted).toBe(false);
      }
    });

    it('should accept pagination parameters', () => {
      const query = {
        page: 2,
        limit: 50,
      };

      const result = listDevicesQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    it('should transform string pagination to numbers', () => {
      const query = {
        page: '3',
        limit: '25',
      };

      const result = listDevicesQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.limit).toBe(25);
      }
    });

    it('should accept status filter as string or array', () => {
      const queries = [
        { status: 'active' },
        { status: ['active', 'maintenance'] },
        { status: 'active,maintenance' },
      ];

      for (const query of queries) {
        const result = listDevicesQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
      }
    });

    it('should accept type filter as string or array', () => {
      const queries = [
        { type: 'temperature' },
        { type: ['temperature', 'humidity'] },
        { type: 'temperature,humidity' },
      ];

      for (const query of queries) {
        const result = listDevicesQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
      }
    });

    it('should accept location filters', () => {
      const query = {
        building_id: 'building_001',
        floor: 5,
        zone: 'East Wing',
      };

      const result = listDevicesQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept sorting parameters', () => {
      const query = {
        sortBy: 'created_at',
        sortDirection: 'desc',
      };

      const result = listDevicesQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should reject invalid sort fields', () => {
      const query = {
        sortBy: 'invalid_field',
      };

      const result = listDevicesQuerySchema.safeParse(query);
      expect(result.success).toBe(false);
    });

    it('should reject both include_deleted and only_deleted', () => {
      const query = {
        include_deleted: true,
        only_deleted: true,
      };

      const result = listDevicesQuerySchema.safeParse(query);
      expect(result.success).toBe(false);
    });

    it('should accept battery filter', () => {
      const query = {
        min_battery: 20,
        max_battery: 80,
      };

      const result = listDevicesQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept search parameter', () => {
      const query = {
        search: 'conference room',
      };

      const result = listDevicesQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // DEVICE ID PARAM SCHEMA TESTS
  // ==========================================================================

  describe('deviceIdParamSchema', () => {
    it('should accept valid device IDs', () => {
      const validIds = ['device_001', 'sensor-temp-1', 'ABC123', 'test_device_2024'];

      for (const id of validIds) {
        const result = deviceIdParamSchema.safeParse({ id });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid device IDs', () => {
      const invalidIds = ['', 'has spaces', 'has@symbol', 'has#hash'];

      for (const id of invalidIds) {
        const result = deviceIdParamSchema.safeParse({ id });
        expect(result.success).toBe(false);
      }
    });
  });
});
