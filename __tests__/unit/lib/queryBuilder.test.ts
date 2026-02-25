/**
 * Query Builder Tests
 *
 * Tests for sort validation, device/reading filter building,
 * field selection, and utility functions.
 */

import {
  validateSortParam,
  validateSortOrder,
  parseSortFromSearchParams,
  buildDeviceFilter,
  buildReadingFilter,
  selectFields,
  parseFieldsFromSearchParams,
  extractQueryParams,
  combineFilters,
  DEVICE_SORT_FIELDS,
  READING_SORT_FIELDS,
  DEVICE_PROJECTION_FIELDS,
  READING_PROJECTION_FIELDS,
} from '@/lib/api/queryBuilder';
import { ApiError } from '@/lib/errors/ApiError';

describe('validateSortParam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns defaults when sortParam is undefined', () => {
    const result = validateSortParam(undefined, DEVICE_SORT_FIELDS);
    expect(result).toEqual({
      field: '_id',
      direction: 'desc',
      mongoOrder: -1,
    });
  });

  it('returns custom defaults when provided', () => {
    const result = validateSortParam(undefined, DEVICE_SORT_FIELDS, 'name', 'asc');
    expect(result).toEqual({
      field: 'name',
      direction: 'asc',
      mongoOrder: 1,
    });
  });

  it('parses valid sort param (asc)', () => {
    const result = validateSortParam('name:asc', DEVICE_SORT_FIELDS);
    expect(result).toEqual({ field: 'name', direction: 'asc', mongoOrder: 1 });
  });

  it('parses valid sort param (desc)', () => {
    const result = validateSortParam('created_at:desc', DEVICE_SORT_FIELDS);
    expect(result).toEqual({ field: 'created_at', direction: 'desc', mongoOrder: -1 });
  });

  it('throws ApiError for invalid format (no colon)', () => {
    expect(() => validateSortParam('name', DEVICE_SORT_FIELDS)).toThrow(ApiError);
  });

  it('throws ApiError for invalid format (wrong direction)', () => {
    expect(() => validateSortParam('name:up', DEVICE_SORT_FIELDS)).toThrow(ApiError);
  });

  it('throws ApiError for disallowed field', () => {
    expect(() => validateSortParam('hacked:asc', DEVICE_SORT_FIELDS)).toThrow(ApiError);
    try {
      validateSortParam('hacked:asc', DEVICE_SORT_FIELDS);
    } catch (e) {
      expect((e as ApiError).message).toContain('hacked');
      expect((e as ApiError).statusCode).toBe(400);
    }
  });

  it('throws for fields with special characters', () => {
    expect(() => validateSortParam('$where:asc', DEVICE_SORT_FIELDS)).toThrow(ApiError);
  });

  it('works with READING_SORT_FIELDS', () => {
    const result = validateSortParam('timestamp:desc', READING_SORT_FIELDS);
    expect(result.field).toBe('timestamp');
  });
});

describe('validateSortOrder', () => {
  it('returns ascending sort for "asc"', () => {
    const result = validateSortOrder('name', 'asc', DEVICE_SORT_FIELDS as unknown as string[]);
    expect(result).toEqual({ name: 1 });
  });

  it('returns descending sort for "desc"', () => {
    const result = validateSortOrder('name', 'desc', DEVICE_SORT_FIELDS as unknown as string[]);
    expect(result).toEqual({ name: -1 });
  });

  it('defaults to desc when order is undefined', () => {
    const result = validateSortOrder('name', undefined, DEVICE_SORT_FIELDS as unknown as string[]);
    expect(result).toEqual({ name: -1 });
  });

  it('defaults to desc for unknown order strings', () => {
    const result = validateSortOrder('name', 'invalid', DEVICE_SORT_FIELDS as unknown as string[]);
    expect(result).toEqual({ name: -1 });
  });

  it('throws for disallowed field', () => {
    expect(() => validateSortOrder('bad_field', 'asc', DEVICE_SORT_FIELDS as unknown as string[])).toThrow(ApiError);
  });
});

describe('parseSortFromSearchParams', () => {
  it('parses sort from searchParams', () => {
    const params = new URLSearchParams('sort=name:asc');
    const result = parseSortFromSearchParams(params, DEVICE_SORT_FIELDS as unknown as string[]);
    expect(result.field).toBe('name');
    expect(result.direction).toBe('asc');
  });

  it('returns defaults when sort param is absent', () => {
    const params = new URLSearchParams('');
    const result = parseSortFromSearchParams(params, DEVICE_SORT_FIELDS as unknown as string[]);
    expect(result.field).toBe('_id');
    expect(result.direction).toBe('desc');
  });

  it('uses custom defaults', () => {
    const params = new URLSearchParams('');
    const result = parseSortFromSearchParams(params, DEVICE_SORT_FIELDS as unknown as string[], 'status', 'asc');
    expect(result.field).toBe('status');
    expect(result.direction).toBe('asc');
  });
});

describe('buildDeviceFilter', () => {
  it('returns empty filter for empty options', () => {
    expect(buildDeviceFilter({})).toEqual({});
  });

  it('filters by single type', () => {
    const filter = buildDeviceFilter({ type: 'temperature' });
    expect(filter.type).toBe('temperature');
  });

  it('filters by multiple types', () => {
    const filter = buildDeviceFilter({ type: ['temperature', 'humidity'] });
    expect(filter.type).toEqual({ $in: ['temperature', 'humidity'] });
  });

  it('filters by single status', () => {
    const filter = buildDeviceFilter({ status: 'active' });
    expect(filter.status).toBe('active');
  });

  it('filters by multiple statuses', () => {
    const filter = buildDeviceFilter({ status: ['active', 'offline'] });
    expect(filter.status).toEqual({ $in: ['active', 'offline'] });
  });

  it('filters by floor (number)', () => {
    const filter = buildDeviceFilter({ floor: 3 });
    expect(filter['location.floor']).toBe(3);
  });

  it('filters by floor (string that parses to number)', () => {
    const filter = buildDeviceFilter({ floor: '5' });
    expect(filter['location.floor']).toBe(5);
  });

  it('ignores floor when string is NaN', () => {
    const filter = buildDeviceFilter({ floor: 'abc' });
    expect(filter['location.floor']).toBeUndefined();
  });

  it('filters by building_id', () => {
    const filter = buildDeviceFilter({ building_id: 'bldg_001' });
    expect(filter['location.building_id']).toBe('bldg_001');
  });

  it('filters by room_name with case-insensitive regex', () => {
    const filter = buildDeviceFilter({ room_name: 'Server' });
    expect(filter['location.room_name']).toEqual({
      $regex: expect.any(String),
      $options: 'i',
    });
  });

  it('builds search filter across multiple fields', () => {
    const filter = buildDeviceFilter({ search: 'test' });
    expect(filter.$or).toHaveLength(4);
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: expect.any(Object) }),
        expect.objectContaining({ name: expect.any(Object) }),
      ])
    );
  });

  it('filters by tags (string, comma-separated)', () => {
    const filter = buildDeviceFilter({ tags: 'critical,production' });
    expect(filter.tags).toEqual({ $all: ['critical', 'production'] });
  });

  it('filters by tags (array)', () => {
    const filter = buildDeviceFilter({ tags: ['critical', 'production'] });
    expect(filter.tags).toEqual({ $all: ['critical', 'production'] });
  });

  it('filters by battery range (min only)', () => {
    const filter = buildDeviceFilter({ minBattery: 20 });
    expect(filter['health.battery_level']).toEqual({ $gte: 20 });
  });

  it('filters by battery range (max only)', () => {
    const filter = buildDeviceFilter({ maxBattery: 80 });
    expect(filter['health.battery_level']).toEqual({ $lte: 80 });
  });

  it('filters by battery range (both min and max)', () => {
    const filter = buildDeviceFilter({ minBattery: 20, maxBattery: 80 });
    expect(filter['health.battery_level']).toEqual({ $gte: 20, $lte: 80 });
  });

  it('filters by department', () => {
    const filter = buildDeviceFilter({ department: 'Engineering' });
    expect(filter['ownership.department']).toBe('Engineering');
  });

  it('combines multiple filters', () => {
    const filter = buildDeviceFilter({
      type: 'temperature',
      status: 'active',
      floor: 2,
      department: 'Ops',
    });
    expect(filter.type).toBe('temperature');
    expect(filter.status).toBe('active');
    expect(filter['location.floor']).toBe(2);
    expect(filter['ownership.department']).toBe('Ops');
  });
});

describe('buildReadingFilter', () => {
  it('returns empty filter for empty options', () => {
    expect(buildReadingFilter({})).toEqual({});
  });

  it('filters by single device_id', () => {
    const filter = buildReadingFilter({ device_id: 'device_001' });
    expect(filter['metadata.device_id']).toBe('device_001');
  });

  it('filters by multiple device_ids', () => {
    const filter = buildReadingFilter({ device_id: ['device_001', 'device_002'] });
    expect(filter['metadata.device_id']).toEqual({ $in: ['device_001', 'device_002'] });
  });

  it('filters by single type', () => {
    const filter = buildReadingFilter({ type: 'temperature' });
    expect(filter['metadata.type']).toBe('temperature');
  });

  it('filters by multiple types', () => {
    const filter = buildReadingFilter({ type: ['temperature', 'humidity'] });
    expect(filter['metadata.type']).toEqual({ $in: ['temperature', 'humidity'] });
  });

  it('filters by date range (both start and end)', () => {
    const filter = buildReadingFilter({
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-31T23:59:59Z',
    });
    expect(filter.timestamp).toEqual({
      $gte: expect.any(Date),
      $lte: expect.any(Date),
    });
  });

  it('filters by start date only', () => {
    const filter = buildReadingFilter({ startDate: '2025-01-01T00:00:00Z' });
    expect(filter.timestamp).toEqual({ $gte: expect.any(Date) });
  });

  it('filters by end date only', () => {
    const filter = buildReadingFilter({ endDate: '2025-01-31T23:59:59Z' });
    expect(filter.timestamp).toEqual({ $lte: expect.any(Date) });
  });

  it('accepts Date objects for date range', () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-01-31');
    const filter = buildReadingFilter({ startDate: start, endDate: end });
    expect(filter.timestamp).toEqual({ $gte: start, $lte: end });
  });

  it('ignores invalid date strings', () => {
    const filter = buildReadingFilter({ startDate: 'not-a-date' });
    expect(filter.timestamp).toBeUndefined();
  });

  it('filters by value range', () => {
    const filter = buildReadingFilter({ minValue: 10, maxValue: 50 });
    expect(filter.value).toEqual({ $gte: 10, $lte: 50 });
  });

  it('filters by minValue only', () => {
    const filter = buildReadingFilter({ minValue: 10 });
    expect(filter.value).toEqual({ $gte: 10 });
  });

  it('filters by source', () => {
    const filter = buildReadingFilter({ source: 'sensor' });
    expect(filter['metadata.source']).toBe('sensor');
  });
});

describe('selectFields', () => {
  it('returns undefined for undefined input', () => {
    expect(selectFields(undefined, DEVICE_PROJECTION_FIELDS as unknown as string[])).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(selectFields('', DEVICE_PROJECTION_FIELDS as unknown as string[])).toBeUndefined();
  });

  it('parses comma-separated string', () => {
    const result = selectFields('_id,name,status', DEVICE_PROJECTION_FIELDS as unknown as string[]);
    expect(result).toEqual({ _id: 1, name: 1, status: 1 });
  });

  it('accepts array input', () => {
    const result = selectFields(['_id', 'name'], DEVICE_PROJECTION_FIELDS as unknown as string[]);
    expect(result).toEqual({ _id: 1, name: 1 });
  });

  it('allows nested fields (e.g. location.floor)', () => {
    const result = selectFields('location.floor', DEVICE_PROJECTION_FIELDS as unknown as string[]);
    expect(result).toEqual({ 'location.floor': 1 });
  });

  it('throws ApiError for invalid fields', () => {
    expect(() =>
      selectFields('_id,invalid_field', DEVICE_PROJECTION_FIELDS as unknown as string[])
    ).toThrow(ApiError);
  });

  it('includes all valid and reports all invalid fields', () => {
    try {
      selectFields('bad1,bad2', DEVICE_PROJECTION_FIELDS as unknown as string[]);
    } catch (e) {
      expect((e as ApiError).message).toContain('bad1');
      expect((e as ApiError).message).toContain('bad2');
    }
  });

  it('skips empty fields in comma-separated list', () => {
    const result = selectFields('_id,,name,', DEVICE_PROJECTION_FIELDS as unknown as string[]);
    expect(result).toEqual({ _id: 1, name: 1 });
  });

  it('works with reading projection fields', () => {
    const result = selectFields('timestamp,value', READING_PROJECTION_FIELDS as unknown as string[]);
    expect(result).toEqual({ timestamp: 1, value: 1 });
  });
});

describe('parseFieldsFromSearchParams', () => {
  it('parses fields from searchParams', () => {
    const params = new URLSearchParams('fields=_id,name');
    const result = parseFieldsFromSearchParams(params, DEVICE_PROJECTION_FIELDS as unknown as string[]);
    expect(result).toEqual({ _id: 1, name: 1 });
  });

  it('returns undefined when fields param is absent', () => {
    const params = new URLSearchParams('');
    const result = parseFieldsFromSearchParams(params, DEVICE_PROJECTION_FIELDS as unknown as string[]);
    expect(result).toBeUndefined();
  });
});

describe('extractQueryParams', () => {
  it('extracts existing params', () => {
    const params = new URLSearchParams('type=temperature&status=active&floor=3');
    const result = extractQueryParams(params, ['type', 'status', 'floor']);
    expect(result).toEqual({ type: 'temperature', status: 'active', floor: '3' });
  });

  it('ignores missing params', () => {
    const params = new URLSearchParams('type=temperature');
    const result = extractQueryParams(params, ['type', 'status']);
    expect(result).toEqual({ type: 'temperature' });
  });

  it('splits comma-separated values into arrays', () => {
    const params = new URLSearchParams('type=temperature,humidity');
    const result = extractQueryParams(params, ['type']);
    expect(result).toEqual({ type: ['temperature', 'humidity'] });
  });

  it('returns empty object when no params match', () => {
    const params = new URLSearchParams('');
    const result = extractQueryParams(params, ['type', 'status']);
    expect(result).toEqual({});
  });
});

describe('combineFilters', () => {
  it('returns empty object for no filters', () => {
    expect(combineFilters()).toEqual({});
  });

  it('returns empty object for empty filters', () => {
    expect(combineFilters({}, {})).toEqual({});
  });

  it('returns single filter unwrapped', () => {
    const filter = { type: 'temperature' };
    expect(combineFilters(filter)).toEqual(filter);
  });

  it('combines multiple filters with $and', () => {
    const f1 = { type: 'temperature' };
    const f2 = { status: 'active' };
    const result = combineFilters(f1, f2);
    expect(result).toEqual({ $and: [f1, f2] });
  });

  it('skips empty filters in combination', () => {
    const f1 = { type: 'temperature' };
    const result = combineFilters({}, f1, {});
    expect(result).toEqual(f1);
  });

  it('handles null-like filters', () => {
    const f1 = { type: 'temperature' };
    const result = combineFilters(f1, null as unknown as Record<string, unknown>);
    expect(result).toEqual(f1);
  });
});

describe('constants', () => {
  it('DEVICE_SORT_FIELDS contains expected fields', () => {
    expect(DEVICE_SORT_FIELDS).toContain('_id');
    expect(DEVICE_SORT_FIELDS).toContain('name');
    expect(DEVICE_SORT_FIELDS).toContain('created_at');
    expect(DEVICE_SORT_FIELDS).toContain('battery_level');
  });

  it('READING_SORT_FIELDS contains expected fields', () => {
    expect(READING_SORT_FIELDS).toContain('timestamp');
    expect(READING_SORT_FIELDS).toContain('value');
  });

  it('DEVICE_PROJECTION_FIELDS contains expected fields', () => {
    expect(DEVICE_PROJECTION_FIELDS).toContain('_id');
    expect(DEVICE_PROJECTION_FIELDS).toContain('health');
    expect(DEVICE_PROJECTION_FIELDS).toContain('location');
  });

  it('READING_PROJECTION_FIELDS contains expected fields', () => {
    expect(READING_PROJECTION_FIELDS).toContain('timestamp');
    expect(READING_PROJECTION_FIELDS).toContain('value');
    expect(READING_PROJECTION_FIELDS).toContain('metadata');
  });
});
