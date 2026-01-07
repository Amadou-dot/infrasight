/**
 * Single Device API Integration Tests
 *
 * Integration tests for /api/v2/devices/[id] endpoints.
 * These tests run against the actual API routes with MongoDB Memory Server.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  createDeviceInput,
  createReadingV2Input,
  resetCounters,
} from '../../setup/factories';

// Import the route handlers
import { GET, PATCH, DELETE } from '@/app/api/v2/devices/[id]/route';

/**
 * Helper to create a mock NextRequest for GET requests
 */
function createMockGetRequest(
  id: string,
  searchParams: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000/api/v2/devices/${id}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return new NextRequest(url);
}

/**
 * Helper to create a mock NextRequest for PATCH requests
 */
function createMockPatchRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v2/devices/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Helper to create a mock NextRequest for DELETE requests
 */
function createMockDeleteRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v2/devices/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Single Device API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // GET /api/v2/devices/[id] TESTS
  // ==========================================================================

  describe('GET /api/v2/devices/[id]', () => {
    describe('Successful Retrieval', () => {
      it('should return a device by ID', async () => {
        const deviceData = createDeviceInput({ _id: 'get_device_001' });
        await DeviceV2.create(deviceData);

        const request = createMockGetRequest('get_device_001');
        const params = Promise.resolve({ id: 'get_device_001' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: { _id: string; serial_number: string };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data._id).toBe('get_device_001');
        expect(data.data.serial_number).toBe(deviceData.serial_number);
      });

      it('should include recent readings when requested', async () => {
        const deviceData = createDeviceInput({ _id: 'get_device_readings' });
        await DeviceV2.create(deviceData);

        // Create some readings
        const readings = [
          createReadingV2Input('get_device_readings'),
          createReadingV2Input('get_device_readings'),
          createReadingV2Input('get_device_readings'),
        ];
        await ReadingV2.insertMany(readings);

        const request = createMockGetRequest('get_device_readings', {
          include_recent_readings: 'true',
        });
        const params = Promise.resolve({ id: 'get_device_readings' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: { _id: string; recent_readings: unknown[] };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.recent_readings).toBeDefined();
        expect(data.data.recent_readings.length).toBe(3);
      });

      it('should respect readings_limit parameter', async () => {
        const deviceData = createDeviceInput({ _id: 'get_device_limit' });
        await DeviceV2.create(deviceData);

        // Create 20 readings
        const readings = Array.from({ length: 20 }, () =>
          createReadingV2Input('get_device_limit')
        );
        await ReadingV2.insertMany(readings);

        const request = createMockGetRequest('get_device_limit', {
          include_recent_readings: 'true',
          readings_limit: '5',
        });
        const params = Promise.resolve({ id: 'get_device_limit' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: { recent_readings: unknown[] };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.recent_readings.length).toBe(5);
      });

      it('should support field projection', async () => {
        const deviceData = createDeviceInput({ _id: 'get_device_fields' });
        await DeviceV2.create(deviceData);

        const request = createMockGetRequest('get_device_fields', {
          fields: '_id,serial_number,status',
        });
        const params = Promise.resolve({ id: 'get_device_fields' });
        const response = await GET(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: Record<string, unknown>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data._id).toBeDefined();
        expect(data.data.serial_number).toBeDefined();
        expect(data.data.status).toBeDefined();
        // Manufacturer should not be included
        expect(data.data.manufacturer).toBeUndefined();
      });
    });

    describe('Error Cases', () => {
      it('should return 404 for non-existent device', async () => {
        const request = createMockGetRequest('nonexistent_device');
        const params = Promise.resolve({ id: 'nonexistent_device' });
        const response = await GET(request, { params });

        expect(response.status).toBe(404);
      });

      it('should return 410 for soft-deleted device', async () => {
        const deviceData = createDeviceInput({ _id: 'deleted_device' });
        await DeviceV2.create(deviceData);
        await DeviceV2.softDelete('deleted_device', 'test-user');

        const request = createMockGetRequest('deleted_device');
        const params = Promise.resolve({ id: 'deleted_device' });
        const response = await GET(request, { params });

        expect(response.status).toBe(410);
      });

      it('should reject invalid device ID format', async () => {
        const request = createMockGetRequest('invalid id with spaces');
        const params = Promise.resolve({ id: 'invalid id with spaces' });
        const response = await GET(request, { params });

        expect(response.status).toBe(400);
      });
    });
  });

  // ==========================================================================
  // PATCH /api/v2/devices/[id] TESTS
  // ==========================================================================

  describe('PATCH /api/v2/devices/[id]', () => {
    describe('Successful Updates', () => {
      it('should update device status', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_001' });
        await DeviceV2.create(deviceData);

        const updateData = { status: 'maintenance' as const };
        const request = createMockPatchRequest('patch_device_001', updateData);
        const params = Promise.resolve({ id: 'patch_device_001' });
        const response = await PATCH(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: { _id: string; status: string };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.status).toBe('maintenance');
      });

      it('should update serial number', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_serial' });
        await DeviceV2.create(deviceData);

        const updateData = { serial_number: 'NEW-SERIAL-001' };
        const request = createMockPatchRequest(
          'patch_device_serial',
          updateData
        );
        const params = Promise.resolve({ id: 'patch_device_serial' });
        const response = await PATCH(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: { serial_number: string };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.serial_number).toBe('NEW-SERIAL-001');
      });

      it('should update nested configuration fields', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_config' });
        await DeviceV2.create(deviceData);

        const updateData = {
          configuration: {
            threshold_warning: 35,
            threshold_critical: 40,
          },
        };
        const request = createMockPatchRequest(
          'patch_device_config',
          updateData
        );
        const params = Promise.resolve({ id: 'patch_device_config' });
        const response = await PATCH(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: { configuration: { threshold_warning: number } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.configuration.threshold_warning).toBe(35);
      });

      it('should update nested location fields', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_location' });
        await DeviceV2.create(deviceData);

        const updateData = {
          location: {
            floor: 5,
            room_name: 'Room 501',
          },
        };
        const request = createMockPatchRequest(
          'patch_device_location',
          updateData
        );
        const params = Promise.resolve({ id: 'patch_device_location' });
        const response = await PATCH(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: { location: { floor: number; room_name: string } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.location.floor).toBe(5);
        expect(data.data.location.room_name).toBe('Room 501');
      });

      it('should update multiple fields at once', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_multi' });
        await DeviceV2.create(deviceData);

        const updateData = {
          status: 'offline' as const,
          firmware_version: '2.0.0',
          configuration: {
            sampling_interval: 120,
          },
        };
        const request = createMockPatchRequest(
          'patch_device_multi',
          updateData
        );
        const params = Promise.resolve({ id: 'patch_device_multi' });
        const response = await PATCH(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: {
            status: string;
            firmware_version: string;
            configuration: { sampling_interval: number };
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.status).toBe('offline');
        expect(data.data.firmware_version).toBe('2.0.0');
        expect(data.data.configuration.sampling_interval).toBe(120);
      });

      it('should update audit trail', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_audit' });
        await DeviceV2.create(deviceData);

        const updateData = { status: 'maintenance' as const };
        const request = createMockPatchRequest('patch_device_audit', updateData);
        const params = Promise.resolve({ id: 'patch_device_audit' });
        await PATCH(request, { params });

        // Verify audit trail was updated
        const updatedDevice = await DeviceV2.findById('patch_device_audit');
        expect(updatedDevice?.audit.updated_at).toBeDefined();
        expect(updatedDevice?.audit.updated_by).toBe('sys-migration-agent');
      });
    });

    describe('Validation Errors', () => {
      it('should reject empty update object', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_empty' });
        await DeviceV2.create(deviceData);

        const updateData = {};
        const request = createMockPatchRequest('patch_device_empty', updateData);
        const params = Promise.resolve({ id: 'patch_device_empty' });
        const response = await PATCH(request, { params });

        expect(response.status).toBe(400);
      });

      it('should reject invalid status value', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_status' });
        await DeviceV2.create(deviceData);

        const updateData = { status: 'invalid_status' };
        const request = createMockPatchRequest(
          'patch_device_status',
          updateData
        );
        const params = Promise.resolve({ id: 'patch_device_status' });
        const response = await PATCH(request, { params });

        expect(response.status).toBe(400);
      });

      it('should reject invalid firmware version format', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_firmware' });
        await DeviceV2.create(deviceData);

        const updateData = { firmware_version: 'invalid' };
        const request = createMockPatchRequest(
          'patch_device_firmware',
          updateData
        );
        const params = Promise.resolve({ id: 'patch_device_firmware' });
        const response = await PATCH(request, { params });

        expect(response.status).toBe(400);
      });
    });

    describe('Error Cases', () => {
      it('should return 404 for non-existent device', async () => {
        const updateData = { status: 'maintenance' as const };
        const request = createMockPatchRequest(
          'nonexistent_device',
          updateData
        );
        const params = Promise.resolve({ id: 'nonexistent_device' });
        const response = await PATCH(request, { params });

        expect(response.status).toBe(404);
      });

      it('should return 410 for soft-deleted device', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_deleted_device' });
        await DeviceV2.create(deviceData);
        await DeviceV2.softDelete('patch_deleted_device', 'test-user');

        const updateData = { status: 'maintenance' as const };
        const request = createMockPatchRequest(
          'patch_deleted_device',
          updateData
        );
        const params = Promise.resolve({ id: 'patch_deleted_device' });
        const response = await PATCH(request, { params });

        expect(response.status).toBe(410);
      });

      it('should reject duplicate serial number', async () => {
        const device1 = createDeviceInput({ _id: 'patch_device_dup1' });
        const device2 = createDeviceInput({ _id: 'patch_device_dup2' });
        await DeviceV2.insertMany([device1, device2]);

        const updateData = { serial_number: device2.serial_number };
        const request = createMockPatchRequest('patch_device_dup1', updateData);
        const params = Promise.resolve({ id: 'patch_device_dup1' });
        const response = await PATCH(request, { params });

        expect(response.status).toBe(409);
      });

      it('should allow updating serial number to same value', async () => {
        const deviceData = createDeviceInput({ _id: 'patch_device_same' });
        await DeviceV2.create(deviceData);

        const updateData = { serial_number: deviceData.serial_number };
        const request = createMockPatchRequest('patch_device_same', updateData);
        const params = Promise.resolve({ id: 'patch_device_same' });
        const response = await PATCH(request, { params });

        expect(response.status).toBe(200);
      });
    });
  });

  // ==========================================================================
  // DELETE /api/v2/devices/[id] TESTS
  // ==========================================================================

  describe('DELETE /api/v2/devices/[id]', () => {
    describe('Successful Deletion', () => {
      it('should soft delete a device', async () => {
        const deviceData = createDeviceInput({ _id: 'delete_device_001' });
        await DeviceV2.create(deviceData);

        const request = createMockDeleteRequest('delete_device_001');
        const params = Promise.resolve({ id: 'delete_device_001' });
        const response = await DELETE(request, { params });
        const data = await parseResponse<{
          success: boolean;
          data: { _id: string; deleted: boolean; deleted_at: Date };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data._id).toBe('delete_device_001');
        expect(data.data.deleted).toBe(true);
        expect(data.data.deleted_at).toBeDefined();
      });

      it('should set deleted_at timestamp in database', async () => {
        const deviceData = createDeviceInput({ _id: 'delete_device_db' });
        await DeviceV2.create(deviceData);

        const request = createMockDeleteRequest('delete_device_db');
        const params = Promise.resolve({ id: 'delete_device_db' });
        await DELETE(request, { params });

        // Verify device is soft-deleted in database
        const device = await DeviceV2.findById('delete_device_db');
        expect(device?.audit.deleted_at).toBeDefined();
        expect(device?.audit.deleted_by).toBe('sys-migration-agent');
      });

      it('should still find device with findById after soft delete', async () => {
        const deviceData = createDeviceInput({ _id: 'delete_device_find' });
        await DeviceV2.create(deviceData);

        const request = createMockDeleteRequest('delete_device_find');
        const params = Promise.resolve({ id: 'delete_device_find' });
        await DELETE(request, { params });

        // Device should still exist in database (soft delete)
        const device = await DeviceV2.findById('delete_device_find');
        expect(device).not.toBeNull();
      });

      it('should exclude from findActive after soft delete', async () => {
        const deviceData = createDeviceInput({ _id: 'delete_device_active' });
        await DeviceV2.create(deviceData);

        const request = createMockDeleteRequest('delete_device_active');
        const params = Promise.resolve({ id: 'delete_device_active' });
        await DELETE(request, { params });

        // Should not appear in active devices
        const activeDevices = await DeviceV2.findActive({
          _id: 'delete_device_active',
        });
        expect(activeDevices.length).toBe(0);
      });
    });

    describe('Error Cases', () => {
      it('should return 404 for non-existent device', async () => {
        const request = createMockDeleteRequest('nonexistent_device');
        const params = Promise.resolve({ id: 'nonexistent_device' });
        const response = await DELETE(request, { params });

        expect(response.status).toBe(404);
      });

      it('should return 410 for already deleted device', async () => {
        const deviceData = createDeviceInput({ _id: 'delete_device_twice' });
        await DeviceV2.create(deviceData);
        await DeviceV2.softDelete('delete_device_twice', 'test-user');

        const request = createMockDeleteRequest('delete_device_twice');
        const params = Promise.resolve({ id: 'delete_device_twice' });
        const response = await DELETE(request, { params });

        expect(response.status).toBe(410);
      });

      it('should reject invalid device ID format', async () => {
        const request = createMockDeleteRequest('invalid id with spaces');
        const params = Promise.resolve({ id: 'invalid id with spaces' });
        const response = await DELETE(request, { params });

        expect(response.status).toBe(400);
      });
    });
  });
});
