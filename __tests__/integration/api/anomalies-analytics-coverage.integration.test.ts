/**
 * Anomalies Analytics API – Coverage Gap Tests
 *
 * Covers uncovered paths in app/api/v2/analytics/anomalies/route.ts:
 *  - Validation error path (lines 72-78): invalid query params
 *  - Multiple device_ids comma-separated: $in branch (line 118)
 *  - Single and multiple type filters (lines 122-125)
 *  - Time range filters: startDate only, endDate only, both (lines 128-135)
 *  - Sort direction asc (line 142)
 *  - Sort by anomaly_score and value (lines 144-148)
 *  - bucket_granularity hour and day: trends populated (lines 169-199)
 *  - Empty results with bucket_granularity: trends is empty array
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  createDeviceInput,
  createAnomalyReadingV2,
  createReadingV2Input,
  resetCounters,
} from '../../setup/factories';

import { GET } from '@/app/api/v2/analytics/anomalies/route';

function createMockGetRequest(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/v2/analytics/anomalies');
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface AnomaliesResponse {
  success: boolean;
  data?: {
    anomalies: any[];
    pagination: any;
    summary: {
      total_anomalies: number;
      by_device: Array<{ device_id: string; count: number; avg_score: number }>;
      by_type: Array<{ type: string; count: number; avg_score: number }>;
    };
    trends: Array<{ time_bucket: string; count: number; avg_score: number; max_score: number }> | null;
    filters_applied: {
      device_id: string | string[] | null;
      type: string | string[] | null;
      min_score: number | undefined;
      time_range: { start: string | undefined; end: string | undefined };
    };
  };
  error?: { code: string; message: string };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Helper: seed a device and anomaly readings for it
 */
async function seedDeviceWithAnomalies(
  deviceId: string,
  type: 'temperature' | 'humidity' | 'power' = 'temperature',
  count: number = 3,
  anomalyScore: number = 0.85,
  timestampOffset: number = 0
) {
  const device = createDeviceInput({
    _id: deviceId,
    type,
    status: 'active',
  });
  await DeviceV2.create(device).catch(() => {
    // Device may already exist
  });

  const readings = [];
  const baseTime = Date.now() - timestampOffset;
  const unit = type === 'temperature' ? 'celsius' : type === 'humidity' ? 'percent' : 'watts';

  for (let i = 0; i < count; i++) {
    readings.push(
      createAnomalyReadingV2(deviceId, anomalyScore, {
        metadata: { device_id: deviceId, type, unit, source: 'sensor' },
        timestamp: new Date(baseTime - i * 60 * 60 * 1000), // 1 hour apart
      })
    );
  }
  await ReadingV2.insertMany(readings);
}

describe('Anomalies Analytics API – Coverage Gaps', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ---------------------------------------------------------------------------
  // Validation error path
  // ---------------------------------------------------------------------------

  describe('validation error path', () => {
    it('should return 400 for invalid bucket_granularity value', async () => {
      const request = createMockGetRequest({
        bucket_granularity: 'not_a_valid_granularity',
      });

      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple device_ids (comma-separated) — $in branch
  // ---------------------------------------------------------------------------

  describe('multiple device_ids filter', () => {
    it('should return anomalies from both devices when comma-separated', async () => {
      await seedDeviceWithAnomalies('anom_dev_1', 'temperature', 2);
      await seedDeviceWithAnomalies('anom_dev_2', 'humidity', 3);
      // A third device that should NOT appear
      await seedDeviceWithAnomalies('anom_dev_3', 'power', 1);

      const request = createMockGetRequest({
        device_id: 'anom_dev_1,anom_dev_2',
      });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.summary.total_anomalies).toBe(5); // 2 + 3
      const deviceIds = data.data!.summary.by_device.map(d => d.device_id);
      expect(deviceIds).toContain('anom_dev_1');
      expect(deviceIds).toContain('anom_dev_2');
      expect(deviceIds).not.toContain('anom_dev_3');
    });
  });

  // ---------------------------------------------------------------------------
  // Single type filter
  // ---------------------------------------------------------------------------

  describe('single type filter', () => {
    it('should return only anomalies of the specified type', async () => {
      await seedDeviceWithAnomalies('type_filter_dev1', 'temperature', 2);
      await seedDeviceWithAnomalies('type_filter_dev2', 'humidity', 3);

      const request = createMockGetRequest({ type: 'temperature' });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Only temperature anomalies
      expect(data.data!.summary.total_anomalies).toBe(2);
      expect(data.data!.summary.by_type.length).toBe(1);
      expect(data.data!.summary.by_type[0].type).toBe('temperature');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple type filter — $in branch
  // ---------------------------------------------------------------------------

  describe('multiple type filter', () => {
    it('should return anomalies of both specified types', async () => {
      await seedDeviceWithAnomalies('multi_type_dev1', 'temperature', 2);
      await seedDeviceWithAnomalies('multi_type_dev2', 'humidity', 3);
      await seedDeviceWithAnomalies('multi_type_dev3', 'power', 1);

      const request = createMockGetRequest({ type: 'temperature,humidity' });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.summary.total_anomalies).toBe(5); // 2 + 3
      const types = data.data!.summary.by_type.map(t => t.type);
      expect(types).toContain('temperature');
      expect(types).toContain('humidity');
      expect(types).not.toContain('power');
    });
  });

  // ---------------------------------------------------------------------------
  // Time range filters
  // ---------------------------------------------------------------------------

  describe('time range filters', () => {
    it('should filter by startDate only', async () => {
      const now = Date.now();
      // Old anomalies: 48 hours ago
      await seedDeviceWithAnomalies('time_dev1', 'temperature', 2, 0.85, 48 * 60 * 60 * 1000);
      // Recent anomalies: now
      await seedDeviceWithAnomalies('time_dev2', 'temperature', 2, 0.85, 0);

      const startDate = new Date(now - 24 * 60 * 60 * 1000).toISOString(); // 24h ago
      const request = createMockGetRequest({ startDate });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Only recent anomalies should be returned (within last 24h)
      expect(data.data!.summary.total_anomalies).toBeGreaterThanOrEqual(1);
      expect(data.data!.filters_applied.time_range.start).toBe(startDate);
    });

    it('should filter by endDate only', async () => {
      // Create anomalies now
      await seedDeviceWithAnomalies('end_dev', 'temperature', 3, 0.85, 0);

      const endDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
      const request = createMockGetRequest({ endDate });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.filters_applied.time_range.end).toBe(endDate);
      // Most anomalies are within the last 3 hours, so some may be excluded
    });

    it('should filter by both startDate and endDate', async () => {
      const now = Date.now();
      await seedDeviceWithAnomalies('range_dev', 'temperature', 5, 0.85, 0);

      const startDate = new Date(now - 12 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now + 1 * 60 * 60 * 1000).toISOString();
      const request = createMockGetRequest({ startDate, endDate });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.filters_applied.time_range.start).toBe(startDate);
      expect(data.data!.filters_applied.time_range.end).toBe(endDate);
    });
  });

  // ---------------------------------------------------------------------------
  // Sort direction: asc
  // ---------------------------------------------------------------------------

  describe('sort direction asc', () => {
    it('should return anomalies sorted in ascending order by timestamp', async () => {
      await seedDeviceWithAnomalies('sort_asc_dev', 'temperature', 3, 0.85, 0);

      const request = createMockGetRequest({ sortDirection: 'asc' });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      const anomalies = data.data!.anomalies;
      if (anomalies.length >= 2) {
        const timestamps = anomalies.map((a: any) => new Date(a.timestamp).getTime());
        for (let i = 1; i < timestamps.length; i++) {
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Sort by anomaly_score
  // ---------------------------------------------------------------------------

  describe('sort by anomaly_score', () => {
    it('should sort anomalies by anomaly_score descending', async () => {
      const device = createDeviceInput({
        _id: 'score_sort_dev',
        type: 'temperature',
        status: 'active',
      });
      await DeviceV2.create(device);

      const readings = [
        createAnomalyReadingV2('score_sort_dev', 0.6, {
          metadata: { device_id: 'score_sort_dev', type: 'temperature', unit: 'celsius', source: 'sensor' },
          timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000),
        }),
        createAnomalyReadingV2('score_sort_dev', 0.95, {
          metadata: { device_id: 'score_sort_dev', type: 'temperature', unit: 'celsius', source: 'sensor' },
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
        }),
        createAnomalyReadingV2('score_sort_dev', 0.75, {
          metadata: { device_id: 'score_sort_dev', type: 'temperature', unit: 'celsius', source: 'sensor' },
          timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
        }),
      ];
      await ReadingV2.insertMany(readings);

      const request = createMockGetRequest({ sortBy: 'anomaly_score', sortDirection: 'desc' });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      const scores = data.data!.anomalies.map((a: any) => a.quality?.anomaly_score);
      if (scores.length >= 2) {
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Sort by value
  // ---------------------------------------------------------------------------

  describe('sort by value', () => {
    it('should sort anomalies by value ascending', async () => {
      const device = createDeviceInput({
        _id: 'value_sort_dev',
        type: 'temperature',
        status: 'active',
      });
      await DeviceV2.create(device);

      const readings = [
        createAnomalyReadingV2('value_sort_dev', 0.8, {
          metadata: { device_id: 'value_sort_dev', type: 'temperature', unit: 'celsius', source: 'sensor' },
          value: 100,
          timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000),
        }),
        createAnomalyReadingV2('value_sort_dev', 0.8, {
          metadata: { device_id: 'value_sort_dev', type: 'temperature', unit: 'celsius', source: 'sensor' },
          value: 30,
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
        }),
        createAnomalyReadingV2('value_sort_dev', 0.8, {
          metadata: { device_id: 'value_sort_dev', type: 'temperature', unit: 'celsius', source: 'sensor' },
          value: 70,
          timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
        }),
      ];
      await ReadingV2.insertMany(readings);

      const request = createMockGetRequest({ sortBy: 'value', sortDirection: 'asc' });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      const values = data.data!.anomalies.map((a: any) => a.value);
      if (values.length >= 2) {
        for (let i = 1; i < values.length; i++) {
          expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // bucket_granularity=hour — trends populated
  // ---------------------------------------------------------------------------

  describe('bucket_granularity=hour', () => {
    it('should return trends array bucketed by hour', async () => {
      await seedDeviceWithAnomalies('bucket_hour_dev', 'temperature', 5, 0.85, 0);

      const request = createMockGetRequest({ bucket_granularity: 'hour' });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.trends).not.toBeNull();
      expect(Array.isArray(data.data!.trends)).toBe(true);
      expect(data.data!.trends!.length).toBeGreaterThanOrEqual(1);
      // Check trend structure
      const trend = data.data!.trends![0];
      expect(trend).toHaveProperty('time_bucket');
      expect(trend).toHaveProperty('count');
      expect(trend).toHaveProperty('avg_score');
      expect(trend).toHaveProperty('max_score');
    });
  });

  // ---------------------------------------------------------------------------
  // bucket_granularity=day — getDateFormat('day') branch
  // ---------------------------------------------------------------------------

  describe('bucket_granularity=day', () => {
    it('should return trends array bucketed by day', async () => {
      await seedDeviceWithAnomalies('bucket_day_dev', 'temperature', 3, 0.85, 0);

      const request = createMockGetRequest({ bucket_granularity: 'day' });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.trends).not.toBeNull();
      expect(Array.isArray(data.data!.trends)).toBe(true);
      expect(data.data!.trends!.length).toBeGreaterThanOrEqual(1);
      // Day format: YYYY-MM-DD
      const timeBucket = data.data!.trends![0].time_bucket;
      expect(timeBucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Empty results with bucket_granularity — trends is empty array
  // ---------------------------------------------------------------------------

  describe('empty results with bucket_granularity', () => {
    it('should return empty trends array when no anomalies meet threshold', async () => {
      // Create anomalies with low scores
      await seedDeviceWithAnomalies('empty_trend_dev', 'temperature', 2, 0.5, 0);

      const request = createMockGetRequest({
        bucket_granularity: 'day',
        min_score: '0.99',
      });
      const response = await GET(request);
      const data: AnomaliesResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.summary.total_anomalies).toBe(0);
      expect(data.data!.trends).not.toBeNull();
      expect(Array.isArray(data.data!.trends)).toBe(true);
      expect(data.data!.trends!.length).toBe(0);
    });
  });
});
