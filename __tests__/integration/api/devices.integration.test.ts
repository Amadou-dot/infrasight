/**
 * Devices API Integration Tests
 *
 * Integration tests for /api/v2/devices endpoints.
 * These tests run against the actual API routes with MongoDB Memory Server.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  createDeviceInput,
  createDeviceInputs,
  createDeviceOfType,
  createDeviceWithStatus,
  resetCounters,
} from '../../setup/factories';

// Import the route handlers
import { GET, POST } from '@/app/api/v2/devices/route';

/**
 * Helper to create a mock NextRequest for GET requests
 */
function createMockGetRequest(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/v2/devices');
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return new NextRequest(url);
}

/**
 * Helper to create a mock NextRequest for POST requests
 */
function createMockPostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v2/devices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Devices API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // GET /api/v2/devices TESTS
  // ==========================================================================

  describe('GET /api/v2/devices', () => {
    describe('Basic Listing', () => {
      it('should return empty list when no devices exist', async () => {
        const request = createMockGetRequest();
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual([]);
        expect(data.pagination.total).toBe(0);
      });

      it('should return list of devices', async () => {
        // Create test devices
        const devices = createDeviceInputs(3);
        for (let i = 0; i < devices.length; i++) devices[i]._id = `device_list_${i}`;

        await DeviceV2.insertMany(devices);

        const request = createMockGetRequest();
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.length).toBe(3);
        expect(data.pagination.total).toBe(3);
      });

      it('should return devices with default pagination', async () => {
        // Create more devices than default limit
        const devices = createDeviceInputs(25);
        for (let i = 0; i < devices.length; i++) devices[i]._id = `device_pagination_${i}`;

        await DeviceV2.insertMany(devices);

        const request = createMockGetRequest();
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number; limit: number; page: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(20); // Default limit
        expect(data.pagination.total).toBe(25);
        expect(data.pagination.limit).toBe(20);
        expect(data.pagination.page).toBe(1);
      });
    });

    describe('Pagination', () => {
      beforeEach(async () => {
        // Create 30 devices for pagination tests
        const devices = Array.from({ length: 30 }, (_, i) =>
          createDeviceInput({
            _id: `device_page_${i.toString().padStart(2, '0')}`,
            serial_number: `SN-${i.toString().padStart(3, '0')}`,
          })
        );

        await DeviceV2.insertMany(devices);
      });

      it('should respect page and limit parameters', async () => {
        const request = createMockGetRequest({
          page: '2',
          limit: '10',
          sortBy: 'serial_number',
          sortDirection: 'asc',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ serial_number: string }>;
          pagination: { total: number; page: number; limit: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(10);
        expect(data.pagination.page).toBe(2);
        expect(data.pagination.limit).toBe(10);
        expect(data.data[0]?.serial_number).toBe('SN-010');
        expect(data.data[9]?.serial_number).toBe('SN-019');
      });

      it('should return hasNext and hasPrevious correctly', async () => {
        const request = createMockGetRequest({ page: '2', limit: '10' });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          pagination: { hasNext: boolean; hasPrevious: boolean };
        }>(response);

        expect(data.pagination.hasPrevious).toBe(true);
        expect(data.pagination.hasNext).toBe(true);
      });

      it('should return empty array for out of range page', async () => {
        const request = createMockGetRequest({ page: '100', limit: '10' });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(0);
      });
    });

    describe('Filtering', () => {
      beforeEach(async () => {
        // Create devices with different attributes
        const devices = [
          createDeviceOfType('temperature', {
            _id: 'filter_temp_1',
            status: 'active',
            location: { building_id: 'b1', floor: 1, room_name: 'Room 101' },
          }),
          createDeviceOfType('temperature', {
            _id: 'filter_temp_2',
            status: 'maintenance',
            location: { building_id: 'b1', floor: 2, room_name: 'Room 201' },
          }),
          createDeviceOfType('humidity', {
            _id: 'filter_humid_1',
            status: 'active',
            location: { building_id: 'b2', floor: 1, room_name: 'Room 101' },
          }),
          createDeviceWithStatus('offline', {
            _id: 'filter_offline_1',
            location: { building_id: 'b1', floor: 1, room_name: 'Room 102' },
          }),
        ];
        await DeviceV2.insertMany(devices);
      });

      it('should filter by status', async () => {
        const request = createMockGetRequest({ status: 'active' });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ status: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(2);
        expect(data.data.every(d => d.status === 'active')).toBe(true);
      });

      it('should filter by type', async () => {
        const request = createMockGetRequest({ type: 'humidity' });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ type: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data.every(d => d.type === 'humidity')).toBe(true);
      });

      it('should filter by building_id', async () => {
        const request = createMockGetRequest({ building_id: 'b1' });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ location: { building_id: string } }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(3);
        expect(data.data.every(d => d.location.building_id === 'b1')).toBe(true);
      });

      it('should filter by floor', async () => {
        const request = createMockGetRequest({ floor: '1' });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ location: { floor: number } }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(3);
        expect(data.data.every(d => d.location.floor === 1)).toBe(true);
      });

      it('should combine multiple filters', async () => {
        const request = createMockGetRequest({
          status: 'active',
          type: 'temperature',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ status: string; type: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].status).toBe('active');
        expect(data.data[0].type).toBe('temperature');
      });
    });

    describe('Sorting', () => {
      beforeEach(async () => {
        // Create devices with different serial numbers
        const devices = [
          createDeviceInput({
            _id: 'sort_a',
            serial_number: 'SN-AAA',
          }),
          createDeviceInput({
            _id: 'sort_c',
            serial_number: 'SN-CCC',
          }),
          createDeviceInput({
            _id: 'sort_b',
            serial_number: 'SN-BBB',
          }),
        ];
        await DeviceV2.insertMany(devices);
      });

      it('should sort by serial_number ascending', async () => {
        const request = createMockGetRequest({
          sortBy: 'serial_number',
          sortDirection: 'asc',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ serial_number: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data[0].serial_number).toBe('SN-AAA');
        expect(data.data[1].serial_number).toBe('SN-BBB');
        expect(data.data[2].serial_number).toBe('SN-CCC');
      });

      it('should sort by serial_number descending', async () => {
        const request = createMockGetRequest({
          sortBy: 'serial_number',
          sortDirection: 'desc',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ serial_number: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data[0].serial_number).toBe('SN-CCC');
        expect(data.data[1].serial_number).toBe('SN-BBB');
        expect(data.data[2].serial_number).toBe('SN-AAA');
      });
    });

    describe('Soft Delete Filtering', () => {
      beforeEach(async () => {
        // Create active and deleted devices
        const activeDevice = createDeviceInput({ _id: 'active_device' });
        const deletedDevice = createDeviceInput({ _id: 'deleted_device' });

        await DeviceV2.create(activeDevice);
        await DeviceV2.create(deletedDevice);
        await DeviceV2.softDelete('deleted_device');
      });

      it('should exclude deleted devices by default', async () => {
        const request = createMockGetRequest();
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ _id: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0]._id).toBe('active_device');
      });

      it('should include deleted devices when requested', async () => {
        const request = createMockGetRequest({ include_deleted: 'true' });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ _id: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(2);
      });

      it('should return only deleted devices when requested', async () => {
        const request = createMockGetRequest({ only_deleted: 'true' });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ _id: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0]._id).toBe('deleted_device');
      });
    });

    describe('Validation Errors', () => {
      it('should reject invalid sort field', async () => {
        const request = createMockGetRequest({ sortBy: 'invalid_field' });
        const response = await GET(request);

        expect(response.status).toBe(400);
      });

      it('should reject conflicting delete filters', async () => {
        const request = createMockGetRequest({
          include_deleted: 'true',
          only_deleted: 'true',
        });
        const response = await GET(request);

        expect(response.status).toBe(400);
      });
    });
  });

  // ==========================================================================
  // POST /api/v2/devices TESTS
  // ==========================================================================

  describe('POST /api/v2/devices', () => {
    describe('Successful Creation', () => {
      it('should create a device with valid data', async () => {
        const deviceData = createDeviceInput({ _id: 'new_device_001' });
        const request = createMockPostRequest(deviceData);
        const response = await POST(request);
        const data = await parseResponse<{
          success: boolean;
          data: { _id: string; serial_number: string };
          message: string;
        }>(response);

        expect(response.status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.data._id).toBe('new_device_001');
        expect(data.data.serial_number).toBe(deviceData.serial_number);
        expect(data.message).toBe('Device created successfully');
      });

      it('should set default values correctly', async () => {
        const deviceData = createDeviceInput({ _id: 'defaults_device' });
        const request = createMockPostRequest(deviceData);
        const response = await POST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            status: string;
            health: { uptime_percentage: number; error_count: number };
            audit: { created_by: string };
          };
        }>(response);

        expect(response.status).toBe(201);
        expect(data.data.status).toBe('active');
        expect(data.data.health.uptime_percentage).toBe(100);
        expect(data.data.health.error_count).toBe(0);
        expect(data.data.audit.created_by).toBeDefined();
      });

      it('should persist device to database', async () => {
        const deviceData = createDeviceInput({ _id: 'persist_device' });
        const request = createMockPostRequest(deviceData);
        await POST(request);

        // Verify device exists in database
        const device = await DeviceV2.findById('persist_device');
        expect(device).not.toBeNull();
        expect(device?.serial_number).toBe(deviceData.serial_number);
      });
    });

    describe('Validation Errors', () => {
      it('should reject missing required fields', async () => {
        const invalidDevice = {
          _id: 'invalid_001',
          // Missing required fields
        };

        const request = createMockPostRequest(invalidDevice);
        const response = await POST(request);

        expect(response.status).toBe(400);
      });

      it('should reject invalid device type', async () => {
        const deviceData = createDeviceInput({ _id: 'invalid_type' });
        (deviceData as Record<string, unknown>).type = 'invalid_type';

        const request = createMockPostRequest(deviceData);
        const response = await POST(request);

        expect(response.status).toBe(400);
      });

      it('should reject invalid device ID format', async () => {
        const deviceData = createDeviceInput({});
        (deviceData as Record<string, unknown>)._id = 'has spaces';

        const request = createMockPostRequest(deviceData);
        const response = await POST(request);

        expect(response.status).toBe(400);
      });

      it('should reject invalid firmware version format', async () => {
        const deviceData = createDeviceInput({ _id: 'invalid_firmware' });
        deviceData.firmware_version = 'invalid';

        const request = createMockPostRequest(deviceData);
        const response = await POST(request);

        expect(response.status).toBe(400);
      });
    });

    describe('Duplicate Detection', () => {
      it('should reject duplicate serial number', async () => {
        // Create first device
        const device1 = createDeviceInput({
          _id: 'first_device',
          serial_number: 'DUPLICATE-SN',
        });
        await DeviceV2.create(device1);

        // Try to create second device with same serial number
        const device2 = createDeviceInput({
          _id: 'second_device',
          serial_number: 'DUPLICATE-SN',
        });

        const request = createMockPostRequest(device2);
        const response = await POST(request);
        const data = await parseResponse<{
          success: boolean;
          error: { code: string };
        }>(response);

        expect(response.status).toBe(409);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('SERIAL_NUMBER_EXISTS');
      });

      it('should reject duplicate device ID', async () => {
        // Create first device
        const device1 = createDeviceInput({ _id: 'duplicate_id' });
        await DeviceV2.create(device1);

        // Try to create second device with same ID
        const device2 = createDeviceInput({ _id: 'duplicate_id' });
        device2.serial_number = 'DIFFERENT-SN';

        const request = createMockPostRequest(device2);
        const response = await POST(request);
        const data = await parseResponse<{
          success: boolean;
          error: { code: string };
        }>(response);

        expect(response.status).toBe(409);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('DEVICE_ID_EXISTS');
      });
    });
  });
});
