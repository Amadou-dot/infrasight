/**
 * Advanced Device Filtering Integration Tests
 *
 * Tests for advanced filtering options in /api/v2/devices endpoints
 * that increase coverage of filter branches.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createDeviceInput, resetCounters } from '../../setup/factories';
import { GET } from '@/app/api/v2/devices/route';

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
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Devices API - Advanced Filters', () => {
  beforeEach(() => {
    resetCounters();
  });

  describe('Zone Filtering', () => {
    beforeEach(async () => {
      const devices = [
        createDeviceInput({
          _id: 'zone_north_1',
          location: { building_id: 'b1', floor: 1, room_name: 'Room 101', zone: 'North Wing' },
        }),
        createDeviceInput({
          _id: 'zone_south_1',
          location: { building_id: 'b1', floor: 1, room_name: 'Room 102', zone: 'South Wing' },
        }),
        createDeviceInput({
          _id: 'zone_north_2',
          location: { building_id: 'b1', floor: 2, room_name: 'Room 201', zone: 'North Wing' },
        }),
      ];
      await DeviceV2.insertMany(devices);
    });

    it('should filter by zone', async () => {
      const request = createMockGetRequest({ zone: 'North Wing' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; location: { zone: string } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.location.zone === 'North Wing')).toBe(true);
    });
  });

  describe('Department Filtering', () => {
    beforeEach(async () => {
      const devices = [
        createDeviceInput({
          _id: 'dept_eng_1',
          metadata: { tags: [], department: 'Engineering', cost_center: 'CC-001' },
        }),
        createDeviceInput({
          _id: 'dept_fac_1',
          metadata: { tags: [], department: 'Facilities', cost_center: 'CC-002' },
        }),
        createDeviceInput({
          _id: 'dept_eng_2',
          metadata: { tags: [], department: 'Engineering', cost_center: 'CC-003' },
        }),
      ];
      await DeviceV2.insertMany(devices);
    });

    it('should filter by department', async () => {
      const request = createMockGetRequest({ department: 'Engineering' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; metadata: { department: string } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.metadata.department === 'Engineering')).toBe(true);
    });
  });

  describe('Manufacturer Filtering', () => {
    beforeEach(async () => {
      const devices = [
        createDeviceInput({ _id: 'mfr_acme_1', manufacturer: 'Acme Corp' }),
        createDeviceInput({ _id: 'mfr_globex_1', manufacturer: 'Globex Inc' }),
        createDeviceInput({ _id: 'mfr_acme_2', manufacturer: 'Acme Corp' }),
      ];
      await DeviceV2.insertMany(devices);
    });

    it('should filter by manufacturer', async () => {
      const request = createMockGetRequest({ manufacturer: 'Acme Corp' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; manufacturer: string }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.manufacturer === 'Acme Corp')).toBe(true);
    });
  });

  describe('Tags Filtering', () => {
    beforeEach(async () => {
      const devices = [
        createDeviceInput({
          _id: 'tags_hvac_1',
          metadata: { tags: ['hvac', 'critical'], department: 'Facilities', cost_center: 'CC-001' },
        }),
        createDeviceInput({
          _id: 'tags_server_1',
          metadata: { tags: ['server-room', 'critical'], department: 'IT', cost_center: 'CC-002' },
        }),
        createDeviceInput({
          _id: 'tags_hvac_2',
          metadata: { tags: ['hvac', 'low-priority'], department: 'Facilities', cost_center: 'CC-003' },
        }),
      ];
      await DeviceV2.insertMany(devices);
    });

    it('should filter by single tag', async () => {
      const request = createMockGetRequest({ tags: 'hvac' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; metadata: { tags: string[] } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.metadata.tags.includes('hvac'))).toBe(true);
    });

    it('should filter by tag that matches multiple devices', async () => {
      const request = createMockGetRequest({ tags: 'critical' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; metadata: { tags: string[] } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.metadata.tags.includes('critical'))).toBe(true);
    });
  });

  describe('Battery Level Filtering', () => {
    beforeEach(async () => {
      const devices = [
        createDeviceInput({
          _id: 'battery_high',
          health: {
            last_seen: new Date(),
            uptime_percentage: 100,
            error_count: 0,
            battery_level: 95,
          },
        }),
        createDeviceInput({
          _id: 'battery_mid',
          health: {
            last_seen: new Date(),
            uptime_percentage: 100,
            error_count: 0,
            battery_level: 50,
          },
        }),
        createDeviceInput({
          _id: 'battery_low',
          health: {
            last_seen: new Date(),
            uptime_percentage: 100,
            error_count: 0,
            battery_level: 15,
          },
        }),
      ];
      await DeviceV2.insertMany(devices);
    });

    it('should filter by minimum battery level', async () => {
      const request = createMockGetRequest({ min_battery: '50' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; health: { battery_level: number } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.health.battery_level >= 50)).toBe(true);
    });

    it('should filter by maximum battery level', async () => {
      const request = createMockGetRequest({ max_battery: '50' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; health: { battery_level: number } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.health.battery_level <= 50)).toBe(true);
    });

    it('should filter by battery level range', async () => {
      const request = createMockGetRequest({ min_battery: '30', max_battery: '80' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; health: { battery_level: number } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(1);
      expect(data.data[0]._id).toBe('battery_mid');
    });
  });

  describe('Date Range Filtering', () => {
    beforeEach(async () => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const devices = [
        createDeviceInput({
          _id: 'date_recent',
          audit: { created_at: now, updated_at: now, created_by: 'test@example.com', updated_by: 'test@example.com' },
        }),
        createDeviceInput({
          _id: 'date_week_old',
          audit: { created_at: oneWeekAgo, updated_at: oneWeekAgo, created_by: 'test@example.com', updated_by: 'test@example.com' },
        }),
        createDeviceInput({
          _id: 'date_two_weeks_old',
          audit: { created_at: twoWeeksAgo, updated_at: twoWeeksAgo, created_by: 'test@example.com', updated_by: 'test@example.com' },
        }),
      ];
      await DeviceV2.insertMany(devices);
    });

    it('should filter by start date only', async () => {
      // Use a date slightly older than one week to include the "week old" device
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const request = createMockGetRequest({ startDate: eightDaysAgo.toISOString() });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string }>;
      }>(response);

      expect(response.status).toBe(200);
      // Should find "recent" and "week_old" devices (not "two_weeks_old")
      expect(data.data.length).toBe(2);
    });

    it('should filter by end date only', async () => {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const request = createMockGetRequest({ endDate: oneWeekAgo.toISOString() });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
    });

    it('should filter by date range with start and end dates', async () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const request = createMockGetRequest({
        startDate: tenDaysAgo.toISOString(),
        endDate: fiveDaysAgo.toISOString(),
      });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(1);
      expect(data.data[0]._id).toBe('date_week_old');
    });

    it('should filter by date range with custom date_filter_field (last_seen)', async () => {
      // Create devices with specific last_seen dates
      await DeviceV2.deleteMany({});
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const devices = [
        createDeviceInput({
          _id: 'seen_recent',
          health: { last_seen: now, uptime_percentage: 100, error_count: 0 },
        }),
        createDeviceInput({
          _id: 'seen_week_old',
          health: { last_seen: oneWeekAgo, uptime_percentage: 100, error_count: 0 },
        }),
      ];
      await DeviceV2.insertMany(devices);

      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const request = createMockGetRequest({
        startDate: twoDaysAgo.toISOString(),
        date_filter_field: 'last_seen',
      });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(1);
      expect(data.data[0]._id).toBe('seen_recent');
    });
  });

  describe('Search Filtering', () => {
    beforeEach(async () => {
      const devices = [
        createDeviceInput({
          _id: 'search_temp_1',
          serial_number: 'SN-TEMP-001',
          location: { building_id: 'b1', floor: 1, room_name: 'Server Room A' },
          metadata: { tags: ['temperature', 'critical'], department: 'IT', cost_center: 'CC-001' },
        }),
        createDeviceInput({
          _id: 'search_humid_1',
          serial_number: 'SN-HUMID-001',
          location: { building_id: 'b1', floor: 2, room_name: 'Conference Room B' },
          metadata: { tags: ['humidity', 'monitoring'], department: 'Facilities', cost_center: 'CC-002' },
        }),
        createDeviceInput({
          _id: 'search_power_1',
          serial_number: 'SN-POWER-001',
          location: { building_id: 'b2', floor: 1, room_name: 'Server Room B' },
          metadata: { tags: ['power', 'critical'], department: 'IT', cost_center: 'CC-003' },
        }),
      ];
      await DeviceV2.insertMany(devices);
    });

    it('should search by serial number', async () => {
      const request = createMockGetRequest({ search: 'TEMP' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; serial_number: string }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(1);
      expect(data.data[0].serial_number).toContain('TEMP');
    });

    it('should search by room name', async () => {
      const request = createMockGetRequest({ search: 'Server' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; location: { room_name: string } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.location.room_name.includes('Server'))).toBe(true);
    });

    it('should search by tags', async () => {
      const request = createMockGetRequest({ search: 'critical' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string; metadata: { tags: string[] } }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(2);
      expect(data.data.every(d => d.metadata.tags.includes('critical'))).toBe(true);
    });

    it('should be case insensitive', async () => {
      const request = createMockGetRequest({ search: 'humid' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<{ _id: string }>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(1);
      expect(data.data[0]._id).toBe('search_humid_1');
    });
  });

  describe('Field Projection', () => {
    beforeEach(async () => {
      const device = createDeviceInput({
        _id: 'projection_test',
        serial_number: 'SN-PROJ-001',
        manufacturer: 'Test Mfr',
        status: 'active',
        type: 'temperature',
      });
      await DeviceV2.create(device);
    });

    it('should return only specified fields', async () => {
      const request = createMockGetRequest({ fields: '_id,serial_number,status' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<Record<string, unknown>>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.length).toBe(1);
      expect(data.data[0]._id).toBe('projection_test');
      expect(data.data[0].serial_number).toBe('SN-PROJ-001');
      expect(data.data[0].status).toBe('active');
      // These fields should not be included
      expect(data.data[0].manufacturer).toBeUndefined();
      expect(data.data[0].type).toBeUndefined();
    });

    it('should return multiple projected fields', async () => {
      const request = createMockGetRequest({ fields: '_id,type,manufacturer' });
      const response = await GET(request);
      const data = await parseResponse<{
        success: boolean;
        data: Array<Record<string, unknown>>;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data[0]._id).toBeDefined();
      expect(data.data[0].type).toBe('temperature');
      expect(data.data[0].manufacturer).toBe('Test Mfr');
      expect(data.data[0].serial_number).toBeUndefined();
    });
  });
});
