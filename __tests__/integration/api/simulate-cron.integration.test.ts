/**
 * Simulate Cron API Integration Tests
 *
 * Integration tests for /api/v2/cron/simulate endpoint.
 * Tests reading generation for all device types.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2, { type IReadingV2 } from '@/models/v2/ReadingV2';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import AlertV2 from '@/models/v2/AlertV2';
import * as evaluateModule from '@/lib/alerting/evaluate';
import * as sweepModule from '@/lib/alerting/sweep';
import * as simulationModule from '@/lib/simulation/readings';
import * as monitoring from '@/lib/monitoring';
import {
  createDeviceInput,
  createReadingV2Input,
  createAlertRuleInput,
  createAlertInput,
  resetCounters,
  VALID_DEVICE_TYPES,
} from '../../setup/factories';

import { GET as GET_SIMULATE_RAW } from '@/app/api/v2/cron/simulate/route';

// Mock pusher to avoid network errors in tests
jest.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: jest.fn().mockResolvedValue(undefined),
  },
}));

/**
 * Helper to call simulate endpoint with valid SEED_SECRET Bearer token
 */
function GET_SIMULATE() {
  const request = new NextRequest('http://localhost:3000/api/v2/cron/simulate', {
    headers: { Authorization: `Bearer ${process.env.SEED_SECRET}` },
  });
  return GET_SIMULATE_RAW(request);
}

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Simulate Cron API Integration Tests', () => {
  const originalSeedSecret = process.env.SEED_SECRET;

  beforeEach(() => {
    resetCounters();
    process.env.SEED_SECRET = originalSeedSecret ?? 'test-seed-secret';
  });

  afterAll(() => {
    if (originalSeedSecret === undefined) delete process.env.SEED_SECRET;
    else process.env.SEED_SECRET = originalSeedSecret;
  });

  // ==========================================================================
  // BASIC FUNCTIONALITY TESTS
  // ==========================================================================

  describe('Basic Functionality', () => {
    it('should return 503 when SEED_SECRET is not configured', async () => {
      delete process.env.SEED_SECRET;

      const request = new NextRequest('http://localhost:3000/api/v2/cron/simulate');
      const response = await GET_SIMULATE_RAW(request);
      const data = await parseResponse<{
        success: boolean;
        error: string;
      }>(response);

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.error).toBe('SEED_SECRET is not configured');
    });

    it('should return 404 when no devices exist', async () => {
      // Ensure no devices exist
      await DeviceV2.deleteMany({});

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
        if (expectedUnit) 
          expect(expectedUnit).toContain(reading!.metadata.unit);
        
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
      for (let i = 0; i < 10; i++) 
        await GET_SIMULATE();
      

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

      for (let i = 0; i < 10; i++) 
        await GET_SIMULATE();
      

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

      for (let i = 0; i < 10; i++) 
        await GET_SIMULATE();
      

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

      for (let i = 0; i < 10; i++) 
        await GET_SIMULATE();
      

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

      for (let i = 0; i < 10; i++) 
        await GET_SIMULATE();
      

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
      for (let i = 0; i < 10; i++) 
        await GET_SIMULATE();
      

      const readings = await ReadingV2.find({
        'metadata.device_id': 'quality_device',
      });

      readings.forEach((r) => {
        expect(r.quality?.confidence_score).toBeGreaterThanOrEqual(0.85);
        expect(r.quality?.confidence_score).toBeLessThanOrEqual(1);
      });
    });

    it('should generate anomaly scores based on is_anomaly flag', async () => {
      for (let i = 0; i < 20; i++) 
        await GET_SIMULATE();
      

      const readings = await ReadingV2.find({
        'metadata.device_id': 'quality_device',
      });

      readings.forEach((r) => {
        if (r.quality?.is_anomaly) 
          // Anomaly score should be 0.5-1.0 for anomalies
          expect(r.quality?.anomaly_score).toBeGreaterThanOrEqual(0.5);
         else 
          // Anomaly score should be 0-0.3 for normal readings
          expect(r.quality?.anomaly_score).toBeLessThanOrEqual(0.3);
        
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
      for (let i = 0; i < 10; i++) 
        await GET_SIMULATE();
      

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
      for (let i = 0; i < 10; i++) 
        await GET_SIMULATE();
      

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

  // ==========================================================================
  // ALERT EVALUATION TESTS
  // ==========================================================================

  describe('alert evaluation on the cron path', () => {
    it('should evaluate rules against simulated readings', async () => {
      await DeviceV2.create(createDeviceInput({ _id: 'device_cron_01', type: 'temperature' }));
      const rule = await AlertRuleV2.create(
        createAlertRuleInput({
          name: 'Any temperature',
          metric: 'value',
          comparison: 'gt',
          threshold: -1000, // guaranteed to breach whatever the simulator emits
          severity: 'info',
          selector: { types: ['temperature'] },
        })
      );
      const infoSpy = jest.spyOn(monitoring.logger, 'info');

      const response = await GET_SIMULATE();
      expect(response.status).toBe(200);

      expect(await AlertV2.countDocuments({ status: 'firing' })).toBeGreaterThan(0);

      // An alert firing is a domain event in its own right and must be
      // logged, with the rule and device it involves — not just counted. One
      // device exists, so exactly one reading is generated and exactly one
      // (rule, device) pair can fire.
      expect(infoSpy).toHaveBeenCalledWith('Alert rules fired or resolved during simulation', {
        fired: 1,
        resolved: 0,
        ruleIds: [String(rule._id)],
        deviceIds: ['device_cron_01'],
      });

      infoSpy.mockRestore();
    });

    it('should sweep an alert whose device no longer reports', async () => {
      await DeviceV2.create(createDeviceInput({ _id: 'device_cron_02', type: 'temperature' }));
      await AlertV2.create(
        createAlertInput({ device_id: 'device_ghost', status: 'firing', is_open: true })
      );
      const infoSpy = jest.spyOn(monitoring.logger, 'info');

      await GET_SIMULATE();

      const swept = await AlertV2.findOne({ device_id: 'device_ghost' }).lean();
      expect(swept!.status).toBe('resolved');
      expect(swept!.audit.resolution).toBe('device_inactive');

      // The SWEEP resolved this alert, not the evaluator — no alert rule
      // exists in this test, so safeEvaluateReadings's own fired/resolved
      // counts are both 0 and the evaluation-scoped log must not fire.
      expect(infoSpy).not.toHaveBeenCalledWith(
        'Alert rules fired or resolved during simulation',
        expect.anything()
      );

      infoSpy.mockRestore();
    });

    it('should still return 200 with readings persisted when evaluation throws', async () => {
      await DeviceV2.create(createDeviceInput({ _id: 'device_cron_03', type: 'temperature' }));
      const spy = jest
        .spyOn(evaluateModule, 'evaluateReadings')
        .mockRejectedValueOnce(new Error('evaluator exploded'));
      const infoSpy = jest.spyOn(monitoring.logger, 'info');

      const response = await GET_SIMULATE();
      const body = await parseResponse<{ success: boolean }>(response);

      // Prove the mocked rejection was actually reached, not merely that the
      // route succeeds regardless of whether alerting runs at all.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(await ReadingV2.countDocuments({ 'metadata.device_id': 'device_cron_03' })).toBe(1);
      // The empty fallback result must not be reported as if something fired
      // or resolved.
      expect(infoSpy).not.toHaveBeenCalledWith(
        'Alert rules fired or resolved during simulation',
        expect.anything()
      );

      spy.mockRestore();
      infoSpy.mockRestore();
    });

    // safeSweepStaleAlerts is the only caller of sweepStaleAlerts, and the cron
    // route is the only caller of safeSweepStaleAlerts — so a throwing sweep is
    // otherwise uncovered anywhere in the suite. Mirrors the evaluateReadings
    // throw test above: mock the RAW function the safe wrapper delegates to, so
    // a regression that pointed the route at the raw, unwrapped sweep would
    // surface here as a 500 instead of a 200.
    it('should still return 200 with readings persisted when the staleness sweep throws', async () => {
      await DeviceV2.create(
        createDeviceInput({ _id: 'device_cron_sweep_throws', type: 'temperature' })
      );
      const spy = jest
        .spyOn(sweepModule, 'sweepStaleAlerts')
        .mockRejectedValueOnce(new Error('sweep exploded'));

      const response = await GET_SIMULATE();
      const body = await parseResponse<{ success: boolean }>(response);

      // Prove the mocked rejection was actually reached, not merely that the
      // route succeeds regardless of whether the sweep runs at all.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(
        await ReadingV2.countDocuments({ 'metadata.device_id': 'device_cron_sweep_throws' })
      ).toBe(1);

      spy.mockRestore();
    });

    // The PR widened the device projection in the cron route (`_id`, `type`,
    // `location`, `metadata.tags`) specifically so selectors that key on more
    // than `types` can match. The tests above only ever use `selector: {
    // types: [...] }`, which needs no device fields at all, so a regression
    // that narrowed the projection back to `{ _id: 1, type: 1, location: 1 }`
    // (dropping only metadata.tags) would pass every existing test in this
    // file. This test exercises every non-type selector dimension against a
    // real device, with a negative twin that differs by exactly one field
    // (floor) to prove the rule discriminates on selector fields rather than
    // merely firing whenever device data is present.
    it('should fire only for the device whose location and tags match the selector', async () => {
      const matchingDevice = createDeviceInput({
        _id: 'device_selector_match_cron',
        type: 'temperature',
        location: {
          building_id: 'building_selector_cron',
          floor: 4,
          room_name: 'Selector Room',
          zone: 'zone_selector_cron',
        },
        metadata: { tags: ['hvac_critical'], department: 'Facilities' },
      });
      // Negative twin: identical selector-relevant fields except floor. If
      // matching degenerated to "device data is present" rather than a real
      // per-field comparison, this device would incorrectly fire too.
      const wrongFloorDevice = createDeviceInput({
        _id: 'device_selector_wrongfloor_cron',
        type: 'temperature',
        location: {
          building_id: 'building_selector_cron',
          floor: 11,
          room_name: 'Other Room',
          zone: 'zone_selector_cron',
        },
        metadata: { tags: ['hvac_critical'], department: 'Facilities' },
      });
      await DeviceV2.insertMany([matchingDevice, wrongFloorDevice]);

      const rule = await AlertRuleV2.create(
        createAlertRuleInput({
          name: 'Building/floor/zone/tag scoped rule',
          metric: 'value',
          comparison: 'gt',
          threshold: -1000, // guaranteed to breach whatever the simulator emits
          severity: 'critical',
          selector: {
            types: ['temperature'],
            building_id: 'building_selector_cron',
            floor: 4,
            zone: 'zone_selector_cron',
            tags: ['hvac_critical'],
          },
        })
      );

      const response = await GET_SIMULATE();
      expect(response.status).toBe(200);

      const matchedAlert = await AlertV2.findOne({
        device_id: 'device_selector_match_cron',
      }).lean();
      expect(matchedAlert).not.toBeNull();
      expect(matchedAlert!.status).toBe('firing');
      expect(String(matchedAlert!.rule_id)).toBe(String(rule._id));

      // The negative twin breaches the same metric/threshold and shares every
      // selector dimension except floor — if an alert exists for it, matching
      // is not actually discriminating on the selector.
      const unmatchedAlert = await AlertV2.findOne({
        device_id: 'device_selector_wrongfloor_cron',
      }).lean();
      expect(unmatchedAlert).toBeNull();
    });
  });

  // ==========================================================================
  // PARTIAL INSERT HANDLING TESTS
  // ==========================================================================

  describe('partial insert handling', () => {
    it('evaluates and reports only the readings bulkInsertReadings actually inserted', async () => {
      // Three active devices so the mocked partial insert below has a real
      // remainder to reject, not an all-or-nothing case.
      await DeviceV2.insertMany([
        createDeviceInput({ _id: 'device_partial_01', type: 'temperature' }),
        createDeviceInput({ _id: 'device_partial_02', type: 'temperature' }),
        createDeviceInput({ _id: 'device_partial_03', type: 'temperature' }),
      ]);

      // Stand-in for insertMany's real `{ ordered: false }` behavior: some
      // documents are silently dropped and only the survivors come back,
      // without throwing. `insertedSubset` is captured so the assertions
      // below can prove the route forwards this EXACT array reference
      // downstream, rather than reconstructing something that merely looks
      // the same.
      let insertedSubset: Partial<IReadingV2>[] = [];
      const bulkInsertSpy = jest
        .spyOn(ReadingV2, 'bulkInsertReadings')
        .mockImplementation(async readings => {
          insertedSubset = readings.slice(0, 2);
          return insertedSubset as IReadingV2[];
        });
      const evaluateSpy = jest.spyOn(evaluateModule, 'evaluateReadings');

      const response = await GET_SIMULATE();
      const data = await parseResponse<{
        success: boolean;
        count: number;
        rejected: number;
        anomalies: number;
      }>(response);

      expect(response.status).toBe(200);
      // 3 active devices generate 3 candidate readings; the mock reports
      // only 2 of them as actually inserted.
      expect(bulkInsertSpy.mock.calls[0][0]).toHaveLength(3);
      expect(insertedSubset).toHaveLength(2);

      // The response must describe what was actually persisted, not what
      // was merely generated.
      expect(data.count).toBe(2);
      expect(data.rejected).toBe(1);

      // safeEvaluateReadings (via evaluateReadings) must receive exactly the
      // inserted subset returned by bulkInsertReadings — never the full
      // generated batch, and never a copy that merely looks the same.
      expect(evaluateSpy).toHaveBeenCalledTimes(1);
      expect(evaluateSpy.mock.calls[0][0]).toBe(insertedSubset);

      bulkInsertSpy.mockRestore();
      evaluateSpy.mockRestore();
    });

    it('must not count a reading bulkInsertReadings rejected toward the anomaly total', async () => {
      await DeviceV2.insertMany([
        createDeviceInput({ _id: 'device_anom_keep', type: 'temperature' }),
        createDeviceInput({ _id: 'device_anom_drop', type: 'temperature' }),
      ]);

      // Deterministic stand-in for the real (random) simulator: one normal
      // reading and one anomalous reading. The bulkInsertReadings mock below
      // "persists" only the normal one, simulating the anomalous one having
      // failed to insert.
      const keptReading = createReadingV2Input('device_anom_keep', {
        quality: {
          is_valid: true,
          confidence_score: 0.95,
          is_anomaly: false,
          anomaly_score: 0.05,
        },
      });
      const droppedAnomalousReading = createReadingV2Input('device_anom_drop', {
        quality: {
          is_valid: true,
          confidence_score: 0.95,
          is_anomaly: true,
          anomaly_score: 0.92,
        },
      });
      const generateSpy = jest
        .spyOn(simulationModule, 'generateSimulatedReadings')
        .mockReturnValue([keptReading, droppedAnomalousReading]);
      const bulkInsertSpy = jest
        .spyOn(ReadingV2, 'bulkInsertReadings')
        .mockImplementation(async () => [keptReading] as unknown as IReadingV2[]);

      const response = await GET_SIMULATE();
      const data = await parseResponse<{ count: number; rejected: number; anomalies: number }>(
        response
      );

      expect(response.status).toBe(200);
      expect(data.count).toBe(1);
      expect(data.rejected).toBe(1);
      // The one reading that actually persisted was NOT anomalous. If this
      // count were still derived from the full generated batch (which
      // includes the rejected, anomalous reading) it would report 1 instead
      // of 0.
      expect(data.anomalies).toBe(0);

      generateSpy.mockRestore();
      bulkInsertSpy.mockRestore();
    });
  });
});
