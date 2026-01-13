/**
 * Pagination Utilities Unit Tests
 *
 * Tests for pagination helper functions supporting offset and cursor-based pagination.
 */

import {
  getOffsetPaginationParams,
  getCursorPaginationParams,
  getPaginationParams,
  getPaginationFromSearchParams,
  calculateOffsetPagination,
  calculateCursorPagination,
  encodeCursor,
  decodeCursor,
  createCursorFromItem,
  applyOffsetPagination,
  buildCursorQuery,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MAX_ANALYTICS_PAGE_SIZE,
} from '@/lib/api/pagination';
import { ApiError } from '@/lib/errors/ApiError';

describe('Pagination Utilities', () => {
  // ==========================================================================
  // CONSTANTS
  // ==========================================================================

  describe('Constants', () => {
    it('should export correct default values', () => {
      expect(DEFAULT_PAGE_SIZE).toBe(20);
      expect(MAX_PAGE_SIZE).toBe(100);
      expect(MIN_PAGE_SIZE).toBe(1);
      expect(MAX_ANALYTICS_PAGE_SIZE).toBe(1000);
    });
  });

  // ==========================================================================
  // getOffsetPaginationParams()
  // ==========================================================================

  describe('getOffsetPaginationParams()', () => {
    it('should return default pagination when no params provided', () => {
      const result = getOffsetPaginationParams({});

      expect(result).toEqual({
        type: 'offset',
        page: 1,
        limit: DEFAULT_PAGE_SIZE,
        skip: 0,
      });
    });

    it('should parse page and limit from strings', () => {
      const result = getOffsetPaginationParams({ page: '3', limit: '25' });

      expect(result).toEqual({
        type: 'offset',
        page: 3,
        limit: 25,
        skip: 50, // (3 - 1) * 25
      });
    });

    it('should accept numeric values', () => {
      const result = getOffsetPaginationParams({ page: 2, limit: 10 });

      expect(result).toEqual({
        type: 'offset',
        page: 2,
        limit: 10,
        skip: 10,
      });
    });

    it('should calculate skip correctly', () => {
      const page1 = getOffsetPaginationParams({ page: 1, limit: 20 });
      const page2 = getOffsetPaginationParams({ page: 2, limit: 20 });
      const page5 = getOffsetPaginationParams({ page: 5, limit: 15 });

      expect(page1.skip).toBe(0);
      expect(page2.skip).toBe(20);
      expect(page5.skip).toBe(60); // (5 - 1) * 15
    });

    it('should throw error for page less than 1', () => {
      expect(() => {
        getOffsetPaginationParams({ page: 0 });
      }).toThrow(ApiError);

      expect(() => {
        getOffsetPaginationParams({ page: -1 });
      }).toThrow(ApiError);
    });

    it('should throw error for limit exceeding MAX_PAGE_SIZE', () => {
      expect(() => {
        getOffsetPaginationParams({ limit: MAX_PAGE_SIZE + 1 });
      }).toThrow(ApiError);

      expect(() => {
        getOffsetPaginationParams({ limit: 200 });
      }).toThrow(ApiError);
    });

    it('should throw error for limit less than MIN_PAGE_SIZE', () => {
      expect(() => {
        getOffsetPaginationParams({ limit: 0 });
      }).toThrow(ApiError);

      expect(() => {
        getOffsetPaginationParams({ limit: -5 });
      }).toThrow(ApiError);
    });

    it('should throw error for non-integer page', () => {
      expect(() => {
        getOffsetPaginationParams({ page: 1.5 });
      }).toThrow(ApiError);

      expect(() => {
        getOffsetPaginationParams({ page: '2.5' });
      }).toThrow(ApiError);
    });

    it('should throw error for non-integer limit', () => {
      expect(() => {
        getOffsetPaginationParams({ limit: 10.5 });
      }).toThrow(ApiError);

      expect(() => {
        getOffsetPaginationParams({ limit: '15.5' });
      }).toThrow(ApiError);
    });

    it('should accept custom maxLimit option', () => {
      const result = getOffsetPaginationParams(
        { limit: 500 },
        { maxLimit: MAX_ANALYTICS_PAGE_SIZE }
      );

      expect(result.limit).toBe(500);
    });

    it('should enforce custom maxLimit', () => {
      expect(() => {
        getOffsetPaginationParams({ limit: 1001 }, { maxLimit: 1000 });
      }).toThrow(ApiError);
    });

    it('should include error metadata', () => {
      try {
        getOffsetPaginationParams({ page: -1 });
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (error instanceof ApiError) {
          expect(error.statusCode).toBe(400);
          expect(error.metadata).toBeDefined();
        }
      }
    });
  });

  // ==========================================================================
  // getCursorPaginationParams()
  // ==========================================================================

  describe('getCursorPaginationParams()', () => {
    it('should return cursor pagination with default limit', () => {
      const result = getCursorPaginationParams({});

      expect(result).toEqual({
        type: 'cursor',
        cursor: undefined,
        limit: DEFAULT_PAGE_SIZE,
        decodedCursor: undefined,
      });
    });

    it('should parse limit from string', () => {
      const result = getCursorPaginationParams({ limit: '30' });

      expect(result.limit).toBe(30);
    });

    it('should accept cursor parameter', () => {
      const cursor = encodeCursor({
        field: 'createdAt',
        value: '2024-01-01T00:00:00Z',
        lastId: 'device_001',
      });
      const result = getCursorPaginationParams({ cursor });

      expect(result.cursor).toBe(cursor);
      expect(result.decodedCursor).toBeDefined();
      expect(result.decodedCursor?.field).toBe('createdAt');
      expect(result.decodedCursor?.lastId).toBe('device_001');
    });

    it('should throw error for invalid limit', () => {
      expect(() => {
        getCursorPaginationParams({ limit: 0 });
      }).toThrow(ApiError);

      expect(() => {
        getCursorPaginationParams({ limit: MAX_PAGE_SIZE + 1 });
      }).toThrow(ApiError);
    });

    it('should throw error for non-integer limit', () => {
      expect(() => {
        getCursorPaginationParams({ limit: 10.5 });
      }).toThrow(ApiError);
    });
  });

  // ==========================================================================
  // getPaginationParams()
  // ==========================================================================

  describe('getPaginationParams()', () => {
    it('should return offset pagination when no cursor provided', () => {
      const result = getPaginationParams({ page: 1, limit: 20 });

      expect(result.type).toBe('offset');
    });

    it('should return cursor pagination when cursor provided', () => {
      const cursor = encodeCursor({
        field: 'createdAt',
        value: '2024-01-01',
        lastId: 'id1',
      });
      const result = getPaginationParams({ cursor });

      expect(result.type).toBe('cursor');
    });

    it('should prefer cursor over page when both provided', () => {
      const cursor = encodeCursor({
        field: 'timestamp',
        value: '2024-01-01',
        lastId: 'id1',
      });
      const result = getPaginationParams({ cursor, page: 2 });

      expect(result.type).toBe('cursor');
    });
  });

  // ==========================================================================
  // getPaginationFromSearchParams()
  // ==========================================================================

  describe('getPaginationFromSearchParams()', () => {
    it('should extract pagination from URLSearchParams', () => {
      const params = new URLSearchParams('page=2&limit=25');
      const result = getPaginationFromSearchParams(params);

      expect(result.type).toBe('offset');
      if (result.type === 'offset') {
        expect(result.page).toBe(2);
        expect(result.limit).toBe(25);
      }
    });

    it('should handle missing params with defaults', () => {
      const params = new URLSearchParams('');
      const result = getPaginationFromSearchParams(params);

      expect(result.type).toBe('offset');
      if (result.type === 'offset') {
        expect(result.page).toBe(1);
        expect(result.limit).toBe(DEFAULT_PAGE_SIZE);
      }
    });

    it('should extract cursor from URLSearchParams', () => {
      const cursor = encodeCursor({
        field: 'createdAt',
        value: '2024-01-01',
        lastId: 'id1',
      });
      const params = new URLSearchParams(`cursor=${cursor}&limit=10`);
      const result = getPaginationFromSearchParams(params);

      expect(result.type).toBe('cursor');
      if (result.type === 'cursor') {
        expect(result.cursor).toBe(cursor);
        expect(result.limit).toBe(10);
      }
    });
  });

  // ==========================================================================
  // calculateOffsetPagination()
  // ==========================================================================

  describe('calculateOffsetPagination()', () => {
    it('should calculate pagination for first page', () => {
      const result = calculateOffsetPagination(100, 1, 20);

      expect(result).toEqual({
        total: 100,
        page: 1,
        limit: 20,
        totalPages: 5,
        hasNext: true,
        hasPrevious: false,
      });
    });

    it('should calculate pagination for middle page', () => {
      const result = calculateOffsetPagination(100, 3, 20);

      expect(result).toEqual({
        total: 100,
        page: 3,
        limit: 20,
        totalPages: 5,
        hasNext: true,
        hasPrevious: true,
      });
    });

    it('should calculate pagination for last page', () => {
      const result = calculateOffsetPagination(100, 5, 20);

      expect(result).toEqual({
        total: 100,
        page: 5,
        limit: 20,
        totalPages: 5,
        hasNext: false,
        hasPrevious: true,
      });
    });

    it('should handle total of 0', () => {
      const result = calculateOffsetPagination(0, 1, 20);

      expect(result).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('should handle partial last page', () => {
      const result = calculateOffsetPagination(95, 5, 20);

      expect(result).toEqual({
        total: 95,
        page: 5,
        limit: 20,
        totalPages: 5, // Math.ceil(95 / 20)
        hasNext: false,
        hasPrevious: true,
      });
    });

    it('should clamp page to totalPages', () => {
      const result = calculateOffsetPagination(50, 10, 20);

      expect(result.page).toBe(3); // clamped from 10 to totalPages (3)
      expect(result.totalPages).toBe(3);
    });

    it('should handle single page result', () => {
      const result = calculateOffsetPagination(10, 1, 20);

      expect(result).toEqual({
        total: 10,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });
  });

  // ==========================================================================
  // calculateCursorPagination()
  // ==========================================================================

  describe('calculateCursorPagination()', () => {
    it('should calculate cursor pagination with hasMore true', () => {
      const result = calculateCursorPagination(100, 20, true, 'next_cursor', 'prev_cursor');

      expect(result).toEqual({
        total: 100,
        limit: 20,
        hasNext: true,
        hasPrevious: true,
        nextCursor: 'next_cursor',
        prevCursor: 'prev_cursor',
      });
    });

    it('should calculate cursor pagination with hasMore false', () => {
      const result = calculateCursorPagination(100, 20, false);

      expect(result).toEqual({
        total: 100,
        limit: 20,
        hasNext: false,
        hasPrevious: false,
        nextCursor: undefined,
        prevCursor: undefined,
      });
    });

    it('should handle undefined total', () => {
      const result = calculateCursorPagination(undefined, 20, true, 'next');

      expect(result.total).toBe(0);
      expect(result.hasNext).toBe(true);
    });

    it('should set hasPrevious based on prevCursor presence', () => {
      const withPrev = calculateCursorPagination(100, 20, false, undefined, 'prev');
      const withoutPrev = calculateCursorPagination(100, 20, false);

      expect(withPrev.hasPrevious).toBe(true);
      expect(withoutPrev.hasPrevious).toBe(false);
    });
  });

  // ==========================================================================
  // encodeCursor() / decodeCursor()
  // ==========================================================================

  describe('encodeCursor() / decodeCursor()', () => {
    it('should encode and decode cursor with string value', () => {
      const original = {
        field: 'name',
        value: 'device_050',
        lastId: 'id_001',
      };

      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(original);
    });

    it('should encode and decode cursor with numeric value', () => {
      const original = {
        field: 'battery_level',
        value: 75,
        lastId: 'id_002',
      };

      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded.field).toBe('battery_level');
      expect(decoded.value).toBe(75);
      expect(decoded.lastId).toBe('id_002');
    });

    it('should encode and decode cursor with Date value', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const original = {
        field: 'createdAt',
        value: date,
        lastId: 'id_003',
      };

      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded.field).toBe('createdAt');
      expect(decoded.value).toBe(date.toISOString());
      expect(decoded.lastId).toBe('id_003');
    });

    it('should use base64url encoding', () => {
      const cursor = encodeCursor({
        field: 'test',
        value: 'value',
        lastId: 'id',
      });

      // base64url should not contain +, /, or =
      expect(cursor).not.toContain('+');
      expect(cursor).not.toContain('/');
      expect(cursor).not.toContain('=');
    });

    it('should throw error for invalid cursor string', () => {
      expect(() => {
        decodeCursor('invalid_cursor');
      }).toThrow(ApiError);
    });

    it('should throw error for malformed JSON cursor', () => {
      const invalidCursor = Buffer.from('not json').toString('base64url');
      expect(() => {
        decodeCursor(invalidCursor);
      }).toThrow(ApiError);
    });

    it('should throw error for cursor missing required fields', () => {
      const invalidData = { field: 'test' }; // missing value and lastId
      const cursor = Buffer.from(JSON.stringify(invalidData)).toString('base64url');

      expect(() => {
        decodeCursor(cursor);
      }).toThrow(ApiError);
    });

    it('should include cursor in error metadata', () => {
      const invalidCursor = 'bad_cursor';
      try {
        decodeCursor(invalidCursor);
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (error instanceof ApiError) expect(error.metadata?.cursor).toBe(invalidCursor);
      }
    });
  });

  // ==========================================================================
  // createCursorFromItem()
  // ==========================================================================

  describe('createCursorFromItem()', () => {
    it('should create cursor from item with string _id', () => {
      const item = {
        _id: 'device_001',
        createdAt: new Date('2024-01-01'),
        name: 'Test Device',
      };

      const cursor = createCursorFromItem(item, 'createdAt');

      expect(cursor).toBeDefined();
      const decoded = decodeCursor(cursor!);
      expect(decoded.field).toBe('createdAt');
      expect(decoded.lastId).toBe('device_001');
    });

    it('should handle Date sort fields', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const item = {
        _id: 'device_002',
        createdAt: date,
        updatedAt: new Date(),
      };

      const cursor = createCursorFromItem(item, 'createdAt');
      const decoded = decodeCursor(cursor!);

      expect(decoded.value).toBe(date.toISOString());
    });

    it('should handle string sort fields', () => {
      const item = {
        _id: 'device_003',
        name: 'Device Alpha',
        status: 'active',
      };

      const cursor = createCursorFromItem(item, 'name');
      const decoded = decodeCursor(cursor!);

      expect(decoded.field).toBe('name');
      expect(decoded.value).toBe('Device Alpha');
    });

    it('should handle numeric sort fields', () => {
      const item = {
        _id: 'device_004',
        battery_level: 85,
      };

      const cursor = createCursorFromItem(item, 'battery_level');
      const decoded = decodeCursor(cursor!);

      expect(decoded.field).toBe('battery_level');
      expect(decoded.value).toBe('85'); // Converted to string
    });

    it('should return undefined for undefined item', () => {
      const cursor = createCursorFromItem(undefined, 'createdAt');

      expect(cursor).toBeUndefined();
    });

    it('should stringify non-string _id', () => {
      const item = {
        _id: { $oid: '507f1f77bcf86cd799439011' },
        name: 'Test',
      };

      const cursor = createCursorFromItem(item, 'name');
      const decoded = decodeCursor(cursor!);

      // Object _ids get stringified to "[object Object]"
      expect(decoded.lastId).toBe('[object Object]');
    });
  });

  // ==========================================================================
  // applyOffsetPagination()
  // ==========================================================================

  describe('applyOffsetPagination()', () => {
    it('should apply skip and limit to query', () => {
      const mockQuery = {
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
      };

      const params = {
        type: 'offset' as const,
        page: 3,
        limit: 25,
        skip: 50,
      };

      applyOffsetPagination(mockQuery, params);

      expect(mockQuery.skip).toHaveBeenCalledWith(50);
      expect(mockQuery.limit).toHaveBeenCalledWith(25);
    });

    it('should chain skip and limit calls', () => {
      const mockQuery = {
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
      };

      const params = {
        type: 'offset' as const,
        page: 1,
        limit: 20,
        skip: 0,
      };

      const result = applyOffsetPagination(mockQuery, params);

      expect(result).toBe(mockQuery);
    });
  });

  // ==========================================================================
  // buildCursorQuery()
  // ==========================================================================

  describe('buildCursorQuery()', () => {
    it('should return empty object when no decodedCursor', () => {
      const params = {
        type: 'cursor' as const,
        limit: 20,
      };

      const query = buildCursorQuery(params);

      expect(query).toEqual({});
    });

    it('should build descending cursor query', () => {
      const params = {
        type: 'cursor' as const,
        limit: 20,
        decodedCursor: {
          field: 'createdAt',
          value: '2024-01-01T00:00:00Z',
          lastId: 'device_001',
        },
      };

      const query = buildCursorQuery(params, 'desc');

      expect(query).toEqual({
        $or: [
          { createdAt: { $lt: '2024-01-01T00:00:00Z' } },
          {
            createdAt: '2024-01-01T00:00:00Z',
            _id: { $lt: 'device_001' },
          },
        ],
      });
    });

    it('should build ascending cursor query', () => {
      const params = {
        type: 'cursor' as const,
        limit: 20,
        decodedCursor: {
          field: 'updatedAt',
          value: '2024-06-15T12:00:00Z',
          lastId: 'device_050',
        },
      };

      const query = buildCursorQuery(params, 'asc');

      expect(query).toEqual({
        $or: [
          { updatedAt: { $gt: '2024-06-15T12:00:00Z' } },
          {
            updatedAt: '2024-06-15T12:00:00Z',
            _id: { $gt: 'device_050' },
          },
        ],
      });
    });

    it('should default to descending order', () => {
      const params = {
        type: 'cursor' as const,
        limit: 20,
        decodedCursor: {
          field: 'timestamp',
          value: 100,
          lastId: 'id_001',
        },
      };

      const query = buildCursorQuery(params);

      expect(query).toHaveProperty('$or');
      const orConditions = (query as { $or: Array<Record<string, unknown>> }).$or;
      expect(orConditions[0]).toHaveProperty('timestamp', { $lt: 100 });
    });

    it('should handle numeric field values', () => {
      const params = {
        type: 'cursor' as const,
        limit: 20,
        decodedCursor: {
          field: 'battery_level',
          value: 75,
          lastId: 'device_010',
        },
      };

      const query = buildCursorQuery(params, 'desc');

      expect(query).toEqual({
        $or: [
          { battery_level: { $lt: 75 } },
          {
            battery_level: 75,
            _id: { $lt: 'device_010' },
          },
        ],
      });
    });
  });
});
