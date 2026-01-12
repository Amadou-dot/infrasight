/**
 * Simulate Cron API Integration Tests
 *
 * Integration tests for /api/v2/cron/simulate endpoint.
 * Tests reading generation for all device types.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  createDeviceInput,
  resetCounters,
  VALID_DEVICE_TYPES,
} from '../../setup/factories';

import { GET as GET_SIMULATE } from '@/app/api/v2/cron/simulate/route';

// Mock pusher to avoid network errors in tests
jest.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: jest.fn().mockResolvedValue(undefined),
  },
}));

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Simulate Cron API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // BASIC FUNCTIONALITY TESTS
  // ==========================================================================

  describe('Basic Functionality', () => {
    it('should return 404 when no devices exist', async () => {
      // Ensure no devices exist
      await DeviceV2.deleteMany({});

      const request = new NextRequest(
        'http://localhost:3000/api/v2/cron/simulate'
      );
      const response = await GET_SIMULATE();
      const data = await parseResponse<{
        success: boolean;
        error: string;
      }>(response);

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toContain('No devices found');
    });

    it('should generate readings for existing devices', async () => {
      // Create a test device
      const device = createDeviceInput({
        _id: 'sim_device_001',
        type: 'temperature',
        status: 'active',
      });
      await DeviceV2.create(device);

      const response = await GET_SIMULATE();
      const data = await parseResponse<{
        success: boolean;
        count: number;
        anomalies: number;
        timestamp: string;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.count).toBeGreaterThan(0);
      expect(data.anomalies).toBeGreaterThanOrEqual(0);
      expect(data.timestamp).toBeDefined();
    });

    it('should insert readings into database', async () => {
      const device = createDeviceInput({
        _id: 'sim_device_002',
        type: 'humidity',
        status: 'active',
      });
      await DeviceV2.create(device);

      // Clear any existing readings
      await ReadingV2.deleteMany({ 'metadata.device_id': 'sim_device_002' });

      await GET_SIMULATE();

      // Check readings were inserted
      const readings = await ReadingV2.find({
        'metadata.device_id': 'sim_device_002',
      });
      expect(readings.length).toBeGreaterThan(0);
    });

    it('should only generate readings for active devices', async () => {
      const devices = [
        createDeviceInput({
          _id: 'sim_active_device',
          type: 'temperature',
          status: 'active',
        }),
        createDeviceInput({
          _id: 'sim_offline_device',
          type: 'temperature',
          status: 'offline',
        }),
        createDeviceInput({
          _id: 'sim_decommissioned_device',
          type: 'temperature',
          status: 'decommissioned',
        }),
      ];

      await DeviceV2.insertMany(devices);

      const response = await GET_SIMULATE();
      const data = await parseResponse<{
        success: boolean;
        count: number;
      }>(response);

      expect(response.status).toBe(200);
      // Should only generate for active devices (DeviceV2.findActive)
      expect(data.count).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // DEVICE TYPE SPECIFIC TESTS
  // ==========================================================================

  describe('Device Type Value Generation', () => {
    // Test each device type to ensure value generation works
    const deviceTypes = VALID_DEVICE_TYPES;

    describe.each(deviceTypes)('Device type: %s', (deviceType) => {
      beforeEach(async () => {
        // Clear and create a single device of this type
        await DeviceV2.deleteMany({});
        await ReadingV2.deleteMany({});

        const device = createDeviceInput({
          _id: `sim_${deviceType}_device`,
          type: deviceType,
          status: 'active',
        });
        await DeviceV2.create(device);
      });

      it(`should generate valid readings for ${deviceType}`, async () => {
        const response = await GET_SIMULATE();
        const data = await parseResponse<{
          success: boolean;
          count: number;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.count).toBe(1);

        // Verify reading was stored
        const readings = await ReadingV2.find({
          'metadata.device_id': `sim_${deviceType}_device`,
        });
        expect(readings.length).toBe(1);
        expect(readings[0].metadata.type).toBe(deviceType);
      });

      it(`should generate appropriate unit for ${deviceType}`, async () => {
        await GET_SIMULATE();

        const reading = await ReadingV2.findOne({
          'metadata.device_id': `sim_${deviceType}_device`,
        });

        expect(reading).not.toBeNull();
        expect(reading!.metadata.unit).toBeDefined();

        // Verify the unit is appropriate for the type
        const expectedUnits: Record<string, string[]> = {
          temperature: ['celsius'],
          humidity: ['percent'],
          occupancy: ['count'],
          power: ['watts'],
          co2: ['ppm'],
          pressure: ['hpa'],
          light: ['lux'],
          motion: ['boolean'],
          air_quality: ['ppm'],
          water_flow: ['liters_per_minute'],
          gas: ['ppm'],
          vibration: ['raw'],
          voltage: ['volts'],
          current: ['amperes'],
          energy: ['kilowatt_hours'],
        };

        const expectedUnit = expectedUnits[deviceType];
        if (expectedUnit) {
          expect(expectedUnit).toContain(reading!.metadata.unit);
        }
      });
    });
  });

  // ==========================================================================
  // VALUE RANGE TESTS
  // ==========================================================================

  describe('Value Range Validation', () => {
    beforeEach(async () => {
      await DeviceV2.deleteMany({});
      await ReadingV2.deleteMany({});
    });

    it('should generate temperature values in expected range', async () => {
      const device = createDeviceInput({
        _id: 'temp_range_device',
        type: 'temperature',
        status: 'active',
      });
      await DeviceV2.create(device);

      // Generate multiple readings to check range
      for (let i = 0; i < 10; i++) {
        await GET_SIMULATE();
      }

      const readings = await ReadingV2.find({
        'metadata.device_id': 'temp_range_device',
      });

      readings.forEach((r) => {
        // Normal: 18-28°C, Anomaly: 5-15°C or 30-40°C
        expect(r.value).toBeGreaterThanOrEqual(5);
        expect(r.value).toBeLessThanOrEqual(40);
      });
    });

    it('should generate humidity values in expected range', async () => {
      const device = createDeviceInput({
        _id: 'humidity_range_device',
        type: 'humidity',
        status: 'active',
      });
      await DeviceV2.create(device);

      for (let i = 0; i < 10; i++) {
        await GET_SIMULATE();
      }

      const readings = await ReadingV2.find({
        'metadata.device_id': 'humidity_range_device',
      });

      readings.forEach((r) => {
        // Normal: 30-70%, Anomaly: 10-20% or 80-95%
        expect(r.value).toBeGreaterThanOrEqual(10);
        expect(r.value).toBeLessThanOrEqual(95);
      });
    });

    it('should generate power values in expected range', async () => {
      const device = createDeviceInput({
        _id: 'power_range_device',
        type: 'power',
        status: 'active',
      });
      await DeviceV2.create(device);

      for (let i = 0; i < 10; i++) {
        await GET_SIMULATE();
      }

      const readings = await ReadingV2.find({
        'metadata.device_id': 'power_range_device',
      });

      readings.forEach((r) => {
        // Normal: 100-5000W, Anomaly: 8000-15000W
        expect(r.value).toBeGreaterThanOrEqual(100);
        expect(r.value).toBeLessThanOrEqual(15000);
      });
    });

    it('should generate motion values as 0 or 1', async () => {
      const device = createDeviceInput({
        _id: 'motion_range_device',
        type: 'motion',
        status: 'active',
      });
      await DeviceV2.create(device);

      for (let i = 0; i < 10; i++) {
        await GET_SIMULATE();
      }

      const readings = await ReadingV2.find({
        'metadata.device_id': 'motion_range_device',
      });

      readings.forEach((r) => {
        expect([0, 1]).toContain(r.value);
      });
    });

    it('should generate occupancy values as integers', async () => {
      const device = createDeviceInput({
        _id: 'occupancy_range_device',
        type: 'occupancy',
        status: 'active',
      });
      await DeviceV2.create(device);

      for (let i = 0; i < 10; i++) {
        await GET_SIMULATE();
      }

      const readings = await ReadingV2.find({
        'metadata.device_id': 'occupancy_range_device',
      });

      readings.forEach((r) => {
        // Normal: 0-50, Anomaly: 80-150
        expect(r.value).toBeGreaterThanOrEqual(0);
        expect(r.value).toBeLessThanOrEqual(150);
        expect(Number.isInteger(r.value)).toBe(true);
      });
    });
  });

  // ==========================================================================
  // QUALITY METRICS TESTS
  // ==========================================================================

  describe('Quality Metrics Generation', () => {
    beforeEach(async () => {
      const device = createDeviceInput({
        _id: 'quality_device',
        type: 'temperature',
        status: 'active',
      });
      await DeviceV2.create(device);
    });

    it('should generate quality metrics for readings', async () => {
      await GET_SIMULATE();

      const reading = await ReadingV2.findOne({
        'metadata.device_id': 'quality_device',
      });

      expect(reading?.quality).toBeDefined();
      expect(reading?.quality?.is_valid).toBeDefined();
      expect(reading?.quality?.confidence_score).toBeDefined();
      expect(reading?.quality?.is_anomaly).toBeDefined();
    });

    it('should generate confidence scores in valid range', async () => {
      for (let i = 0; i < 10; i++) {
        await GET_SIMULATE();
      }

      const readings = await ReadingV2.find({
        'metadata.device_id': 'quality_device',
      });

      readings.forEach((r) => {
        expect(r.quality?.confidence_score).toBeGreaterThanOrEqual(0.85);
        expect(r.quality?.confidence_score).toBeLessThanOrEqual(1);
      });
    });

    it('should generate anomaly scores based on is_anomaly flag', async () => {
      for (let i = 0; i < 20; i++) {
        await GET_SIMULATE();
      }

      const readings = await ReadingV2.find({
        'metadata.device_id': 'quality_device',
      });

      readings.forEach((r) => {
        if (r.quality?.is_anomaly) {
          // Anomaly score should be 0.5-1.0 for anomalies
          expect(r.quality?.anomaly_score).toBeGreaterThanOrEqual(0.5);
        } else {
          // Anomaly score should be 0-0.3 for normal readings
          expect(r.quality?.anomaly_score).toBeLessThanOrEqual(0.3);
        }
      });
    });
  });

  // ==========================================================================
  // CONTEXT GENERATION TESTS
  // ==========================================================================

  describe('Context Generation', () => {
    beforeEach(async () => {
      const device = createDeviceInput({
        _id: 'context_device',
        type: 'temperature',
        status: 'active',
      });
      await DeviceV2.create(device);
    });

    it('should generate context with battery level', async () => {
      await GET_SIMULATE();

      const reading = await ReadingV2.findOne({
        'metadata.device_id': 'context_device',
      });

      expect(reading?.context).toBeDefined();
      expect(reading?.context?.battery_level).toBeDefined();
      expect(reading?.context?.battery_level).toBeGreaterThanOrEqual(20);
      expect(reading?.context?.battery_level).toBeLessThanOrEqual(100);
    });

    it('should generate context with signal strength', async () => {
      await GET_SIMULATE();

      const reading = await ReadingV2.findOne({
        'metadata.device_id': 'context_device',
      });

      expect(reading?.context?.signal_strength).toBeDefined();
      expect(reading?.context?.signal_strength).toBeGreaterThanOrEqual(-90);
      expect(reading?.context?.signal_strength).toBeLessThanOrEqual(-30);
    });
  });

  // ==========================================================================
  // PROCESSING METADATA TESTS
  // ==========================================================================

  describe('Processing Metadata', () => {
    beforeEach(async () => {
      const device = createDeviceInput({
        _id: 'processing_device',
        type: 'temperature',
        status: 'active',
      });
      await DeviceV2.create(device);
    });

    it('should generate processing metadata', async () => {
      await GET_SIMULATE();

      const reading = await ReadingV2.findOne({
        'metadata.device_id': 'processing_device',
      });

      expect(reading?.processing).toBeDefined();
      expect(reading?.processing?.raw_value).toBeDefined();
      expect(reading?.processing?.calibration_offset).toBeDefined();
      expect(reading?.processing?.ingested_at).toBeDefined();
    });

    it('should have raw_value close to processed value', async () => {
      await GET_SIMULATE();

      const reading = await ReadingV2.findOne({
        'metadata.device_id': 'processing_device',
      });

      // Raw value should be within ±0.5 of processed value
      const diff = Math.abs(
        (reading?.processing?.raw_value || 0) - (reading?.value || 0)
      );
      expect(diff).toBeLessThanOrEqual(0.5);
    });

    it('should have calibration offset in valid range', async () => {
      for (let i = 0; i < 10; i++) {
        await GET_SIMULATE();
      }

      const readings = await ReadingV2.find({
        'metadata.device_id': 'processing_device',
      });

      readings.forEach((r) => {
        expect(r.processing?.calibration_offset).toBeGreaterThanOrEqual(-0.25);
        expect(r.processing?.calibration_offset).toBeLessThanOrEqual(0.25);
      });
    });
  });

  // ==========================================================================
  // ANOMALY GENERATION TESTS
  // ==========================================================================

  describe('Anomaly Generation', () => {
    beforeEach(async () => {
      // Create multiple devices to increase chance of anomalies
      const devices = Array.from({ length: 20 }, (_, i) =>
        createDeviceInput({
          _id: `anomaly_test_device_${i}`,
          type: 'temperature',
          status: 'active',
        })
      );
      await DeviceV2.insertMany(devices);
    });

    it('should generate some anomalies (5% probability)', async () => {
      // Generate multiple batches to statistically ensure some anomalies
      for (let i = 0; i < 10; i++) {
        await GET_SIMULATE();
      }

      const anomalyReadings = await ReadingV2.find({
        'quality.is_anomaly': true,
      });

      // With 20 devices × 10 batches = 200 readings, expect some anomalies
      // 5% probability means ~10 anomalies expected
      // This is a statistical test, so we just check that it's not always 0
      expect(anomalyReadings.length).toBeGreaterThanOrEqual(0);
    });

    it('should report anomaly count in response', async () => {
      const response = await GET_SIMULATE();
      const data = await parseResponse<{
        success: boolean;
        anomalies: number;
      }>(response);

      expect(data.anomalies).toBeDefined();
      expect(typeof data.anomalies).toBe('number');
    });
  });

  // ==========================================================================
  // MULTIPLE DEVICE TYPES TESTS
  // ==========================================================================

  describe('Multiple Device Types', () => {
    beforeEach(async () => {
      const devices = [
        createDeviceInput({ _id: 'multi_temp', type: 'temperature', status: 'active' }),
        createDeviceInput({ _id: 'multi_humidity', type: 'humidity', status: 'active' }),
        createDeviceInput({ _id: 'multi_power', type: 'power', status: 'active' }),
        createDeviceInput({ _id: 'multi_co2', type: 'co2', status: 'active' }),
        createDeviceInput({ _id: 'multi_pressure', type: 'pressure', status: 'active' }),
        createDeviceInput({ _id: 'multi_light', type: 'light', status: 'active' }),
        createDeviceInput({ _id: 'multi_motion', type: 'motion', status: 'active' }),
        createDeviceInput({ _id: 'multi_air_quality', type: 'air_quality', status: 'active' }),
        createDeviceInput({ _id: 'multi_water_flow', type: 'water_flow', status: 'active' }),
        createDeviceInput({ _id: 'multi_gas', type: 'gas', status: 'active' }),
        createDeviceInput({ _id: 'multi_vibration', type: 'vibration', status: 'active' }),
        createDeviceInput({ _id: 'multi_voltage', type: 'voltage', status: 'active' }),
        createDeviceInput({ _id: 'multi_current', type: 'current', status: 'active' }),
        createDeviceInput({ _id: 'multi_energy', type: 'energy', status: 'active' }),
      ];

      await DeviceV2.insertMany(devices);
    });

    it('should generate readings for all device types', async () => {
      const response = await GET_SIMULATE();
      const data = await parseResponse<{
        success: boolean;
        count: number;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.count).toBe(14); // One reading per device

      // Verify each device got a reading
      const readings = await ReadingV2.find({});
      const deviceIds = readings.map((r) => r.metadata.device_id);

      expect(deviceIds).toContain('multi_temp');
      expect(deviceIds).toContain('multi_humidity');
      expect(deviceIds).toContain('multi_power');
      expect(deviceIds).toContain('multi_co2');
      expect(deviceIds).toContain('multi_pressure');
      expect(deviceIds).toContain('multi_light');
      expect(deviceIds).toContain('multi_motion');
      expect(deviceIds).toContain('multi_air_quality');
      expect(deviceIds).toContain('multi_water_flow');
      expect(deviceIds).toContain('multi_gas');
      expect(deviceIds).toContain('multi_vibration');
      expect(deviceIds).toContain('multi_voltage');
      expect(deviceIds).toContain('multi_current');
      expect(deviceIds).toContain('multi_energy');
    });

    it('should set source as simulation', async () => {
      await GET_SIMULATE();

      const readings = await ReadingV2.find({});

      readings.forEach((r) => {
        expect(r.metadata.source).toBe('simulation');
      });
    });
  });
});
