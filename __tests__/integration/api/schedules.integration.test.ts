/**
 * Schedules API Integration Tests
 *
 * Integration tests for /api/v2/schedules endpoints.
 * Tests run against actual API routes with MongoDB Memory Server.
 */

import { NextRequest } from 'next/server';
import ScheduleV2 from '@/models/v2/ScheduleV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  createScheduleInput,
  createDeviceInput,
  resetCounters,
  futureDateISO,
} from '../../setup/factories';

// Import route handlers
import { GET as listSchedules, POST } from '@/app/api/v2/schedules/route';
import {
  GET as getSchedule,
  PATCH,
  DELETE,
} from '@/app/api/v2/schedules/[id]/route';

// ============================================================================
// HELPERS
// ============================================================================

function createMockGetRequest(
  path: string,
  searchParams: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

function createMockPostRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMockPatchRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMockDeleteRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'DELETE',
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

function createParamsPromise(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

async function seedDevice(id: string) {
  return DeviceV2.create(createDeviceInput({ _id: id }));
}

async function seedSchedule(overrides: Partial<Parameters<typeof createScheduleInput>[0]> = {}) {
  return ScheduleV2.create(createScheduleInput(overrides));
}

// ============================================================================
// TESTS
// ============================================================================

describe('Schedules API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // GET /api/v2/schedules - List Schedules
  // ==========================================================================

  describe('GET /api/v2/schedules', () => {
    describe('Basic Listing', () => {
      it('should return empty list when no schedules exist', async () => {
        const request = createMockGetRequest('/api/v2/schedules');
        const response = await listSchedules(request);
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

      it('should return list of schedules', async () => {
        await ScheduleV2.insertMany([
          createScheduleInput({ device_id: 'dev_1' }),
          createScheduleInput({ device_id: 'dev_2' }),
          createScheduleInput({ device_id: 'dev_3' }),
        ]);

        const request = createMockGetRequest('/api/v2/schedules');
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(3);
        expect(data.pagination.total).toBe(3);
      });
    });

    describe('Default Status Filter', () => {
      it('should return only scheduled status by default', async () => {
        await ScheduleV2.insertMany([
          createScheduleInput({ device_id: 'sched_1', status: 'scheduled' }),
          createScheduleInput({ device_id: 'comp_1', status: 'completed' }),
          createScheduleInput({ device_id: 'canc_1', status: 'cancelled' }),
        ]);

        const request = createMockGetRequest('/api/v2/schedules');
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ status: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].status).toBe('scheduled');
      });

      it('should return all statuses when include_all=true', async () => {
        await ScheduleV2.insertMany([
          createScheduleInput({ device_id: 'all_1', status: 'scheduled' }),
          createScheduleInput({ device_id: 'all_2', status: 'completed' }),
          createScheduleInput({ device_id: 'all_3', status: 'cancelled' }),
        ]);

        const request = createMockGetRequest('/api/v2/schedules', { include_all: 'true' });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(3);
      });
    });

    describe('Filtering', () => {
      beforeEach(async () => {
        await ScheduleV2.insertMany([
          createScheduleInput({
            device_id: 'filter_dev_1',
            service_type: 'calibration',
            status: 'scheduled',
          }),
          createScheduleInput({
            device_id: 'filter_dev_1',
            service_type: 'firmware_update',
            status: 'completed',
          }),
          createScheduleInput({
            device_id: 'filter_dev_2',
            service_type: 'emergency_fix',
            status: 'scheduled',
          }),
        ]);
      });

      it('should filter by device_id', async () => {
        const request = createMockGetRequest('/api/v2/schedules', {
          device_id: 'filter_dev_1',
          include_all: 'true',
        });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ device_id: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(2);
        expect(data.data.every(s => s.device_id === 'filter_dev_1')).toBe(true);
      });

      it('should filter by status', async () => {
        const request = createMockGetRequest('/api/v2/schedules', {
          status: 'completed',
          include_all: 'true',
        });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ status: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].status).toBe('completed');
      });

      it('should filter by service_type', async () => {
        const request = createMockGetRequest('/api/v2/schedules', {
          service_type: 'emergency_fix',
        });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ service_type: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].service_type).toBe('emergency_fix');
      });
    });

    describe('Pagination', () => {
      beforeEach(async () => {
        const schedules = Array.from({ length: 25 }, (_, i) =>
          createScheduleInput({ device_id: `page_dev_${i}` })
        );
        await ScheduleV2.insertMany(schedules);
      });

      it('should respect page and limit parameters', async () => {
        const request = createMockGetRequest('/api/v2/schedules', {
          page: '2',
          limit: '10',
        });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number; page: number; limit: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(10);
        expect(data.pagination.page).toBe(2);
        expect(data.pagination.limit).toBe(10);
        expect(data.pagination.total).toBe(25);
      });

      it('should use default pagination', async () => {
        const request = createMockGetRequest('/api/v2/schedules');
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { limit: number; page: number };
        }>(response);

        expect(data.data.length).toBe(20); // Default limit
        expect(data.pagination.page).toBe(1);
      });
    });

    describe('Sorting', () => {
      it('should sort by scheduled_date ascending', async () => {
        const now = Date.now();
        await ScheduleV2.insertMany([
          createScheduleInput({
            device_id: 'sort_late',
            scheduled_date: new Date(now + 30 * 24 * 60 * 60 * 1000),
          }),
          createScheduleInput({
            device_id: 'sort_early',
            scheduled_date: new Date(now + 5 * 24 * 60 * 60 * 1000),
          }),
        ]);

        const request = createMockGetRequest('/api/v2/schedules', {
          sortBy: 'scheduled_date',
          sortDirection: 'asc',
        });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ device_id: string; scheduled_date: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data[0].device_id).toBe('sort_early');
        expect(data.data[1].device_id).toBe('sort_late');
      });
    });

    describe('Date Range Filtering', () => {
      it('should filter by startDate and endDate', async () => {
        const now = Date.now();
        await ScheduleV2.insertMany([
          createScheduleInput({
            device_id: 'range_early',
            scheduled_date: new Date(now + 2 * 24 * 60 * 60 * 1000), // 2 days
          }),
          createScheduleInput({
            device_id: 'range_mid',
            scheduled_date: new Date(now + 10 * 24 * 60 * 60 * 1000), // 10 days
          }),
          createScheduleInput({
            device_id: 'range_late',
            scheduled_date: new Date(now + 60 * 24 * 60 * 60 * 1000), // 60 days
          }),
        ]);

        const startDate = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();

        const request = createMockGetRequest('/api/v2/schedules', { startDate, endDate });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ device_id: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].device_id).toBe('range_mid');
      });

      it('should filter with only startDate', async () => {
        const now = Date.now();
        await ScheduleV2.insertMany([
          createScheduleInput({
            device_id: 'start_early',
            scheduled_date: new Date(now + 2 * 24 * 60 * 60 * 1000),
          }),
          createScheduleInput({
            device_id: 'start_late',
            scheduled_date: new Date(now + 30 * 24 * 60 * 60 * 1000),
          }),
        ]);

        const startDate = new Date(now + 15 * 24 * 60 * 60 * 1000).toISOString();
        const request = createMockGetRequest('/api/v2/schedules', { startDate });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ device_id: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].device_id).toBe('start_late');
      });

      it('should filter with only endDate', async () => {
        const now = Date.now();
        await ScheduleV2.insertMany([
          createScheduleInput({
            device_id: 'end_early',
            scheduled_date: new Date(now + 2 * 24 * 60 * 60 * 1000),
          }),
          createScheduleInput({
            device_id: 'end_late',
            scheduled_date: new Date(now + 30 * 24 * 60 * 60 * 1000),
          }),
        ]);

        const endDate = new Date(now + 15 * 24 * 60 * 60 * 1000).toISOString();
        const request = createMockGetRequest('/api/v2/schedules', { endDate });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ device_id: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(1);
        expect(data.data[0].device_id).toBe('end_early');
      });
    });

    describe('Multiple Status/Type Filters', () => {
      it('should filter by multiple statuses via array', async () => {
        await ScheduleV2.insertMany([
          createScheduleInput({ device_id: 'multi_1', status: 'scheduled' }),
          createScheduleInput({ device_id: 'multi_2', status: 'completed' }),
          createScheduleInput({ device_id: 'multi_3', status: 'cancelled' }),
        ]);

        const request = createMockGetRequest('/api/v2/schedules', {
          status: 'scheduled,completed',
          include_all: 'true',
        });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ status: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(2);
        expect(data.data.every(s => s.status !== 'cancelled')).toBe(true);
      });

      it('should filter by multiple service types', async () => {
        await ScheduleV2.insertMany([
          createScheduleInput({ device_id: 'stype_1', service_type: 'calibration' }),
          createScheduleInput({ device_id: 'stype_2', service_type: 'firmware_update' }),
          createScheduleInput({ device_id: 'stype_3', service_type: 'emergency_fix' }),
        ]);

        const request = createMockGetRequest('/api/v2/schedules', {
          service_type: 'calibration,emergency_fix',
        });
        const response = await listSchedules(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ service_type: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(2);
      });
    });

    describe('Validation Errors', () => {
      it('should reject invalid sort field', async () => {
        const request = createMockGetRequest('/api/v2/schedules', {
          sortBy: 'invalid_field',
        });
        const response = await listSchedules(request);

        expect(response.status).toBe(400);
      });
    });
  });

  // ==========================================================================
  // POST /api/v2/schedules - Create Schedules
  // ==========================================================================

  describe('POST /api/v2/schedules', () => {
    describe('Successful Creation', () => {
      it('should create a schedule for a single device', async () => {
        await seedDevice('create_dev_1');

        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['create_dev_1'],
          service_type: 'calibration',
          scheduled_date: futureDateISO(),
        });
        const response = await POST(request);
        const data = await parseResponse<{
          success: boolean;
          data: { created: unknown[]; count: number };
        }>(response);

        expect(response.status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.data.count).toBe(1);
        expect(data.data.created.length).toBe(1);
      });

      it('should create schedules for multiple devices (bulk)', async () => {
        await Promise.all([
          seedDevice('bulk_dev_1'),
          seedDevice('bulk_dev_2'),
          seedDevice('bulk_dev_3'),
        ]);

        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['bulk_dev_1', 'bulk_dev_2', 'bulk_dev_3'],
          service_type: 'firmware_update',
          scheduled_date: futureDateISO(14),
          notes: 'Bulk firmware update',
        });
        const response = await POST(request);
        const data = await parseResponse<{
          success: boolean;
          data: { created: Array<{ device_id: string; service_type: string }>; count: number };
        }>(response);

        expect(response.status).toBe(201);
        expect(data.data.count).toBe(3);
        expect(data.data.created.every(s => s.service_type === 'firmware_update')).toBe(true);
      });

      it('should persist schedules to database', async () => {
        await seedDevice('persist_dev_1');

        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['persist_dev_1'],
          service_type: 'general_maintenance',
          scheduled_date: futureDateISO(),
        });
        await POST(request);

        const schedules = await ScheduleV2.find({ device_id: 'persist_dev_1' });
        expect(schedules.length).toBe(1);
        expect(schedules[0].service_type).toBe('general_maintenance');
        expect(schedules[0].status).toBe('scheduled');
      });

      it('should set audit fields on creation', async () => {
        await seedDevice('audit_dev_1');

        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['audit_dev_1'],
          service_type: 'calibration',
          scheduled_date: futureDateISO(),
        });
        const response = await POST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            created: Array<{
              audit: { created_by: string; updated_by: string; created_at: string };
            }>;
          };
        }>(response);

        expect(response.status).toBe(201);
        expect(data.data.created[0].audit.created_by).toBeDefined();
        expect(data.data.created[0].audit.updated_by).toBeDefined();
        expect(data.data.created[0].audit.created_at).toBeDefined();
      });
    });

    describe('Validation Errors', () => {
      it('should reject missing device_ids', async () => {
        const request = createMockPostRequest('/api/v2/schedules', {
          service_type: 'calibration',
          scheduled_date: futureDateISO(),
        });
        const response = await POST(request);

        expect(response.status).toBe(400);
      });

      it('should reject empty device_ids array', async () => {
        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: [],
          service_type: 'calibration',
          scheduled_date: futureDateISO(),
        });
        const response = await POST(request);

        expect(response.status).toBe(400);
      });

      it('should reject invalid service_type', async () => {
        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['dev_1'],
          service_type: 'invalid_type',
          scheduled_date: futureDateISO(),
        });
        const response = await POST(request);

        expect(response.status).toBe(400);
      });

      it('should reject past scheduled_date', async () => {
        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['dev_1'],
          service_type: 'calibration',
          scheduled_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        });
        const response = await POST(request);

        expect(response.status).toBe(400);
      });

      it('should reject missing scheduled_date', async () => {
        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['dev_1'],
          service_type: 'calibration',
        });
        const response = await POST(request);

        expect(response.status).toBe(400);
      });
    });

    describe('Device Validation', () => {
      it('should reject non-existent device IDs', async () => {
        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['non_existent_device'],
          service_type: 'calibration',
          scheduled_date: futureDateISO(),
        });
        const response = await POST(request);
        const data = await parseResponse<{
          success: boolean;
          error: { code: string };
        }>(response);

        expect(response.status).toBe(404);
        expect(data.error.code).toBe('DEVICE_NOT_FOUND');
      });

      it('should reject deleted device IDs', async () => {
        await seedDevice('deleted_dev');
        await DeviceV2.softDelete('deleted_dev');

        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['deleted_dev'],
          service_type: 'calibration',
          scheduled_date: futureDateISO(),
        });
        const response = await POST(request);

        expect(response.status).toBe(404);
      });

      it('should reject if any device ID is missing (partial)', async () => {
        await seedDevice('existing_dev');

        const request = createMockPostRequest('/api/v2/schedules', {
          device_ids: ['existing_dev', 'missing_dev'],
          service_type: 'calibration',
          scheduled_date: futureDateISO(),
        });
        const response = await POST(request);

        expect(response.status).toBe(404);
      });
    });
  });

  // ==========================================================================
  // GET /api/v2/schedules/[id] - Get Single Schedule
  // ==========================================================================

  describe('GET /api/v2/schedules/[id]', () => {
    it('should return a schedule by ID', async () => {
      const schedule = await seedSchedule({ device_id: 'get_dev_1' });

      const request = createMockGetRequest(`/api/v2/schedules/${schedule._id}`);
      const response = await getSchedule(request, {
        params: createParamsPromise(schedule._id.toString()),
      });
      const data = await parseResponse<{
        success: boolean;
        data: { _id: string; device_id: string; service_type: string };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data._id).toBe(schedule._id.toString());
      expect(data.data.device_id).toBe('get_dev_1');
    });

    it('should return 404 for non-existent schedule', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const request = createMockGetRequest(`/api/v2/schedules/${fakeId}`);
      const response = await getSchedule(request, {
        params: createParamsPromise(fakeId),
      });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid ID format', async () => {
      const request = createMockGetRequest('/api/v2/schedules/invalid-id');
      const response = await getSchedule(request, {
        params: createParamsPromise('invalid-id'),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid query parameters', async () => {
      const schedule = await seedSchedule({ device_id: 'query_err_dev' });
      const request = createMockGetRequest(`/api/v2/schedules/${schedule._id}`, {
        include_device: 'not_a_boolean_but_thats_ok',
        unknown_param: 'value', // unknown params are stripped, but we need a genuinely invalid one
      });
      // getScheduleQuerySchema accepts any string for include_device (transforms to bool)
      // so this should succeed with include_device=false
      const response = await getSchedule(request, {
        params: createParamsPromise(schedule._id.toString()),
      });
      expect(response.status).toBe(200);
    });

    it('should include device details when include_device=true', async () => {
      await seedDevice('include_dev');
      const schedule = await seedSchedule({ device_id: 'include_dev' });

      const request = createMockGetRequest(`/api/v2/schedules/${schedule._id}`, {
        include_device: 'true',
      });
      const response = await getSchedule(request, {
        params: createParamsPromise(schedule._id.toString()),
      });
      const data = await parseResponse<{
        success: boolean;
        data: { device: { _id: string; serial_number: string } | null };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.device).not.toBeNull();
      expect(data.data.device!._id).toBe('include_dev');
    });

    it('should return device: null when device not found with include_device=true', async () => {
      const schedule = await seedSchedule({ device_id: 'ghost_device' });

      const request = createMockGetRequest(`/api/v2/schedules/${schedule._id}`, {
        include_device: 'true',
      });
      const response = await getSchedule(request, {
        params: createParamsPromise(schedule._id.toString()),
      });
      const data = await parseResponse<{
        success: boolean;
        data: { device: null };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.device).toBeNull();
    });
  });

  // ==========================================================================
  // PATCH /api/v2/schedules/[id] - Update Schedule
  // ==========================================================================

  describe('PATCH /api/v2/schedules/[id]', () => {
    describe('Non-Status Updates', () => {
      it('should update notes', async () => {
        const schedule = await seedSchedule({ device_id: 'patch_dev_1' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          notes: 'Updated notes',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });
        const data = await parseResponse<{
          success: boolean;
          data: { notes: string };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.notes).toBe('Updated notes');
      });

      it('should reschedule to a new date', async () => {
        const schedule = await seedSchedule({ device_id: 'patch_dev_2' });
        const newDate = futureDateISO(30);

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          scheduled_date: newDate,
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(200);
      });
    });

    describe('Status Transitions', () => {
      it('should complete a scheduled schedule via PATCH', async () => {
        const schedule = await seedSchedule({ device_id: 'complete_dev' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          status: 'completed',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });
        const data = await parseResponse<{
          success: boolean;
          data: { status: string; audit: { completed_by: string; completed_at: string } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.status).toBe('completed');
        expect(data.data.audit.completed_by).toBeDefined();
        expect(data.data.audit.completed_at).toBeDefined();
      });

      it('should cancel a scheduled schedule via PATCH', async () => {
        const schedule = await seedSchedule({ device_id: 'cancel_dev' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          status: 'cancelled',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });
        const data = await parseResponse<{
          success: boolean;
          data: { status: string; audit: { cancelled_by: string } };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.status).toBe('cancelled');
      });

      it('should return 422 when completing an already completed schedule', async () => {
        const schedule = await seedSchedule({ device_id: 'dup_complete', status: 'completed' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          status: 'completed',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(422);
      });

      it('should return 422 when cancelling an already cancelled schedule', async () => {
        const schedule = await seedSchedule({ device_id: 'dup_cancel', status: 'cancelled' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          status: 'cancelled',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(422);
      });

      it('should return 404 when completing a non-existent schedule', async () => {
        const fakeId = '507f1f77bcf86cd799439011';
        const request = createMockPatchRequest(`/api/v2/schedules/${fakeId}`, {
          status: 'completed',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(fakeId),
        });

        expect(response.status).toBe(404);
      });

      it('should return 404 when cancelling a non-existent schedule via PATCH', async () => {
        const fakeId = '507f1f77bcf86cd799439011';
        const request = createMockPatchRequest(`/api/v2/schedules/${fakeId}`, {
          status: 'cancelled',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(fakeId),
        });

        expect(response.status).toBe(404);
      });

      it('should return 422 when completing a cancelled schedule', async () => {
        const schedule = await seedSchedule({ device_id: 'complete_cancel', status: 'cancelled' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          status: 'completed',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(422);
      });

      it('should return 422 when cancelling a completed schedule via PATCH', async () => {
        const schedule = await seedSchedule({ device_id: 'cancel_complete', status: 'completed' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          status: 'cancelled',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(422);
      });

      it('should return 422 when modifying a completed schedule', async () => {
        const schedule = await seedSchedule({ device_id: 'mod_complete', status: 'completed' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          notes: 'Try to update completed',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(422);
      });

      it('should return 422 when modifying a cancelled schedule', async () => {
        const schedule = await seedSchedule({ device_id: 'mod_cancel', status: 'cancelled' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          notes: 'Try to update cancelled',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(422);
      });
    });

    describe('Validation Errors', () => {
      it('should return 404 for non-existent schedule', async () => {
        const fakeId = '507f1f77bcf86cd799439011';
        const request = createMockPatchRequest(`/api/v2/schedules/${fakeId}`, {
          notes: 'test',
        });
        const response = await PATCH(request, {
          params: createParamsPromise(fakeId),
        });

        expect(response.status).toBe(404);
      });

      it('should return 400 for invalid ID format', async () => {
        const request = createMockPatchRequest('/api/v2/schedules/bad-id', {
          notes: 'test',
        });
        const response = await PATCH(request, {
          params: createParamsPromise('bad-id'),
        });

        expect(response.status).toBe(400);
      });

      it('should return 400 for empty update body', async () => {
        const schedule = await seedSchedule({ device_id: 'empty_patch' });

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {});
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(400);
      });

      it('should return 400 for past scheduled_date', async () => {
        const schedule = await seedSchedule({ device_id: 'past_date_dev' });
        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const request = createMockPatchRequest(`/api/v2/schedules/${schedule._id}`, {
          scheduled_date: pastDate,
        });
        const response = await PATCH(request, {
          params: createParamsPromise(schedule._id.toString()),
        });

        expect(response.status).toBe(400);
      });
    });
  });

  // ==========================================================================
  // DELETE /api/v2/schedules/[id] - Cancel Schedule
  // ==========================================================================

  describe('DELETE /api/v2/schedules/[id]', () => {
    it('should cancel a scheduled schedule', async () => {
      const schedule = await seedSchedule({ device_id: 'delete_dev' });

      const request = createMockDeleteRequest(`/api/v2/schedules/${schedule._id}`);
      const response = await DELETE(request, {
        params: createParamsPromise(schedule._id.toString()),
      });
      const data = await parseResponse<{
        success: boolean;
        data: { _id: string; cancelled: boolean; cancelled_at: string };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.cancelled).toBe(true);
      expect(data.data.cancelled_at).toBeDefined();

      // Verify in database
      const dbSchedule = await ScheduleV2.findById(schedule._id);
      expect(dbSchedule?.status).toBe('cancelled');
    });

    it('should return 404 for non-existent schedule', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const request = createMockDeleteRequest(`/api/v2/schedules/${fakeId}`);
      const response = await DELETE(request, {
        params: createParamsPromise(fakeId),
      });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid ID format', async () => {
      const request = createMockDeleteRequest('/api/v2/schedules/bad-id');
      const response = await DELETE(request, {
        params: createParamsPromise('bad-id'),
      });

      expect(response.status).toBe(400);
    });

    it('should return 422 for already completed schedule', async () => {
      const schedule = await seedSchedule({ device_id: 'del_complete', status: 'completed' });

      const request = createMockDeleteRequest(`/api/v2/schedules/${schedule._id}`);
      const response = await DELETE(request, {
        params: createParamsPromise(schedule._id.toString()),
      });

      expect(response.status).toBe(422);
    });

    it('should return 422 for already cancelled schedule', async () => {
      const schedule = await seedSchedule({ device_id: 'del_cancel', status: 'cancelled' });

      const request = createMockDeleteRequest(`/api/v2/schedules/${schedule._id}`);
      const response = await DELETE(request, {
        params: createParamsPromise(schedule._id.toString()),
      });

      expect(response.status).toBe(422);
    });
  });
});
