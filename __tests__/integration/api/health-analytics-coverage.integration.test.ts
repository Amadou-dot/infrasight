/**
 * Health Analytics API – Coverage Gap Tests
 *
 * Covers uncovered paths in app/api/v2/analytics/health/route.ts:
 *  - Floor filter (line 89): query with floor parameter
 *  - Department filter (line 91): query with department parameter
 *  - Empty database: health_score=100 fallback (line 256), uptime_stats fallback (line 301)
 *  - Predictive maintenance categorization (lines 259-294):
 *    battery_critical, maintenance_overdue, maintenance_due, high_error_count
 *  - offline_threshold_minutes parameter (line 94): custom threshold
 *  - battery_warning_threshold parameter (line 162): custom threshold
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createDeviceInput, resetCounters } from '../../setup/factories';

import { GET } from '@/app/api/v2/analytics/health/route';

function createMockGetRequest(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/v2/analytics/health');
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface HealthResponse {
  success: boolean;
  data?: {
    summary: {
      total_devices: number;
      active_devices: number;
      health_score: number;
      uptime_stats: {
        avg_uptime: number;
        min_uptime: number;
        max_uptime: number;
        total_errors: number;
      };
    };
    status_breakdown: Array<{ status: string; count: number }>;
    alerts: {
      offline_devices: { count: number; devices: any[]; threshold_minutes: number };
      low_battery_devices: { count: number; devices: any[]; threshold_percent: number };
      error_devices: { count: number; devices: any[] };
      maintenance_due: { count: number; devices: any[] };
      predictive_maintenance: {
        count: number;
        devices: Array<{
          id: string;
          serial_number: string;
          room_name: string;
          issue_type: string;
          days_until: number | null;
          severity: string;
        }>;
      };
    };
    filters_applied: {
      building_id: string | null;
      floor: number | null;
      department: string | null;
    };
  };
  error?: { code: string; message: string };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('Health Analytics API – Coverage Gaps', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ---------------------------------------------------------------------------
  // Floor filter
  // ---------------------------------------------------------------------------

  describe('floor filter', () => {
    it('should return only devices on the specified floor', async () => {
      const deviceFloor1 = createDeviceInput({
        _id: 'health_floor1_dev',
        type: 'temperature',
        status: 'active',
        location: {
          building_id: 'building_a',
          floor: 1,
          room_name: 'Room 101',
          zone: 'Zone A',
        },
      });
      const deviceFloor2 = createDeviceInput({
        _id: 'health_floor2_dev',
        type: 'humidity',
        status: 'active',
        location: {
          building_id: 'building_a',
          floor: 2,
          room_name: 'Room 201',
          zone: 'Zone B',
        },
      });
      const deviceFloor2b = createDeviceInput({
        _id: 'health_floor2_dev_b',
        type: 'power',
        status: 'offline',
        location: {
          building_id: 'building_a',
          floor: 2,
          room_name: 'Room 202',
          zone: 'Zone B',
        },
      });
      await DeviceV2.insertMany([deviceFloor1, deviceFloor2, deviceFloor2b]);

      const request = createMockGetRequest({ floor: '2' });
      const response = await GET(request);
      const data: HealthResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.summary.total_devices).toBe(2);
      expect(data.data!.filters_applied.floor).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Department filter
  // ---------------------------------------------------------------------------

  describe('department filter', () => {
    it('should return only devices in the specified department', async () => {
      const deviceFinance = createDeviceInput({
        _id: 'health_fin_dev',
        type: 'temperature',
        status: 'active',
        metadata: {
          tags: ['test'],
          department: 'Finance',
          cost_center: 'CC-FIN',
        },
      });
      const deviceEng = createDeviceInput({
        _id: 'health_eng_dev',
        type: 'humidity',
        status: 'active',
        metadata: {
          tags: ['test'],
          department: 'Engineering',
          cost_center: 'CC-ENG',
        },
      });
      await DeviceV2.insertMany([deviceFinance, deviceEng]);

      const request = createMockGetRequest({ department: 'Finance' });
      const response = await GET(request);
      const data: HealthResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.summary.total_devices).toBe(1);
      expect(data.data!.filters_applied.department).toBe('Finance');
    });
  });

  // ---------------------------------------------------------------------------
  // Empty database — health_score=100, uptime_stats fallback
  // ---------------------------------------------------------------------------

  describe('empty database', () => {
    it('should return health_score=100 and default uptime_stats when no devices exist', async () => {
      const request = createMockGetRequest({});
      const response = await GET(request);
      const data: HealthResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.summary.total_devices).toBe(0);
      expect(data.data!.summary.health_score).toBe(100);
      expect(data.data!.summary.uptime_stats).toEqual({
        avg_uptime: 100,
        min_uptime: 100,
        max_uptime: 100,
        total_errors: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Predictive maintenance — battery_critical
  // ---------------------------------------------------------------------------

  describe('predictive maintenance', () => {
    it('should flag battery_critical when battery_level < 15', async () => {
      await DeviceV2.create({
        ...createDeviceInput({
          _id: 'pm_battery_dev',
          type: 'temperature',
          status: 'active',
        }),
        health: {
          battery_level: 10,
          last_seen: new Date(),
          uptime_percentage: 95,
          error_count: 0,
        },
      });

      const request = createMockGetRequest({});
      const response = await GET(request);
      const data: HealthResponse = await response.json();

      expect(response.status).toBe(200);
      const pmDevices = data.data!.alerts.predictive_maintenance.devices;
      expect(pmDevices.length).toBeGreaterThanOrEqual(1);
      const batteryDevice = pmDevices.find(d => d.id === 'pm_battery_dev');
      expect(batteryDevice).toBeDefined();
      expect(batteryDevice!.issue_type).toBe('battery_critical');
      expect(batteryDevice!.severity).toBe('critical');
    });

    // -------------------------------------------------------------------------
    // Predictive maintenance — maintenance_overdue
    // -------------------------------------------------------------------------

    it('should flag maintenance_overdue when next_maintenance is in the past', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await DeviceV2.create({
        ...createDeviceInput({
          _id: 'pm_overdue_dev',
          type: 'humidity',
          status: 'active',
        }),
        metadata: {
          tags: ['test'],
          department: 'Engineering',
          cost_center: 'CC-001',
          next_maintenance: twoDaysAgo,
        },
        health: {
          battery_level: 90,
          last_seen: new Date(),
          uptime_percentage: 95,
          error_count: 0,
        },
      });

      const request = createMockGetRequest({});
      const response = await GET(request);
      const data: HealthResponse = await response.json();

      expect(response.status).toBe(200);
      const pmDevices = data.data!.alerts.predictive_maintenance.devices;
      const overdueDevice = pmDevices.find(d => d.id === 'pm_overdue_dev');
      expect(overdueDevice).toBeDefined();
      expect(overdueDevice!.issue_type).toBe('maintenance_overdue');
      expect(overdueDevice!.severity).toBe('critical');
      expect(overdueDevice!.days_until).not.toBeNull();
      expect(overdueDevice!.days_until!).toBeLessThan(0);
    });

    // -------------------------------------------------------------------------
    // Predictive maintenance — maintenance_due
    // -------------------------------------------------------------------------

    it('should flag maintenance_due when next_maintenance is within 3 days', async () => {
      const oneDayFromNow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
      await DeviceV2.create({
        ...createDeviceInput({
          _id: 'pm_due_dev',
          type: 'co2',
          status: 'active',
        }),
        metadata: {
          tags: ['test'],
          department: 'Engineering',
          cost_center: 'CC-001',
          next_maintenance: oneDayFromNow,
        },
        health: {
          battery_level: 90,
          last_seen: new Date(),
          uptime_percentage: 95,
          error_count: 0,
        },
      });

      const request = createMockGetRequest({});
      const response = await GET(request);
      const data: HealthResponse = await response.json();

      expect(response.status).toBe(200);
      const pmDevices = data.data!.alerts.predictive_maintenance.devices;
      const dueDevice = pmDevices.find(d => d.id === 'pm_due_dev');
      expect(dueDevice).toBeDefined();
      expect(dueDevice!.issue_type).toBe('maintenance_due');
      expect(dueDevice!.severity).toBe('critical');
      expect(dueDevice!.days_until).toBeGreaterThanOrEqual(0);
      expect(dueDevice!.days_until!).toBeLessThanOrEqual(3);
    });

    // -------------------------------------------------------------------------
    // Predictive maintenance — high_error_count
    // -------------------------------------------------------------------------

    it('should flag high_error_count when error_count > 10', async () => {
      await DeviceV2.create({
        ...createDeviceInput({
          _id: 'pm_error_dev',
          type: 'power',
          status: 'active',
        }),
        health: {
          battery_level: 90,
          last_seen: new Date(),
          uptime_percentage: 80,
          error_count: 15,
        },
      });

      const request = createMockGetRequest({});
      const response = await GET(request);
      const data: HealthResponse = await response.json();

      expect(response.status).toBe(200);
      const pmDevices = data.data!.alerts.predictive_maintenance.devices;
      const errorDevice = pmDevices.find(d => d.id === 'pm_error_dev');
      expect(errorDevice).toBeDefined();
      expect(errorDevice!.issue_type).toBe('high_error_count');
      expect(errorDevice!.severity).toBe('critical');
    });
  });

  // ---------------------------------------------------------------------------
  // offline_threshold_minutes parameter
  // ---------------------------------------------------------------------------

  describe('offline_threshold_minutes parameter', () => {
    it('should detect device as offline with a short threshold but online with a longer one', async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      await DeviceV2.create({
        ...createDeviceInput({
          _id: 'threshold_offline_dev',
          type: 'temperature',
          status: 'active',
        }),
        health: {
          battery_level: 80,
          last_seen: tenMinutesAgo,
          uptime_percentage: 95,
          error_count: 0,
        },
      });

      // With threshold of 5 minutes: device should be offline
      const requestShort = createMockGetRequest({ offline_threshold_minutes: '5' });
      const responseShort = await GET(requestShort);
      const dataShort: HealthResponse = await responseShort.json();

      expect(responseShort.status).toBe(200);
      expect(dataShort.data!.alerts.offline_devices.count).toBeGreaterThanOrEqual(1);
      expect(dataShort.data!.alerts.offline_devices.threshold_minutes).toBe(5);

      // With threshold of 15 minutes: device should NOT be offline
      const requestLong = createMockGetRequest({ offline_threshold_minutes: '15' });
      const responseLong = await GET(requestLong);
      const dataLong: HealthResponse = await responseLong.json();

      expect(responseLong.status).toBe(200);
      // The device's last_seen is 10 mins ago, which is within the 15-min threshold
      const offlineIds = dataLong.data!.alerts.offline_devices.devices.map(
        (d: any) => d._id
      );
      expect(offlineIds).not.toContain('threshold_offline_dev');
    });
  });

  // ---------------------------------------------------------------------------
  // battery_warning_threshold parameter
  // ---------------------------------------------------------------------------

  describe('battery_warning_threshold parameter', () => {
    it('should detect low battery with higher threshold but not with lower one', async () => {
      await DeviceV2.create({
        ...createDeviceInput({
          _id: 'battery_threshold_dev',
          type: 'humidity',
          status: 'active',
        }),
        health: {
          battery_level: 18,
          last_seen: new Date(),
          uptime_percentage: 95,
          error_count: 0,
        },
      });

      // With threshold of 20: battery_level=18 should be flagged
      const requestHigh = createMockGetRequest({ battery_warning_threshold: '20' });
      const responseHigh = await GET(requestHigh);
      const dataHigh: HealthResponse = await responseHigh.json();

      expect(responseHigh.status).toBe(200);
      expect(dataHigh.data!.alerts.low_battery_devices.count).toBeGreaterThanOrEqual(1);
      expect(dataHigh.data!.alerts.low_battery_devices.threshold_percent).toBe(20);

      // With threshold of 15: battery_level=18 should NOT be flagged
      const requestLow = createMockGetRequest({ battery_warning_threshold: '15' });
      const responseLow = await GET(requestLow);
      const dataLow: HealthResponse = await responseLow.json();

      expect(responseLow.status).toBe(200);
      const lowBatteryIds = dataLow.data!.alerts.low_battery_devices.devices.map(
        (d: any) => d._id
      );
      expect(lowBatteryIds).not.toContain('battery_threshold_dev');
    });
  });
});
