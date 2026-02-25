/**
 * Analytics API Integration Tests
 *
 * Integration tests for /api/v2/analytics/* endpoints.
 * These tests run against the actual API routes with MongoDB Memory Server.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  createDeviceInput,
  createReadingV2Input,
  createAnomalyReadingV2,
  resetCounters,
} from '../../setup/factories';

// Import the route handlers
import { GET as GET_ANOMALIES } from '@/app/api/v2/analytics/anomalies/route';
import { GET as GET_ENERGY } from '@/app/api/v2/analytics/energy/route';
import { GET as GET_HEALTH } from '@/app/api/v2/analytics/health/route';
import { GET as GET_MAINTENANCE } from '@/app/api/v2/analytics/maintenance-forecast/route';
import { GET as GET_TEMPERATURE } from '@/app/api/v2/analytics/temperature-correlation/route';

/**
 * Helper to create a mock NextRequest for GET requests
 */
function createMockGetRequest(
  path: string,
  searchParams: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000/api/v2/analytics/${path}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return new NextRequest(url);
}

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Analytics API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // GET /api/v2/analytics/anomalies TESTS
  // ==========================================================================

  describe('GET /api/v2/analytics/anomalies', () => {
    beforeEach(async () => {
      // Create test devices with different types
      const devices = [
        createDeviceInput({ _id: 'anomaly_device_001', type: 'temperature' }),
        createDeviceInput({ _id: 'anomaly_device_002', type: 'humidity' }),
      ];
      await DeviceV2.insertMany(devices);

      // Create normal readings
      const normalReadings = Array.from({ length: 5 }, () =>
        createReadingV2Input('anomaly_device_001')
      );

      // Create anomaly readings for two devices with controlled timestamps
      const now = Date.now();
      const anomalyReadings = [
        createAnomalyReadingV2('anomaly_device_001', 0.9, {
          metadata: { device_id: 'anomaly_device_001', type: 'temperature', unit: 'celsius', source: 'sensor' },
          timestamp: new Date(now - 60000),
        }),
        createAnomalyReadingV2('anomaly_device_001', 0.85, {
          metadata: { device_id: 'anomaly_device_001', type: 'temperature', unit: 'celsius', source: 'sensor' },
          timestamp: new Date(now - 120000),
        }),
        createAnomalyReadingV2('anomaly_device_002', 0.95, {
          metadata: { device_id: 'anomaly_device_002', type: 'humidity', unit: 'percent', source: 'sensor' },
          timestamp: new Date(now - 180000),
        }),
      ];

      await ReadingV2.insertMany([...normalReadings, ...anomalyReadings]);
    });

    it('should return anomaly analytics', async () => {
      const request = createMockGetRequest('anomalies');
      const response = await GET_ANOMALIES(request);
      const data = await parseResponse<{
        success: boolean;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should filter anomalies by device_id', async () => {
      const request = createMockGetRequest('anomalies', {
        device_id: 'anomaly_device_001',
      });
      const response = await GET_ANOMALIES(request);
      const data = await parseResponse<{
        success: boolean;
        data: { anomalies: Array<{ metadata: { device_id: string } }> };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.anomalies.length).toBe(2);
      expect(
        data.data.anomalies.every(
          (anomaly) => anomaly.metadata.device_id === 'anomaly_device_001'
        )
      ).toBe(true);
    });

    it('should filter anomalies by min_score', async () => {
      const request = createMockGetRequest('anomalies', {
        min_score: '0.8',
      });
      const response = await GET_ANOMALIES(request);
      const data = await parseResponse<{
        success: boolean;
        data: { anomalies: Array<{ quality: { anomaly_score: number } }> };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.anomalies.length).toBeGreaterThan(0);
      expect(
        data.data.anomalies.every(
          (anomaly) => anomaly.quality.anomaly_score >= 0.8
        )
      ).toBe(true);
    });

    it('should support pagination parameters', async () => {
      const request = createMockGetRequest('anomalies', {
        page: '1',
        limit: '1',
      });
      const response = await GET_ANOMALIES(request);
      const data = await parseResponse<{
        success: boolean;
        data: {
          anomalies: unknown[];
          pagination: { total: number; page: number; limit: number };
        };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.anomalies.length).toBeLessThanOrEqual(1);
      expect(data.data.pagination.page).toBe(1);
      expect(data.data.pagination.limit).toBe(1);
      expect(data.data.pagination.total).toBeGreaterThanOrEqual(
        data.data.anomalies.length
      );
    });

    // --- Array device_id filtering ---

    describe('Array device_id filtering', () => {
      it('should filter by comma-separated device_ids', async () => {
        const request = createMockGetRequest('anomalies', {
          device_id: 'anomaly_device_001,anomaly_device_002',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: Array<{ metadata: { device_id: string } }> };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.anomalies.length).toBe(3);
      });

      it('should return empty anomalies for non-existent device_id', async () => {
        const request = createMockGetRequest('anomalies', {
          device_id: 'device_nonexistent_999',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: unknown[] };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.anomalies.length).toBe(0);
      });
    });

    // --- Type filtering ---

    describe('Type filtering', () => {
      it('should filter by single type', async () => {
        const request = createMockGetRequest('anomalies', {
          type: 'temperature',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: Array<{ metadata: { type: string } }> };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.anomalies.length).toBe(2);
        expect(data.data.anomalies.every((a) => a.metadata.type === 'temperature')).toBe(true);
      });

      it('should filter by comma-separated types', async () => {
        const request = createMockGetRequest('anomalies', {
          type: 'temperature,humidity',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: unknown[] };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.anomalies.length).toBe(3);
      });

      it('should return empty for non-matching type', async () => {
        const request = createMockGetRequest('anomalies', {
          type: 'power',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: unknown[] };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.anomalies.length).toBe(0);
      });
    });

    // --- Time range filtering ---

    describe('Time range filtering', () => {
      it('should filter by startDate only', async () => {
        const startDate = new Date(Date.now() - 300000).toISOString(); // 5 min ago
        const request = createMockGetRequest('anomalies', { startDate });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: unknown[] };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.anomalies.length).toBe(3);
      });

      it('should filter by endDate only', async () => {
        const endDate = new Date(Date.now() - 300000).toISOString(); // 5 min ago — before all readings
        const request = createMockGetRequest('anomalies', { endDate });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: unknown[] };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.anomalies.length).toBe(0);
      });

      it('should filter by both startDate and endDate', async () => {
        const now = Date.now();
        const startDate = new Date(now - 150000).toISOString(); // 2.5 min ago
        const endDate = new Date(now).toISOString();
        const request = createMockGetRequest('anomalies', { startDate, endDate });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: unknown[] };
        }>(response);

        expect(response.status).toBe(200);
        // Only anomalies within the window (1 min and 2 min ago but not 3 min ago)
        expect(data.data.anomalies.length).toBe(2);
      });
    });

    // --- Sorting ---

    describe('Sorting', () => {
      it('should sort by anomaly_score descending', async () => {
        const request = createMockGetRequest('anomalies', {
          sortBy: 'anomaly_score',
          sortDirection: 'desc',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: Array<{ quality: { anomaly_score: number } }> };
        }>(response);

        expect(response.status).toBe(200);
        const scores = data.data.anomalies.map((a) => a.quality.anomaly_score);
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
        }
      });

      it('should sort by anomaly_score ascending', async () => {
        const request = createMockGetRequest('anomalies', {
          sortBy: 'anomaly_score',
          sortDirection: 'asc',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: Array<{ quality: { anomaly_score: number } }> };
        }>(response);

        expect(response.status).toBe(200);
        const scores = data.data.anomalies.map((a) => a.quality.anomaly_score);
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
        }
      });

      it('should sort by value', async () => {
        const request = createMockGetRequest('anomalies', {
          sortBy: 'value',
          sortDirection: 'desc',
        });
        const response = await GET_ANOMALIES(request);

        expect(response.status).toBe(200);
      });

      it('should sort by timestamp', async () => {
        const request = createMockGetRequest('anomalies', {
          sortBy: 'timestamp',
          sortDirection: 'asc',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { anomalies: Array<{ timestamp: string }> };
        }>(response);

        expect(response.status).toBe(200);
        const timestamps = data.data.anomalies.map((a) => new Date(a.timestamp).getTime());
        for (let i = 1; i < timestamps.length; i++) {
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
        }
      });
    });

    // --- Trend bucketing ---

    describe('Trend bucketing', () => {
      it('should return trends with minute granularity', async () => {
        const request = createMockGetRequest('anomalies', {
          bucket_granularity: 'minute',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { trends: Array<{ time_bucket: string; count: number; avg_score: number; max_score: number }> | null };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.trends).not.toBeNull();
        expect(data.data.trends!.length).toBeGreaterThan(0);
        // minute format: YYYY-MM-DDTHH:MM:00
        expect(data.data.trends![0].time_bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/);
        expect(typeof data.data.trends![0].count).toBe('number');
        expect(typeof data.data.trends![0].avg_score).toBe('number');
        expect(typeof data.data.trends![0].max_score).toBe('number');
      });

      it('should return trends with hour granularity', async () => {
        const request = createMockGetRequest('anomalies', {
          bucket_granularity: 'hour',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { trends: Array<{ time_bucket: string }> | null };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.trends).not.toBeNull();
        // hour format: YYYY-MM-DDTHH:00:00
        expect(data.data.trends![0].time_bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00$/);
      });

      it('should return trends with day granularity', async () => {
        const request = createMockGetRequest('anomalies', {
          bucket_granularity: 'day',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { trends: Array<{ time_bucket: string }> | null };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.trends).not.toBeNull();
        // day format: YYYY-MM-DD
        expect(data.data.trends![0].time_bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should return trends with week granularity', async () => {
        const request = createMockGetRequest('anomalies', {
          bucket_granularity: 'week',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { trends: Array<{ time_bucket: string }> | null };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.trends).not.toBeNull();
        // week format: YYYY-WNN
        expect(data.data.trends![0].time_bucket).toMatch(/^\d{4}-W\d{2}$/);
      });

      it('should return trends with month granularity', async () => {
        const request = createMockGetRequest('anomalies', {
          bucket_granularity: 'month',
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { trends: Array<{ time_bucket: string }> | null };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.trends).not.toBeNull();
        // month format: YYYY-MM
        expect(data.data.trends![0].time_bucket).toMatch(/^\d{4}-\d{2}$/);
      });

      it('should return null trends when bucket_granularity is omitted', async () => {
        const request = createMockGetRequest('anomalies');
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: { trends: unknown };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.trends).toBeNull();
      });
    });

    // --- Breakdowns ---

    describe('Breakdowns', () => {
      it('should return device breakdown with correct shape and counts', async () => {
        const request = createMockGetRequest('anomalies');
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            summary: {
              by_device: Array<{ device_id: string; count: number; avg_score: number; latest_timestamp: string }>;
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const byDevice = data.data.summary.by_device;
        expect(byDevice.length).toBe(2);

        const dev1 = byDevice.find((d) => d.device_id === 'anomaly_device_001');
        const dev2 = byDevice.find((d) => d.device_id === 'anomaly_device_002');
        expect(dev1).toBeDefined();
        expect(dev1!.count).toBe(2);
        expect(typeof dev1!.avg_score).toBe('number');
        expect(dev1!.latest_timestamp).toBeDefined();
        expect(dev2).toBeDefined();
        expect(dev2!.count).toBe(1);
      });

      it('should return type breakdown with correct shape', async () => {
        const request = createMockGetRequest('anomalies');
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            summary: {
              by_type: Array<{ type: string; count: number; avg_score: number }>;
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const byType = data.data.summary.by_type;
        expect(byType.length).toBe(2);

        const tempType = byType.find((t) => t.type === 'temperature');
        const humidType = byType.find((t) => t.type === 'humidity');
        expect(tempType).toBeDefined();
        expect(tempType!.count).toBe(2);
        expect(humidType).toBeDefined();
        expect(humidType!.count).toBe(1);
      });
    });

    // --- Filters applied ---

    describe('Filters applied', () => {
      it('should reflect query params in filters_applied', async () => {
        const request = createMockGetRequest('anomalies', {
          device_id: 'anomaly_device_001',
          type: 'temperature',
          min_score: '0.8',
          startDate: new Date(Date.now() - 300000).toISOString(),
          endDate: new Date().toISOString(),
        });
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            filters_applied: {
              device_id: unknown;
              type: unknown;
              min_score: number;
              time_range: { start: string; end: string };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.filters_applied.device_id).toBeDefined();
        expect(data.data.filters_applied.type).toBeDefined();
        expect(data.data.filters_applied.min_score).toBe(0.8);
        expect(data.data.filters_applied.time_range.start).toBeDefined();
        expect(data.data.filters_applied.time_range.end).toBeDefined();
      });

      it('should return null filters when not provided', async () => {
        const request = createMockGetRequest('anomalies');
        const response = await GET_ANOMALIES(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            filters_applied: {
              device_id: unknown;
              type: unknown;
              time_range: { start: unknown; end: unknown };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.filters_applied.device_id).toBeNull();
        expect(data.data.filters_applied.type).toBeNull();
        expect(data.data.filters_applied.time_range.start).toBeUndefined();
        expect(data.data.filters_applied.time_range.end).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // GET /api/v2/analytics/energy TESTS
  // ==========================================================================

  describe('GET /api/v2/analytics/energy', () => {
    beforeEach(async () => {
      // Create power device and readings
      const deviceData = createDeviceInput({
        _id: 'energy_device_001',
        type: 'power',
      });
      await DeviceV2.create(deviceData);

      // Create power readings
      const powerReadings = Array.from({ length: 10 }, (_, i) =>
        createReadingV2Input('energy_device_001', {
          metadata: {
            device_id: 'energy_device_001',
            type: 'power',
            unit: 'watts',
            source: 'sensor',
          },
          value: 100 + i * 10,
        })
      );

      await ReadingV2.insertMany(powerReadings);
    });

    it('should return energy analytics', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const request = createMockGetRequest('energy', {
        startDate: yesterday.toISOString(),
        endDate: now.toISOString(),
      });
      const response = await GET_ENERGY(request);
      const data = await parseResponse<{
        success: boolean;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should support aggregation types', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const request = createMockGetRequest('energy', {
        startDate: yesterday.toISOString(),
        endDate: now.toISOString(),
        aggregation: 'sum',
      });
      const response = await GET_ENERGY(request);

      expect(response.status).toBe(200);
    });

    it('should accept query with device_id and no time range', async () => {
      // Time range is optional — either device_id or startDate is required to prevent full scans
      const request = createMockGetRequest('energy', { device_id: 'device_001' });
      const response = await GET_ENERGY(request);

      expect(response.status).toBe(200);
    });

    it('should reject query without device_id or startDate', async () => {
      // The schema requires either device_id or startDate to prevent full collection scans
      const request = createMockGetRequest('energy');
      const response = await GET_ENERGY(request);

      expect(response.status).toBe(400);
    });
  });

  // ==========================================================================
  // GET /api/v2/analytics/health TESTS
  // ==========================================================================

  describe('GET /api/v2/analytics/health', () => {
    beforeEach(async () => {
      // Create devices with various health states
      const devices = [
        createDeviceInput({
          _id: 'health_device_001',
          status: 'active',
          health: {
            uptime_percentage: 99,
            error_count: 0,
            last_communication: new Date(),
            battery_level: 85,
            signal_strength: 90,
          },
        }),
        createDeviceInput({
          _id: 'health_device_002',
          status: 'offline',
          health: {
            uptime_percentage: 50,
            error_count: 2,
            last_communication: new Date(),
            battery_level: 60,
            signal_strength: 40,
          },
        }),
        createDeviceInput({
          _id: 'health_device_003',
          status: 'error',
          health: {
            uptime_percentage: 70,
            error_count: 5,
            last_communication: new Date(),
            battery_level: 30,
            signal_strength: 60,
          },
        }),
      ];

      await DeviceV2.insertMany(devices);
    });

    it('should return health analytics', async () => {
      const request = createMockGetRequest('health');
      const response = await GET_HEALTH(request);
      const data = await parseResponse<{
        success: boolean;
        data: {
          summary: { total_devices: number; active_devices: number };
          status_breakdown: Array<{ status: string; count: number }>;
        };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.summary.total_devices).toBe(3);
      expect(data.data.summary.active_devices).toBe(1);
      expect(
        data.data.status_breakdown.find((s) => s.status === 'offline')?.count
      ).toBe(1);
      expect(
        data.data.status_breakdown.find((s) => s.status === 'error')?.count
      ).toBe(1);
    });

    it('should return device health data', async () => {
      const request = createMockGetRequest('health');
      const response = await GET_HEALTH(request);
      const data = await parseResponse<{
        success: boolean;
        data: Record<string, unknown>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it('should support filtering by building', async () => {
      const request = createMockGetRequest('health', {
        building_id: 'building_001',
      });
      const response = await GET_HEALTH(request);
      const data = await parseResponse<{
        success: boolean;
        data: { summary: { total_devices: number } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.summary.total_devices).toBe(3);
    });

    // --- Filters ---

    describe('Filters', () => {
      it('should filter by floor', async () => {
        // Default factory devices are on floor 1
        const request = createMockGetRequest('health', { floor: '1' });
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            summary: { total_devices: number };
            filters_applied: { floor: number | null };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.summary.total_devices).toBe(3);
        expect(data.data.filters_applied.floor).toBe(1);
      });

      it('should filter by department', async () => {
        // Default factory devices have department 'Engineering'
        const request = createMockGetRequest('health', { department: 'Engineering' });
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            summary: { total_devices: number };
            filters_applied: { department: string | null };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.summary.total_devices).toBe(3);
        expect(data.data.filters_applied.department).toBe('Engineering');
      });

      it('should return empty results for non-existent building', async () => {
        const request = createMockGetRequest('health', { building_id: 'nonexistent_building' });
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: { summary: { total_devices: number } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.summary.total_devices).toBe(0);
      });

      it('should include filters_applied in response shape', async () => {
        const request = createMockGetRequest('health', {
          building_id: 'building_001',
          floor: '2',
          department: 'Ops',
        });
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            filters_applied: { building_id: string | null; floor: number | null; department: string | null };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.filters_applied.building_id).toBe('building_001');
        expect(data.data.filters_applied.floor).toBe(2);
        expect(data.data.filters_applied.department).toBe('Ops');
      });
    });

    // --- Offline alerts ---

    describe('Offline device alerts', () => {
      it('should detect offline devices based on last_seen threshold', async () => {
        // Create a device with old last_seen
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_offline_01',
            status: 'active',
            health: {
              uptime_percentage: 80,
              error_count: 0,
              last_communication: new Date(),
              last_seen: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
              battery_level: 80,
              signal_strength: 70,
            },
          })
        );

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              offline_devices: { count: number; devices: unknown[]; threshold_minutes: number };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.alerts.offline_devices.count).toBeGreaterThanOrEqual(1);
        expect(data.data.alerts.offline_devices.threshold_minutes).toBe(5);
      });

      it('should use custom offline_threshold_minutes', async () => {
        // Create a device with last_seen 3 minutes ago
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_offline_02',
            status: 'active',
            health: {
              uptime_percentage: 80,
              error_count: 0,
              last_communication: new Date(),
              last_seen: new Date(Date.now() - 3 * 60 * 1000), // 3 min ago
              battery_level: 80,
              signal_strength: 70,
            },
          })
        );

        // Default 5 min threshold — device should NOT be offline
        const request1 = createMockGetRequest('health', { offline_threshold_minutes: '5' });
        const response1 = await GET_HEALTH(request1);
        const data1 = await parseResponse<{
          success: boolean;
          data: { alerts: { offline_devices: { count: number; devices: Array<{ _id: string }> } } };
        }>(response1);
        const offlineIds1 = data1.data.alerts.offline_devices.devices.map((d) => d._id);
        expect(offlineIds1).not.toContain('health_offline_02');

        // 2 min threshold — device SHOULD be offline
        const request2 = createMockGetRequest('health', { offline_threshold_minutes: '2' });
        const response2 = await GET_HEALTH(request2);
        const data2 = await parseResponse<{
          success: boolean;
          data: { alerts: { offline_devices: { count: number; devices: Array<{ _id: string }> } } };
        }>(response2);
        const offlineIds2 = data2.data.alerts.offline_devices.devices.map((d) => d._id);
        expect(offlineIds2).toContain('health_offline_02');
      });
    });

    // --- Low battery alerts ---

    describe('Low battery alerts', () => {
      it('should detect low battery devices', async () => {
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_lowbat_01',
            status: 'active',
            health: {
              uptime_percentage: 90,
              error_count: 0,
              last_communication: new Date(),
              battery_level: 10,
              signal_strength: 80,
            },
          })
        );

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              low_battery_devices: {
                count: number;
                devices: Array<{ _id: string; health: { battery_level: number } }>;
                threshold_percent: number;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.alerts.low_battery_devices.count).toBeGreaterThanOrEqual(1);
        const lowBatDevice = data.data.alerts.low_battery_devices.devices.find(
          (d) => d._id === 'health_lowbat_01'
        );
        expect(lowBatDevice).toBeDefined();
        expect(lowBatDevice!.health.battery_level).toBe(10);
        expect(data.data.alerts.low_battery_devices.threshold_percent).toBe(20);
      });

      it('should use custom battery_warning_threshold', async () => {
        // Device with battery 50 — below custom threshold of 60
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_lowbat_02',
            status: 'active',
            health: {
              uptime_percentage: 90,
              error_count: 0,
              last_communication: new Date(),
              battery_level: 50,
              signal_strength: 80,
            },
          })
        );

        const request = createMockGetRequest('health', { battery_warning_threshold: '60' });
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              low_battery_devices: {
                count: number;
                devices: Array<{ _id: string }>;
                threshold_percent: number;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.alerts.low_battery_devices.threshold_percent).toBe(60);
        const ids = data.data.alerts.low_battery_devices.devices.map((d) => d._id);
        expect(ids).toContain('health_lowbat_02');
      });
    });

    // --- Error device alerts ---

    describe('Error device alerts', () => {
      it('should detect error devices', async () => {
        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              error_devices: {
                count: number;
                devices: Array<{ _id: string }>;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        // health_device_003 has status 'error' from beforeEach
        expect(data.data.alerts.error_devices.count).toBeGreaterThanOrEqual(1);
        const ids = data.data.alerts.error_devices.devices.map((d) => d._id);
        expect(ids).toContain('health_device_003');
      });
    });

    // --- Maintenance due alerts ---

    describe('Maintenance due alerts', () => {
      it('should detect devices with maintenance due within 7 days', async () => {
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_maint_01',
            status: 'active',
            metadata: {
              tags: ['test'],
              department: 'Engineering',
              cost_center: 'CC-001',
              next_maintenance: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days ahead
            },
          })
        );

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              maintenance_due: {
                count: number;
                devices: Array<{ _id: string }>;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.alerts.maintenance_due.count).toBeGreaterThanOrEqual(1);
        const ids = data.data.alerts.maintenance_due.devices.map((d) => d._id);
        expect(ids).toContain('health_maint_01');
      });

      it('should not flag devices with maintenance beyond 7 days', async () => {
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_maint_02',
            status: 'active',
            metadata: {
              tags: ['test'],
              department: 'Engineering',
              cost_center: 'CC-001',
              next_maintenance: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days ahead
            },
          })
        );

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              maintenance_due: {
                count: number;
                devices: Array<{ _id: string }>;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const ids = data.data.alerts.maintenance_due.devices.map((d) => d._id);
        expect(ids).not.toContain('health_maint_02');
      });
    });

    // --- Predictive maintenance ---

    describe('Predictive maintenance', () => {
      it('should categorize battery_critical devices', async () => {
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_pred_bat',
            status: 'active',
            health: {
              uptime_percentage: 90,
              error_count: 0,
              last_communication: new Date(),
              battery_level: 10, // < 15 → battery_critical
              signal_strength: 80,
            },
          })
        );

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              predictive_maintenance: {
                count: number;
                devices: Array<{ id: string; issue_type: string; severity: string }>;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const item = data.data.alerts.predictive_maintenance.devices.find(
          (d) => d.id === 'health_pred_bat'
        );
        expect(item).toBeDefined();
        expect(item!.issue_type).toBe('battery_critical');
        expect(item!.severity).toBe('critical');
      });

      it('should categorize maintenance_overdue devices', async () => {
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_pred_overdue',
            status: 'active',
            health: {
              uptime_percentage: 90,
              error_count: 0,
              last_communication: new Date(),
              battery_level: 80, // high battery so battery check doesn't trigger
              signal_strength: 80,
            },
            metadata: {
              tags: ['test'],
              department: 'Engineering',
              cost_center: 'CC-001',
              next_maintenance: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago → overdue
            },
          })
        );

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              predictive_maintenance: {
                count: number;
                devices: Array<{ id: string; issue_type: string; severity: string; days_until: number | null }>;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const item = data.data.alerts.predictive_maintenance.devices.find(
          (d) => d.id === 'health_pred_overdue'
        );
        expect(item).toBeDefined();
        expect(item!.issue_type).toBe('maintenance_overdue');
        expect(item!.severity).toBe('critical');
        expect(item!.days_until).toBeLessThan(0);
      });

      it('should categorize maintenance_due devices (within 3 days)', async () => {
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_pred_due',
            status: 'active',
            health: {
              uptime_percentage: 90,
              error_count: 0,
              last_communication: new Date(),
              battery_level: 80,
              signal_strength: 80,
            },
            metadata: {
              tags: ['test'],
              department: 'Engineering',
              cost_center: 'CC-001',
              next_maintenance: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day ahead → due
            },
          })
        );

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              predictive_maintenance: {
                count: number;
                devices: Array<{ id: string; issue_type: string; severity: string; days_until: number | null }>;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const item = data.data.alerts.predictive_maintenance.devices.find(
          (d) => d.id === 'health_pred_due'
        );
        expect(item).toBeDefined();
        expect(item!.issue_type).toBe('maintenance_due');
        expect(item!.severity).toBe('critical');
        expect(item!.days_until).toBeGreaterThanOrEqual(0);
        expect(item!.days_until).toBeLessThanOrEqual(3);
      });

      it('should categorize high_error_count devices', async () => {
        await DeviceV2.create(
          createDeviceInput({
            _id: 'health_pred_err',
            status: 'active',
            health: {
              uptime_percentage: 60,
              error_count: 15, // > 10
              last_communication: new Date(),
              battery_level: 80, // high battery
              signal_strength: 70,
            },
          })
        );

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            alerts: {
              predictive_maintenance: {
                count: number;
                devices: Array<{ id: string; issue_type: string; severity: string }>;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const item = data.data.alerts.predictive_maintenance.devices.find(
          (d) => d.id === 'health_pred_err'
        );
        expect(item).toBeDefined();
        expect(item!.issue_type).toBe('high_error_count');
        expect(item!.severity).toBe('critical');
      });
    });

    // --- Health score ---

    describe('Health score', () => {
      it('should return 100% health score when all devices are active', async () => {
        // Remove existing devices, insert all-active set
        await DeviceV2.deleteMany({});
        await DeviceV2.insertMany([
          createDeviceInput({ _id: 'hs_active_1', status: 'active' }),
          createDeviceInput({ _id: 'hs_active_2', status: 'active' }),
        ]);

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: { summary: { health_score: number } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.summary.health_score).toBe(100);
      });

      it('should return 0% health score when no devices are active', async () => {
        await DeviceV2.deleteMany({});
        await DeviceV2.insertMany([
          createDeviceInput({ _id: 'hs_off_1', status: 'offline' }),
          createDeviceInput({ _id: 'hs_off_2', status: 'error' }),
        ]);

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: { summary: { health_score: number } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.summary.health_score).toBe(0);
      });

      it('should return 50% health score for mixed active/inactive', async () => {
        await DeviceV2.deleteMany({});
        await DeviceV2.insertMany([
          createDeviceInput({ _id: 'hs_mix_1', status: 'active' }),
          createDeviceInput({ _id: 'hs_mix_2', status: 'offline' }),
        ]);

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: { summary: { health_score: number } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.summary.health_score).toBe(50);
      });

      it('should return 100% health score as fallback when no devices exist', async () => {
        await DeviceV2.deleteMany({});

        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: { summary: { health_score: number; total_devices: number } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.summary.total_devices).toBe(0);
        expect(data.data.summary.health_score).toBe(100);
      });
    });

    // --- Uptime stats ---

    describe('Uptime stats', () => {
      it('should return aggregated uptime stats', async () => {
        const request = createMockGetRequest('health');
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            summary: {
              uptime_stats: {
                avg_uptime: number;
                min_uptime: number;
                max_uptime: number;
                total_errors: number;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const stats = data.data.summary.uptime_stats;
        expect(typeof stats.avg_uptime).toBe('number');
        expect(typeof stats.min_uptime).toBe('number');
        expect(typeof stats.max_uptime).toBe('number');
        expect(typeof stats.total_errors).toBe('number');
        // From beforeEach: 99, 50, 70
        expect(stats.min_uptime).toBeLessThanOrEqual(stats.avg_uptime);
        expect(stats.avg_uptime).toBeLessThanOrEqual(stats.max_uptime);
      });

      it('should return default uptime stats when no devices match', async () => {
        const request = createMockGetRequest('health', { building_id: 'nonexistent' });
        const response = await GET_HEALTH(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            summary: {
              uptime_stats: {
                avg_uptime: number;
                min_uptime: number;
                max_uptime: number;
                total_errors: number;
              };
            };
          };
        }>(response);

        expect(response.status).toBe(200);
        const stats = data.data.summary.uptime_stats;
        expect(stats.avg_uptime).toBe(100);
        expect(stats.min_uptime).toBe(100);
        expect(stats.max_uptime).toBe(100);
        expect(stats.total_errors).toBe(0);
      });
    });
  });

  // ==========================================================================
  // GET /api/v2/analytics/maintenance-forecast TESTS
  // ==========================================================================

  describe('GET /api/v2/analytics/maintenance-forecast', () => {
    beforeEach(async () => {
      // Create devices with health metrics
      const devices = [
        createDeviceInput({
          _id: 'maint_device_001',
          health: {
            uptime_percentage: 95,
            error_count: 10,
            last_communication: new Date(),
            battery_level: 20, // Low battery
            signal_strength: 80,
          },
        }),
        createDeviceInput({
          _id: 'maint_device_002',
          health: {
            uptime_percentage: 99,
            error_count: 1,
            last_communication: new Date(),
            battery_level: 90,
            signal_strength: 95,
          },
        }),
      ];

      await DeviceV2.insertMany(devices);
    });

    it('should return maintenance forecast', async () => {
      const request = createMockGetRequest('maintenance-forecast');
      const response = await GET_MAINTENANCE(request);
      const data = await parseResponse<{
        success: boolean;
        data: Record<string, unknown>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it('should identify devices needing attention', async () => {
      const request = createMockGetRequest('maintenance-forecast');
      const response = await GET_MAINTENANCE(request);
      const data = await parseResponse<{
        success: boolean;
        data: Record<string, unknown>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it('should support filtering by building', async () => {
      const request = createMockGetRequest('maintenance-forecast', {
        building_id: 'building_001',
      });
      const response = await GET_MAINTENANCE(request);

      expect(response.status).toBe(200);
    });
  });

  // ==========================================================================
  // GET /api/v2/analytics/temperature-correlation TESTS
  // ==========================================================================

  describe('GET /api/v2/analytics/temperature-correlation', () => {
    beforeEach(async () => {
      // Create temperature devices
      const devices = [
        createDeviceInput({
          _id: 'temp_device_001',
          type: 'temperature',
        }),
        createDeviceInput({
          _id: 'temp_device_002',
          type: 'temperature',
        }),
      ];

      await DeviceV2.insertMany(devices);

      // Create temperature readings
      const readings = [
        ...Array.from({ length: 5 }, () =>
          createReadingV2Input('temp_device_001', {
            metadata: {
              device_id: 'temp_device_001',
              type: 'temperature',
              unit: 'celsius',
              source: 'sensor',
            },
            value: 22 + Math.random() * 3,
          })
        ),
        ...Array.from({ length: 5 }, () =>
          createReadingV2Input('temp_device_002', {
            metadata: {
              device_id: 'temp_device_002',
              type: 'temperature',
              unit: 'celsius',
              source: 'sensor',
            },
            value: 24 + Math.random() * 3,
          })
        ),
      ];

      await ReadingV2.insertMany(readings);
    });

    it('should return temperature correlation analytics', async () => {
      const request = createMockGetRequest('temperature-correlation', {
        device_id: 'temp_device_001',
        hours: '24',
      });
      const response = await GET_TEMPERATURE(request);
      const data = await parseResponse<{
        success: boolean;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should support custom threshold parameters', async () => {
      const request = createMockGetRequest('temperature-correlation', {
        device_id: 'temp_device_001',
        hours: '12',
        device_temp_threshold: '75',
        ambient_temp_threshold: '28',
      });
      const response = await GET_TEMPERATURE(request);

      expect(response.status).toBe(200);
    });

    it('should require device_id parameter', async () => {
      const request = createMockGetRequest('temperature-correlation', {
        // No device_id
      });
      const response = await GET_TEMPERATURE(request);

      expect(response.status).toBe(400);
    });
  });
});
