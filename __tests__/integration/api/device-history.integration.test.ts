/**
 * Device History API Integration Tests
 *
 * Integration tests for /api/v2/devices/[id]/history endpoint.
 * These tests run against the actual API routes with MongoDB Memory Server.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createDeviceInput, resetCounters } from '../../setup/factories';

// Import the route handler
import { GET } from '@/app/api/v2/devices/[id]/history/route';

/**
 * Helper to create a mock NextRequest for GET requests
 */
function createMockGetRequest(id: string, searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000/api/v2/devices/${id}/history`);
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

describe('Device History API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // GET /api/v2/devices/[id]/history TESTS
  // ==========================================================================

  describe('GET /api/v2/devices/[id]/history', () => {
    describe('Basic Functionality', () => {
      it('should return device creation history', async () => {
        const deviceData = createDeviceInput({ _id: 'history_device_001' });
        await DeviceV2.create(deviceData);

        const request = createMockGetRequest('history_device_001');
        const params = Promise.resolve({ id: 'history_device_001' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{
            action: string;
            timestamp: string;
            user: string;
          }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.length).toBeGreaterThanOrEqual(1);
        expect(data.data[0].action).toBe('created');
      });

      it('should include update history when device is updated', async () => {
        const deviceData = createDeviceInput({ _id: 'history_device_update' });
        await DeviceV2.create(deviceData);

        // Wait a moment to ensure different timestamps
        await sleep(10);

        // Update the device
        await DeviceV2.findByIdAndUpdate('history_device_update', {
          $set: {
            status: 'maintenance',
            'audit.updated_at': new Date(),
            'audit.updated_by': 'test-user',
          },
        });

        const request = createMockGetRequest('history_device_update');
        const params = Promise.resolve({ id: 'history_device_update' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ action: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(2);
        expect(data.data.some(h => h.action === 'created')).toBe(true);
        expect(data.data.some(h => h.action === 'updated')).toBe(true);
      });

      it('should include deletion history when device is deleted', async () => {
        const deviceData = createDeviceInput({ _id: 'history_device_delete' });
        await DeviceV2.create(deviceData);

        // Soft delete the device
        await DeviceV2.softDelete('history_device_delete', 'test-user');

        const request = createMockGetRequest('history_device_delete');
        const params = Promise.resolve({ id: 'history_device_delete' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ action: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.some(h => h.action === 'deleted')).toBe(true);
      });

      it('should return history sorted by timestamp descending', async () => {
        const deviceData = createDeviceInput({ _id: 'history_device_sort' });
        await DeviceV2.create(deviceData);

        await sleep(10);
        await DeviceV2.findByIdAndUpdate('history_device_sort', {
          $set: {
            status: 'maintenance',
            'audit.updated_at': new Date(),
          },
        });

        await sleep(10);
        await DeviceV2.softDelete('history_device_sort', 'test-user');

        const request = createMockGetRequest('history_device_sort');
        const params = Promise.resolve({ id: 'history_device_sort' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ action: string; timestamp: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(3);

        // Verify all actions are present
        const actions = data.data.map(h => h.action);
        expect(actions).toContain('created');
        expect(actions).toContain('updated');
        expect(actions).toContain('deleted');

        // Verify timestamps are in descending order
        const timestamps = data.data.map(h => new Date(h.timestamp).getTime());
        for (let i = 0; i < timestamps.length - 1; i++)
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
      });
    });

    describe('Filtering', () => {
      beforeEach(async () => {
        // Create a device with full history
        const deviceData = createDeviceInput({ _id: 'history_filter_device' });
        await DeviceV2.create(deviceData);

        await sleep(10);
        await DeviceV2.findByIdAndUpdate('history_filter_device', {
          $set: {
            status: 'maintenance',
            'audit.updated_at': new Date(),
            'audit.updated_by': 'user-a',
          },
        });

        await sleep(10);
        await DeviceV2.softDelete('history_filter_device', 'user-b');
      });

      it('should filter by action', async () => {
        const request = createMockGetRequest('history_filter_device', {
          action: 'created',
        });
        const params = Promise.resolve({ id: 'history_filter_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ action: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].action).toBe('created');
      });

      it('should filter by user', async () => {
        const request = createMockGetRequest('history_filter_device', {
          user: 'user-a',
        });
        const params = Promise.resolve({ id: 'history_filter_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ action: string; user: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].user).toBe('user-a');
        expect(data.data[0].action).toBe('updated');
      });

      it('should filter by date range', async () => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const request = createMockGetRequest('history_filter_device', {
          startDate: yesterday.toISOString(),
          endDate: tomorrow.toISOString(),
        });
        const params = Promise.resolve({ id: 'history_filter_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBeGreaterThan(0);
      });

      it('should return empty array when date range excludes all events', async () => {
        const farPast = new Date('2020-01-01');
        const stillPast = new Date('2020-01-02');

        const request = createMockGetRequest('history_filter_device', {
          startDate: farPast.toISOString(),
          endDate: stillPast.toISOString(),
        });
        const params = Promise.resolve({ id: 'history_filter_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(0);
      });

      it('should combine multiple filters', async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const request = createMockGetRequest('history_filter_device', {
          action: 'deleted',
          user: 'user-b',
          startDate: yesterday.toISOString(),
        });
        const params = Promise.resolve({ id: 'history_filter_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ action: string; user: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].action).toBe('deleted');
        expect(data.data[0].user).toBe('user-b');
      });
    });

    describe('Pagination', () => {
      it('should respect page and limit parameters', async () => {
        const deviceData = createDeviceInput({ _id: 'history_page_device' });
        await DeviceV2.create(deviceData);

        await sleep(10);
        await DeviceV2.findByIdAndUpdate('history_page_device', {
          $set: {
            status: 'maintenance',
            'audit.updated_at': new Date(),
          },
        });

        await sleep(10);
        await DeviceV2.softDelete('history_page_device', 'test-user');

        const request = createMockGetRequest('history_page_device', {
          page: '1',
          limit: '2',
        });
        const params = Promise.resolve({ id: 'history_page_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { page: number; limit: number; total: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(2);
        expect(data.pagination.page).toBe(1);
        expect(data.pagination.limit).toBe(2);
        expect(data.pagination.total).toBe(3);
      });

      it('should return empty array for out of range page', async () => {
        const deviceData = createDeviceInput({ _id: 'history_empty_page' });
        await DeviceV2.create(deviceData);

        const request = createMockGetRequest('history_empty_page', {
          page: '10',
          limit: '10',
        });
        const params = Promise.resolve({ id: 'history_empty_page' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(0);
      });
    });

    describe('Error Cases', () => {
      it('should return 404 for non-existent device', async () => {
        const request = createMockGetRequest('nonexistent_device');
        const params = Promise.resolve({ id: 'nonexistent_device' });
        const response = await GET(request, { params });

        expect(response.status).toBe(404);
      });

      it('should reject invalid device ID format', async () => {
        const request = createMockGetRequest('invalid id with spaces');
        const params = Promise.resolve({ id: 'invalid id with spaces' });
        const response = await GET(request, { params });

        expect(response.status).toBe(400);
      });

      it('should return history even for deleted devices', async () => {
        const deviceData = createDeviceInput({ _id: 'history_deleted_device' });
        await DeviceV2.create(deviceData);
        await DeviceV2.softDelete('history_deleted_device', 'test-user');

        const request = createMockGetRequest('history_deleted_device');
        const params = Promise.resolve({ id: 'history_deleted_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBeGreaterThan(0);
      });
    });

    describe('History Content', () => {
      it('should include user information in history entries', async () => {
        const deviceData = createDeviceInput({ _id: 'history_user_device' });
        await DeviceV2.create(deviceData);

        const request = createMockGetRequest('history_user_device');
        const params = Promise.resolve({ id: 'history_user_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ user: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data[0].user).toBeDefined();
      });

      it('should include timestamp in history entries', async () => {
        const deviceData = createDeviceInput({ _id: 'history_time_device' });
        await DeviceV2.create(deviceData);

        const request = createMockGetRequest('history_time_device');
        const params = Promise.resolve({ id: 'history_time_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ timestamp: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data[0].timestamp).toBeDefined();
        expect(new Date(data.data[0].timestamp)).toBeInstanceOf(Date);
      });

      it('should include changes in history entries', async () => {
        const deviceData = createDeviceInput({ _id: 'history_changes_device' });
        await DeviceV2.create(deviceData);

        const request = createMockGetRequest('history_changes_device');
        const params = Promise.resolve({ id: 'history_changes_device' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ changes?: Record<string, unknown> }>;
        }>(response);

        expect(response.status).toBe(200);
        const createdEntry = data.data.find(h => ('action' in h ? h.action === 'created' : false));
        expect(createdEntry?.changes).toBeDefined();
      });
    });
  });
});
