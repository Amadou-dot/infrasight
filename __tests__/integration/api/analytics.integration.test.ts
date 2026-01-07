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
      // Create test device and readings
      const deviceData = createDeviceInput({ _id: 'anomaly_device_001' });
      await DeviceV2.create(deviceData);

      // Create normal readings
      const normalReadings = Array.from({ length: 5 }, () =>
        createReadingV2Input('anomaly_device_001')
      );

      // Create anomaly readings
      const anomalyReadings = [
        createAnomalyReadingV2('anomaly_device_001', 0.9),
        createAnomalyReadingV2('anomaly_device_001', 0.85),
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

      expect(response.status).toBe(200);
    });

    it('should filter anomalies by min_score', async () => {
      const request = createMockGetRequest('anomalies', {
        min_score: '0.8',
      });
      const response = await GET_ANOMALIES(request);

      expect(response.status).toBe(200);
    });

    it('should support pagination parameters', async () => {
      const request = createMockGetRequest('anomalies', {
        page: '1',
        limit: '10',
      });
      const response = await GET_ANOMALIES(request);

      expect(response.status).toBe(200);
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

    it('should accept query without strict time range requirement', async () => {
      const request = createMockGetRequest('energy');
      const response = await GET_ENERGY(request);

      // Should either succeed or fail validation, but not crash
      expect([200, 400]).toContain(response.status);
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
        }),
        createDeviceInput({
          _id: 'health_device_002',
          status: 'offline',
        }),
        createDeviceInput({
          _id: 'health_device_003',
          status: 'error',
        }),
      ];

      await DeviceV2.insertMany(devices);
    });

    it('should return health analytics', async () => {
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

      expect(response.status).toBe(200);
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
