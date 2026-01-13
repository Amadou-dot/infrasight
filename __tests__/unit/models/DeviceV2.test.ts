/**
 * DeviceV2 Model Unit Tests
 *
 * Tests for the DeviceV2 Mongoose model including:
 * - Document creation and validation
 * - Static methods (findActive, findDeleted, softDelete, restore)
 * - Middleware (pre-save, pre-findOneAndUpdate)
 * - Index definitions
 */

import DeviceV2 from '@/models/v2/DeviceV2';
import {
  createDeviceInput,
  createDeviceInputs,
  createDeviceOfType,
  createDeviceWithStatus,
  resetCounters,
  VALID_DEVICE_TYPES,
  VALID_DEVICE_STATUSES,
} from '../../setup/factories';

describe('DeviceV2 Model', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // DOCUMENT CREATION TESTS
  // ==========================================================================

  describe('Document Creation', () => {
    it('should create a device with valid data', async () => {
      const deviceData = createDeviceInput({ _id: 'device_test_001' });
      const device = await DeviceV2.create(deviceData);

      expect(device._id).toBe('device_test_001');
      expect(device.serial_number).toBe(deviceData.serial_number);
      expect(device.manufacturer).toBe('Test Manufacturer');
      expect(device.device_model).toBe('Test Model v1.0');
      expect(device.firmware_version).toBe('1.0.0');
      expect(device.type).toBe('temperature');
      expect(device.status).toBe('active');
    });

    it('should set default values for optional fields', async () => {
      const deviceData = createDeviceInput({ _id: 'device_defaults_001' });
      const device = await DeviceV2.create(deviceData);

      // Check defaults
      expect(device.metadata.department).toBeDefined();
      expect(device.audit.created_at).toBeInstanceOf(Date);
      expect(device.audit.updated_at).toBeInstanceOf(Date);
      expect(device.health.last_seen).toBeInstanceOf(Date);
      expect(device.health.uptime_percentage).toBe(100);
      expect(device.health.error_count).toBe(0);
      expect(device.compliance.requires_encryption).toBe(false);
      expect(device.compliance.data_classification).toBe('internal');
      expect(device.compliance.retention_days).toBe(90);
    });

    it('should enforce required fields', async () => {
      const invalidData = {
        _id: 'device_invalid_001',
        // Missing required fields: serial_number, manufacturer, etc.
      };

      await expect(DeviceV2.create(invalidData)).rejects.toThrow();
    });

    it('should enforce unique serial_number constraint', async () => {
      const serialNumber = 'UNIQUE-SN-001';
      const device1 = createDeviceInput({ _id: 'device_unique_001', serial_number: serialNumber });
      const device2 = createDeviceInput({ _id: 'device_unique_002', serial_number: serialNumber });

      await DeviceV2.create(device1);

      await expect(DeviceV2.create(device2)).rejects.toThrow(/duplicate key/i);
    });

    it('should validate device type enum', async () => {
      const invalidTypeData = createDeviceInput({ _id: 'device_invalid_type' });
      (invalidTypeData as Record<string, unknown>).type = 'invalid_type';

      await expect(DeviceV2.create(invalidTypeData)).rejects.toThrow(/validation/i);
    });

    it('should validate device status enum', async () => {
      const invalidStatusData = createDeviceInput({ _id: 'device_invalid_status' });
      (invalidStatusData as Record<string, unknown>).status = 'invalid_status';

      await expect(DeviceV2.create(invalidStatusData)).rejects.toThrow(/validation/i);
    });

    it('should accept all valid device types', async () => {
      for (const type of VALID_DEVICE_TYPES) {
        const device = await DeviceV2.create(
          createDeviceOfType(type, { _id: `device_type_${type}` })
        );
        expect(device.type).toBe(type);
      }
    });

    it('should accept all valid device statuses', async () => {
      for (const status of VALID_DEVICE_STATUSES) {
        const device = await DeviceV2.create(
          createDeviceWithStatus(status, { _id: `device_status_${status}` })
        );
        expect(device.status).toBe(status);
      }
    });
  });

  // ==========================================================================
  // CONFIGURATION VALIDATION TESTS
  // ==========================================================================

  describe('Configuration Validation', () => {
    it('should validate configuration thresholds', async () => {
      const device = await DeviceV2.create(
        createDeviceInput({
          _id: 'device_config_001',
          configuration: {
            threshold_warning: 25,
            threshold_critical: 30,
            sampling_interval: 60,
            calibration_offset: 0,
          },
        })
      );

      expect(device.configuration.threshold_warning).toBe(25);
      expect(device.configuration.threshold_critical).toBe(30);
      expect(device.configuration.sampling_interval).toBe(60);
    });

    it('should use default sampling interval', async () => {
      const deviceData = createDeviceInput({ _id: 'device_sampling_default' });
      delete (deviceData.configuration as Record<string, unknown>).sampling_interval;

      const device = await DeviceV2.create(deviceData);
      expect(device.configuration.sampling_interval).toBe(60);
    });
  });

  // ==========================================================================
  // LOCATION VALIDATION TESTS
  // ==========================================================================

  describe('Location Validation', () => {
    it('should validate required location fields', async () => {
      const device = await DeviceV2.create(
        createDeviceInput({
          _id: 'device_location_001',
          location: {
            building_id: 'building_test',
            floor: 5,
            room_name: 'Conference Room A',
            zone: 'East Wing',
            coordinates: { x: 150, y: 250 },
          },
        })
      );

      expect(device.location.building_id).toBe('building_test');
      expect(device.location.floor).toBe(5);
      expect(device.location.room_name).toBe('Conference Room A');
      expect(device.location.zone).toBe('East Wing');
      expect(device.location.coordinates?.x).toBe(150);
      expect(device.location.coordinates?.y).toBe(250);
    });

    it('should allow optional coordinates', async () => {
      const device = await DeviceV2.create(
        createDeviceInput({
          _id: 'device_no_coords',
          location: {
            building_id: 'building_test',
            floor: 1,
            room_name: 'Room 101',
          },
        })
      );

      expect(device.location.coordinates).toBeUndefined();
    });
  });

  // ==========================================================================
  // HEALTH METRICS TESTS
  // ==========================================================================

  describe('Health Metrics', () => {
    it('should validate battery level range', async () => {
      const device = await DeviceV2.create(
        createDeviceInput({
          _id: 'device_battery_001',
          health: {
            last_seen: new Date(),
            uptime_percentage: 99,
            error_count: 0,
            battery_level: 75,
            signal_strength: -45,
          },
        })
      );

      expect(device.health.battery_level).toBe(75);
    });

    it('should reject battery level over 100', async () => {
      const deviceData = createDeviceInput({
        _id: 'device_battery_invalid',
        health: {
          last_seen: new Date(),
          uptime_percentage: 100,
          error_count: 0,
          battery_level: 150, // Invalid
        },
      });

      await expect(DeviceV2.create(deviceData)).rejects.toThrow();
    });

    it('should validate uptime percentage range', async () => {
      const validDevice = await DeviceV2.create(
        createDeviceInput({
          _id: 'device_uptime_valid',
          health: {
            last_seen: new Date(),
            uptime_percentage: 99.5,
            error_count: 0,
          },
        })
      );

      expect(validDevice.health.uptime_percentage).toBe(99.5);

      const invalidData = createDeviceInput({
        _id: 'device_uptime_invalid',
        health: {
          last_seen: new Date(),
          uptime_percentage: 150, // Invalid
          error_count: 0,
        },
      });

      await expect(DeviceV2.create(invalidData)).rejects.toThrow();
    });

    it('should store last error information', async () => {
      const lastError = {
        timestamp: new Date(),
        message: 'Connection timeout',
        code: 'ERR_TIMEOUT',
      };

      const device = await DeviceV2.create(
        createDeviceInput({
          _id: 'device_error_001',
          health: {
            last_seen: new Date(),
            uptime_percentage: 95,
            error_count: 5,
            last_error: lastError,
          },
        })
      );

      expect(device.health.last_error).toBeDefined();
      expect(device.health.last_error?.message).toBe('Connection timeout');
      expect(device.health.last_error?.code).toBe('ERR_TIMEOUT');
    });
  });

  // ==========================================================================
  // STATIC METHODS TESTS
  // ==========================================================================

  describe('Static Methods', () => {
    describe('findActive', () => {
      it('should return only non-deleted devices', async () => {
        // Create active devices
        const devices = createDeviceInputs(3);
        for (let i = 0; i < devices.length; i++) devices[i]._id = `device_active_${i}`;

        await DeviceV2.insertMany(devices);

        // Soft delete one
        await DeviceV2.softDelete('device_active_1');

        // Find active should return 2
        const activeDevices = await DeviceV2.findActive();
        expect(activeDevices.length).toBe(2);
        expect(activeDevices.map(d => d._id)).not.toContain('device_active_1');
      });

      it('should support additional filters', async () => {
        const devices = [
          createDeviceInput({
            _id: 'floor1_device',
            location: { building_id: 'b1', floor: 1, room_name: 'R1' },
          }),
          createDeviceInput({
            _id: 'floor2_device',
            location: { building_id: 'b1', floor: 2, room_name: 'R2' },
          }),
        ];
        await DeviceV2.insertMany(devices);

        const floor1Devices = await DeviceV2.findActive({ 'location.floor': 1 });
        expect(floor1Devices.length).toBe(1);
        expect(floor1Devices[0]._id).toBe('floor1_device');
      });
    });

    describe('findDeleted', () => {
      it('should return only soft-deleted devices', async () => {
        const devices = createDeviceInputs(3);
        for (let i = 0; i < devices.length; i++) devices[i]._id = `device_deleted_test_${i}`;

        await DeviceV2.insertMany(devices);

        // Soft delete two devices
        await DeviceV2.softDelete('device_deleted_test_0');
        await DeviceV2.softDelete('device_deleted_test_2');

        const deletedDevices = await DeviceV2.findDeleted();
        expect(deletedDevices.length).toBe(2);
        expect(deletedDevices.map(d => d._id)).toContain('device_deleted_test_0');
        expect(deletedDevices.map(d => d._id)).toContain('device_deleted_test_2');
      });
    });

    describe('softDelete', () => {
      it('should set deleted_at and deleted_by', async () => {
        await DeviceV2.create(createDeviceInput({ _id: 'device_to_delete' }));

        const deleted = await DeviceV2.softDelete('device_to_delete', 'test-user');

        expect(deleted).not.toBeNull();
        expect(deleted?.audit.deleted_at).toBeInstanceOf(Date);
        expect(deleted?.audit.deleted_by).toBe('test-user');
        expect(deleted?.status).toBe('decommissioned');
      });

      it('should use default deletedBy when not provided', async () => {
        await DeviceV2.create(createDeviceInput({ _id: 'device_default_delete' }));

        const deleted = await DeviceV2.softDelete('device_default_delete');

        expect(deleted?.audit.deleted_by).toBe('sys-migration-agent');
      });

      it('should return null for non-existent device', async () => {
        const result = await DeviceV2.softDelete('non_existent_device');
        expect(result).toBeNull();
      });
    });

    describe('restore', () => {
      it('should remove deleted_at and deleted_by, set status to offline', async () => {
        await DeviceV2.create(createDeviceInput({ _id: 'device_to_restore' }));
        await DeviceV2.softDelete('device_to_restore', 'test-user');

        const restored = await DeviceV2.restore('device_to_restore');

        expect(restored).not.toBeNull();
        expect(restored?.audit.deleted_at).toBeUndefined();
        expect(restored?.audit.deleted_by).toBeUndefined();
        expect(restored?.status).toBe('offline'); // Set to offline after restore
      });

      it('should return null for non-existent device', async () => {
        const result = await DeviceV2.restore('non_existent_device');
        expect(result).toBeNull();
      });
    });
  });

  // ==========================================================================
  // MIDDLEWARE TESTS
  // ==========================================================================

  describe('Middleware', () => {
    describe('pre-save', () => {
      it('should update updated_at on save for existing documents', async () => {
        const device = await DeviceV2.create(createDeviceInput({ _id: 'device_update_test' }));
        const originalUpdatedAt = device.audit.updated_at;

        // Wait a bit to ensure time difference
        await new Promise(resolve => setTimeout(resolve, 10));

        device.firmware_version = '2.0.0';
        await device.save();

        expect(device.audit.updated_at.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      });

      it('should not update updated_at for new documents', async () => {
        const beforeCreate = new Date();
        await new Promise(resolve => setTimeout(resolve, 10));

        const device = await DeviceV2.create(createDeviceInput({ _id: 'device_new_test' }));

        // created_at and updated_at should be the same for new documents
        expect(device.audit.created_at.getTime()).toBeCloseTo(
          device.audit.updated_at.getTime(),
          -2
        );
        expect(device.audit.created_at.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      });
    });

    describe('pre-findOneAndUpdate', () => {
      it('should update updated_at on findOneAndUpdate', async () => {
        await DeviceV2.create(createDeviceInput({ _id: 'device_findupdate_test' }));

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));

        const updated = await DeviceV2.findByIdAndUpdate(
          'device_findupdate_test',
          { $set: { firmware_version: '3.0.0' } },
          { new: true }
        );

        expect(updated?.firmware_version).toBe('3.0.0');
        expect(updated?.audit.updated_at).toBeInstanceOf(Date);
      });
    });
  });

  // ==========================================================================
  // COMPLIANCE TESTS
  // ==========================================================================

  describe('Compliance Settings', () => {
    it('should validate data classification enum', async () => {
      const validClassifications = ['public', 'internal', 'confidential', 'restricted'] as const;

      for (const classification of validClassifications) {
        const device = await DeviceV2.create(
          createDeviceInput({
            _id: `device_class_${classification}`,
            compliance: {
              requires_encryption:
                classification === 'confidential' || classification === 'restricted',
              data_classification: classification,
              retention_days: 90,
            },
          })
        );

        expect(device.compliance.data_classification).toBe(classification);
      }
    });

    it('should reject invalid data classification', async () => {
      const deviceData = createDeviceInput({
        _id: 'device_invalid_class',
        compliance: {
          requires_encryption: false,
          data_classification: 'invalid' as 'public',
          retention_days: 90,
        },
      });

      await expect(DeviceV2.create(deviceData)).rejects.toThrow();
    });

    it('should validate retention_days minimum', async () => {
      const deviceData = createDeviceInput({
        _id: 'device_invalid_retention',
        compliance: {
          requires_encryption: false,
          data_classification: 'internal',
          retention_days: 0, // Invalid - must be >= 1
        },
      });

      await expect(DeviceV2.create(deviceData)).rejects.toThrow();
    });
  });

  // ==========================================================================
  // BULK OPERATIONS TESTS
  // ==========================================================================

  describe('Bulk Operations', () => {
    it('should insert multiple devices', async () => {
      const devices = createDeviceInputs(5);
      for (let i = 0; i < devices.length; i++) devices[i]._id = `bulk_device_${i}`;

      const result = await DeviceV2.insertMany(devices);

      expect(result.length).toBe(5);
    });

    it('should update multiple devices', async () => {
      const devices = createDeviceInputs(3);
      for (let i = 0; i < devices.length; i++) {
        devices[i]._id = `update_bulk_${i}`;
        devices[i].status = 'active';
      }
      await DeviceV2.insertMany(devices);

      const result = await DeviceV2.updateMany(
        { status: 'active' },
        { $set: { status: 'maintenance' } }
      );

      expect(result.modifiedCount).toBe(3);

      const updatedDevices = await DeviceV2.find({ status: 'maintenance' });
      expect(updatedDevices.length).toBe(3);
    });
  });
});
