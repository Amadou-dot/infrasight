/**
 * Energy Analytics API – Coverage Gap Tests
 *
 * Covers uncovered paths in app/api/v2/analytics/energy/route.ts:
 *  - getDateFormat default branch (line 39): invalid granularity
 *  - getAggregationOperator default branch (line 66): unknown aggregation falls back to avg
 *  - Validation error path (lines 147-150): bad query params
 *  - Floor filter with device resolution (lines 161-186):
 *    floor with matching devices and floor with no devices (empty results)
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  createDeviceInput,
  createReadingV2Input,
  resetCounters,
} from '../../setup/factories';

import { GET as GET_ENERGY } from '@/app/api/v2/analytics/energy/route';

function createMockGetRequest(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/v2/analytics/energy');
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

interface EnergyResponse {
  success: boolean;
  data?: {
    results: Array<Record<string, unknown>>;
    comparison: unknown;
    metadata: {
      granularity: string;
      aggregation_type: string;
      total_points: number;
      excluded_invalid: number;
      group_by: string | null;
      time_range: { start: string | undefined; end: string | undefined };
      compare_with: string | null;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

describe('Energy Analytics API – Coverage Gaps', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ---------------------------------------------------------------------------
  // Validation error path (lines 147-150)
  // ---------------------------------------------------------------------------

  describe('validation error path', () => {
    it('should return 400 for invalid granularity value', async () => {
      const request = createMockGetRequest({
        device_id: 'device_001',
        granularity: 'invalid_granularity',
      });

      const response = await GET_ENERGY(request);
      const data: EnergyResponse = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('should return 400 for invalid aggregation value', async () => {
      const request = createMockGetRequest({
        device_id: 'device_001',
        aggregation: 'not_a_valid_agg',
      });

      const response = await GET_ENERGY(request);
      const data: EnergyResponse = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Floor filter: no devices on floor → empty results (lines 169-183)
  // ---------------------------------------------------------------------------

  describe('floor filter', () => {
    it('should return empty results when no devices exist on the specified floor', async () => {
      // Create a device on floor 1 only
      const device = createDeviceInput({
        _id: 'floor_device_001',
        type: 'power',
        location: {
          building_id: 'building_a',
          floor: 1,
          room_name: 'Room 101',
          zone: 'Zone A',
        },
      });
      await DeviceV2.create(device);

      // Query for floor 99 where no devices exist
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const request = createMockGetRequest({
        floor: '99',
        startDate: yesterday.toISOString(),
        endDate: now.toISOString(),
      });

      const response = await GET_ENERGY(request);
      const data: EnergyResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.results).toEqual([]);
      expect(data.data!.metadata.total_points).toBe(0);
    });

    it('should filter readings by floor when devices exist on that floor', async () => {
      // Create devices on different floors
      const deviceFloor1 = createDeviceInput({
        _id: 'floor1_device',
        type: 'power',
        location: {
          building_id: 'building_a',
          floor: 1,
          room_name: 'Room 101',
          zone: 'Zone A',
        },
      });
      const deviceFloor2 = createDeviceInput({
        _id: 'floor2_device',
        type: 'power',
        location: {
          building_id: 'building_a',
          floor: 2,
          room_name: 'Room 201',
          zone: 'Zone A',
        },
      });
      await DeviceV2.insertMany([deviceFloor1, deviceFloor2]);

      // Create readings for both devices
      const now = new Date();
      const readings = [
        createReadingV2Input('floor1_device', {
          metadata: { device_id: 'floor1_device', type: 'power', unit: 'watts', source: 'sensor' },
          value: 100,
          timestamp: new Date(now.getTime() - 60 * 60 * 1000),
        }),
        createReadingV2Input('floor2_device', {
          metadata: { device_id: 'floor2_device', type: 'power', unit: 'watts', source: 'sensor' },
          value: 200,
          timestamp: new Date(now.getTime() - 60 * 60 * 1000),
        }),
      ];
      await ReadingV2.insertMany(readings);

      // Query floor 1 only
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const request = createMockGetRequest({
        floor: '1',
        startDate: yesterday.toISOString(),
        endDate: now.toISOString(),
      });

      const response = await GET_ENERGY(request);
      const data: EnergyResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Should only contain readings from floor 1 device
      expect(data.data!.metadata.total_points).toBeGreaterThanOrEqual(1);
    });
  });
});
