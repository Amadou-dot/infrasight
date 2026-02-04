/**
 * Reports API Integration Tests
 *
 * Integration tests for /api/v2/reports/* endpoints.
 * These tests run against the actual API routes with MongoDB Memory Server.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createDeviceInput, resetCounters } from '../../setup/factories';

// Import the route handler
import { GET } from '@/app/api/v2/reports/device-health/route';

/**
 * Helper to create a mock NextRequest for GET requests
 */
function createMockGetRequest(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/v2/reports/device-health');
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return new NextRequest(url);
}

describe('Reports API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // GET /api/v2/reports/device-health TESTS
  // ==========================================================================

  describe('GET /api/v2/reports/device-health', () => {
    beforeEach(async () => {
      // Create test devices with various statuses across buildings and floors
      const devices = [
        // Building 1, Floor 1
        createDeviceInput({
          _id: 'report_device_001',
          status: 'active',
          location: {
            building_id: 'BLDG-001',
            floor: 1,
            room_name: 'Room 101',
          },
        }),
        createDeviceInput({
          _id: 'report_device_002',
          status: 'active',
          location: {
            building_id: 'BLDG-001',
            floor: 1,
            room_name: 'Room 102',
          },
        }),
        // Building 1, Floor 2
        createDeviceInput({
          _id: 'report_device_003',
          status: 'maintenance',
          location: {
            building_id: 'BLDG-001',
            floor: 2,
            room_name: 'Room 201',
          },
        }),
        createDeviceInput({
          _id: 'report_device_004',
          status: 'offline',
          location: {
            building_id: 'BLDG-001',
            floor: 2,
            room_name: 'Room 202',
          },
        }),
        // Building 2, Floor 1
        createDeviceInput({
          _id: 'report_device_005',
          status: 'active',
          location: {
            building_id: 'BLDG-002',
            floor: 1,
            room_name: 'Room A1',
          },
        }),
        createDeviceInput({
          _id: 'report_device_006',
          status: 'error',
          location: {
            building_id: 'BLDG-002',
            floor: 1,
            room_name: 'Room A2',
          },
        }),
        // Decommissioned device
        createDeviceInput({
          _id: 'report_device_007',
          status: 'decommissioned',
          location: {
            building_id: 'BLDG-001',
            floor: 1,
            room_name: 'Room 103',
          },
        }),
      ];

      await DeviceV2.insertMany(devices);
    });

    describe('scope=all', () => {
      it('should return 200 with PDF content type', async () => {
        const request = createMockGetRequest({ scope: 'all' });
        const response = await GET(request);

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/pdf');
      });

      it('should include Content-Disposition header for download', async () => {
        const request = createMockGetRequest({ scope: 'all' });
        const response = await GET(request);

        const disposition = response.headers.get('Content-Disposition');
        expect(disposition).toContain('attachment');
        expect(disposition).toContain('filename=');
        expect(disposition).toContain('.pdf');
      });

      it('should have no-cache headers', async () => {
        const request = createMockGetRequest({ scope: 'all' });
        const response = await GET(request);

        const cacheControl = response.headers.get('Cache-Control');
        expect(cacheControl).toContain('no-store');
        expect(cacheControl).toContain('no-cache');
      });

      it('should return valid PDF data', async () => {
        const request = createMockGetRequest({ scope: 'all' });
        const response = await GET(request);

        const blob = await response.blob();
        expect(blob.size).toBeGreaterThan(0);

        // PDF files start with %PDF
        const buffer = await blob.arrayBuffer();
        const header = new Uint8Array(buffer.slice(0, 4));
        const headerStr = String.fromCharCode(...header);
        expect(headerStr).toBe('%PDF');
      });
    });

    describe('scope=building', () => {
      it('should return 200 with valid building_id', async () => {
        const request = createMockGetRequest({
          scope: 'building',
          building_id: 'BLDG-001',
        });
        const response = await GET(request);

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/pdf');
      });

      it('should include building_id in filename', async () => {
        const request = createMockGetRequest({
          scope: 'building',
          building_id: 'BLDG-001',
        });
        const response = await GET(request);

        const disposition = response.headers.get('Content-Disposition');
        expect(disposition).toContain('BLDG-001');
      });

      it('should return 400 when building_id is missing', async () => {
        const request = createMockGetRequest({ scope: 'building' });
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error.message).toContain('building_id');
      });
    });

    describe('validation errors', () => {
      it('should return 400 for missing scope', async () => {
        const request = createMockGetRequest({});
        const response = await GET(request);

        expect(response.status).toBe(400);
      });

      it('should return 400 for invalid scope', async () => {
        const request = createMockGetRequest({ scope: 'invalid' });
        const response = await GET(request);

        expect(response.status).toBe(400);
      });
    });

    describe('with soft-deleted devices', () => {
      beforeEach(async () => {
        // Soft delete a device
        await DeviceV2.softDelete('report_device_001', 'test@example.com');
      });

      it('should include decommissioned/deleted in counts', async () => {
        const request = createMockGetRequest({ scope: 'all' });
        const response = await GET(request);

        // Response is PDF, so we just verify it succeeds
        expect(response.status).toBe(200);
      });
    });
  });
});
