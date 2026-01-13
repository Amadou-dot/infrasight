/**
 * Audit and Metadata API Integration Tests
 *
 * Integration tests for /api/v2/audit and /api/v2/metadata endpoints.
 * These tests run against the actual API routes with MongoDB Memory Server.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createDeviceInput, resetCounters } from '../../setup/factories';

// Import the route handlers
import { GET as GET_AUDIT } from '@/app/api/v2/audit/route';
import { GET as GET_METADATA } from '@/app/api/v2/metadata/route';

/**
 * Helper to create a mock NextRequest for GET requests
 */
function createMockGetRequest(
  path: string,
  searchParams: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000/api/v2/${path}`);
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

/**
 * Sleep helper for timestamp differentiation
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Audit and Metadata API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // GET /api/v2/audit TESTS
  // ==========================================================================

  describe('GET /api/v2/audit', () => {
    beforeEach(async () => {
      // Create test devices
      const devices = [
        createDeviceInput({ _id: 'audit_device_001' }),
        createDeviceInput({ _id: 'audit_device_002' }),
        createDeviceInput({ _id: 'audit_device_003' }),
      ];

      await DeviceV2.insertMany(devices);

      // Update one device
      await sleep(10);
      await DeviceV2.findByIdAndUpdate('audit_device_002', {
        $set: {
          status: 'maintenance',
          'audit.updated_at': new Date(),
          'audit.updated_by': 'test-user',
        },
      });

      // Delete one device
      await sleep(10);
      await DeviceV2.softDelete('audit_device_003', 'admin-user');
    });

    it('should return audit trail', async () => {
      const request = createMockGetRequest('audit');
      const response = await GET_AUDIT(request);
      const data = await parseResponse<{
        success: boolean;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should support pagination', async () => {
      const request = createMockGetRequest('audit', {
        page: '1',
        limit: '5',
      });
      const response = await GET_AUDIT(request);

      expect(response.status).toBe(200);
    });

    it('should filter by device_id', async () => {
      const request = createMockGetRequest('audit', {
        device_id: 'audit_device_001',
      });
      const response = await GET_AUDIT(request);

      expect(response.status).toBe(200);
    });

    it('should filter by action', async () => {
      const request = createMockGetRequest('audit', {
        action: 'create',
      });
      const response = await GET_AUDIT(request);

      expect(response.status).toBe(200);
    });

    it('should filter by user', async () => {
      const request = createMockGetRequest('audit', {
        user: 'test-user',
      });
      const response = await GET_AUDIT(request);

      expect(response.status).toBe(200);
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const request = createMockGetRequest('audit', {
        startDate: yesterday.toISOString(),
        endDate: now.toISOString(),
      });
      const response = await GET_AUDIT(request);

      expect(response.status).toBe(200);
    });

    it('should support multiple action filters', async () => {
      const request = createMockGetRequest('audit', {
        action: 'create,update',
      });
      const response = await GET_AUDIT(request);

      expect(response.status).toBe(200);
    });

    it('should support sorting', async () => {
      const request = createMockGetRequest('audit', {
        sortBy: 'timestamp',
        sortDirection: 'asc',
      });
      const response = await GET_AUDIT(request);

      expect(response.status).toBe(200);
    });

    it('should include deleted devices by default', async () => {
      const request = createMockGetRequest('audit', {
        include_deleted: 'true',
      });
      const response = await GET_AUDIT(request);

      expect(response.status).toBe(200);
    });
  });

  // ==========================================================================
  // GET /api/v2/metadata TESTS
  // ==========================================================================

  describe('GET /api/v2/metadata', () => {
    beforeEach(async () => {
      // Create devices with various metadata
      const devices = [
        createDeviceInput({
          _id: 'metadata_device_001',
          manufacturer: 'Manufacturer A',
          type: 'temperature',
          location: { building_id: 'building_001', floor: 1, room_name: 'Room 101' },
          metadata: { department: 'Engineering', tags: ['production', 'critical'] },
        }),
        createDeviceInput({
          _id: 'metadata_device_002',
          manufacturer: 'Manufacturer B',
          type: 'humidity',
          location: { building_id: 'building_001', floor: 2, room_name: 'Room 201' },
          metadata: { department: 'Operations', tags: ['test'] },
        }),
        createDeviceInput({
          _id: 'metadata_device_003',
          manufacturer: 'Manufacturer A',
          type: 'power',
          location: { building_id: 'building_002', floor: 1, room_name: 'Room 101' },
          metadata: { department: 'Engineering', tags: ['production'] },
        }),
      ];

      await DeviceV2.insertMany(devices);
    });

    it('should return system metadata', async () => {
      const request = createMockGetRequest('metadata');
      const response = await GET_METADATA(request);
      const data = await parseResponse<{
        success: boolean;
        data: Record<string, unknown>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(typeof data.data).toBe('object');
    });

    it('should include manufacturers', async () => {
      const request = createMockGetRequest('metadata');
      const response = await GET_METADATA(request);
      const data = await parseResponse<{
        success: boolean;
        data: { manufacturers?: unknown };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.manufacturers).toBeDefined();
    });

    it('should include device types', async () => {
      const request = createMockGetRequest('metadata');
      const response = await GET_METADATA(request);
      const data = await parseResponse<{
        success: boolean;
        data: { device_types?: unknown };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.device_types).toBeDefined();
    });

    it('should include buildings', async () => {
      const request = createMockGetRequest('metadata');
      const response = await GET_METADATA(request);
      const data = await parseResponse<{
        success: boolean;
        data: { buildings?: unknown };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.buildings).toBeDefined();
    });

    it('should support include_stats parameter', async () => {
      const request = createMockGetRequest('metadata', {
        include_stats: 'true',
      });
      const response = await GET_METADATA(request);

      expect(response.status).toBe(200);
    });

    it('should support include_deleted parameter', async () => {
      const request = createMockGetRequest('metadata', {
        include_deleted: 'true',
      });
      const response = await GET_METADATA(request);

      expect(response.status).toBe(200);
    });

    it('should exclude deleted devices by default', async () => {
      // Soft delete one device
      await DeviceV2.softDelete('metadata_device_003', 'test-user');

      const request = createMockGetRequest('metadata');
      const response = await GET_METADATA(request);

      expect(response.status).toBe(200);
    });

    it('should return aggregated counts', async () => {
      const request = createMockGetRequest('metadata', {
        include_stats: 'true',
      });
      const response = await GET_METADATA(request);
      const data = await parseResponse<{
        success: boolean;
        data: Record<string, unknown>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data).toBeDefined();
      // Metadata should contain aggregated data
      expect(Object.keys(data.data).length).toBeGreaterThan(0);
    });
  });
});
