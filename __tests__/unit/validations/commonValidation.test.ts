/**
 * Common Validation Tests
 *
 * Tests for Zod schemas used across the v2 API:
 * pagination, date ranges, field validations, and query helpers.
 */

import {
  cursorPaginationSchema,
  offsetPaginationSchema,
  paginationSchema,
  analyticsPaginationSchema,
  pastDateSchema,
  futureDateSchema,
  dateRangeSchema,
  timeRangePresetSchema,
  sortDirectionSchema,
  createSortSchema,
  objectIdSchema,
  deviceIdSchema,
  serialNumberSchema,
  buildingIdSchema,
  floorSchema,
  roomNameSchema,
  percentageSchema,
  batteryLevelSchema,
  confidenceScoreSchema,
  anomalyScoreSchema,
  thresholdSchema,
  samplingIntervalSchema,
  retentionDaysSchema,
  tagsSchema,
  departmentSchema,
  costCenterSchema,
  manufacturerSchema,
  modelNameSchema,
  firmwareVersionSchema,
  zoneSchema,
  coordinatesSchema,
  userIdentifierSchema,
  errorCodeSchema,
  errorMessageSchema,
  stringToNumberSchema,
  stringToBooleanSchema,
  commaSeparatedToArraySchema,
  signalStrengthSchema,
} from '@/lib/validations/common.validation';

describe('Pagination Schemas', () => {
  describe('cursorPaginationSchema', () => {
    it('accepts valid input', () => {
      const result = cursorPaginationSchema.parse({ cursor: 'abc123', limit: 10 });
      expect(result.cursor).toBe('abc123');
      expect(result.limit).toBe(10);
    });

    it('uses default limit of 20', () => {
      const result = cursorPaginationSchema.parse({});
      expect(result.limit).toBe(20);
    });

    it('rejects limit below 1', () => {
      expect(() => cursorPaginationSchema.parse({ limit: 0 })).toThrow();
    });

    it('rejects limit above 100', () => {
      expect(() => cursorPaginationSchema.parse({ limit: 101 })).toThrow();
    });

    it('rejects non-integer limit', () => {
      expect(() => cursorPaginationSchema.parse({ limit: 10.5 })).toThrow();
    });
  });

  describe('offsetPaginationSchema', () => {
    it('uses defaults (page=1, limit=20)', () => {
      const result = offsetPaginationSchema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('rejects page below 1', () => {
      expect(() => offsetPaginationSchema.parse({ page: 0 })).toThrow();
    });
  });

  describe('paginationSchema', () => {
    it('accepts page as string (transforms to number)', () => {
      const result = paginationSchema.parse({ page: '5' });
      expect(result.page).toBe(5);
    });

    it('accepts limit as string', () => {
      const result = paginationSchema.parse({ limit: '50' });
      expect(result.limit).toBe(50);
    });

    it('rejects using both cursor and page', () => {
      expect(() =>
        paginationSchema.parse({ cursor: 'abc', page: 1 })
      ).toThrow();
    });

    it('accepts cursor without page', () => {
      const result = paginationSchema.parse({ cursor: 'abc', limit: 10 });
      expect(result.cursor).toBe('abc');
    });

    it('rejects page below 1', () => {
      expect(() => paginationSchema.parse({ page: '0' })).toThrow();
    });

    it('rejects limit above 100', () => {
      expect(() => paginationSchema.parse({ limit: '101' })).toThrow();
    });

    it('default limit is 20', () => {
      const result = paginationSchema.parse({});
      expect(result.limit).toBe(20);
    });
  });

  describe('analyticsPaginationSchema', () => {
    it('uses default limit of 100', () => {
      const result = analyticsPaginationSchema.parse({});
      expect(result.limit).toBe(100);
    });

    it('allows limit up to 1000', () => {
      const result = analyticsPaginationSchema.parse({ limit: '1000' });
      expect(result.limit).toBe(1000);
    });

    it('rejects limit above 1000', () => {
      expect(() => analyticsPaginationSchema.parse({ limit: '1001' })).toThrow();
    });

    it('accepts page as string', () => {
      const result = analyticsPaginationSchema.parse({ page: '3' });
      expect(result.page).toBe(3);
    });
  });
});

describe('Date Schemas', () => {
  describe('pastDateSchema', () => {
    it('accepts past Date object', () => {
      const pastDate = new Date('2020-01-01');
      const result = pastDateSchema.parse(pastDate);
      expect(result).toEqual(pastDate);
    });

    it('accepts past ISO string', () => {
      const result = pastDateSchema.parse('2020-01-01T00:00:00Z');
      expect(result).toBeInstanceOf(Date);
    });

    it('rejects future date', () => {
      const futureDate = new Date(Date.now() + 86400000 * 365);
      expect(() => pastDateSchema.parse(futureDate)).toThrow();
    });
  });

  describe('futureDateSchema', () => {
    it('accepts future date', () => {
      const futureDate = new Date(Date.now() + 86400000);
      const result = futureDateSchema.parse(futureDate);
      expect(result).toEqual(futureDate);
    });

    it('accepts past date (no future restriction)', () => {
      const pastDate = new Date('2020-01-01');
      const result = futureDateSchema.parse(pastDate);
      expect(result).toEqual(pastDate);
    });

    it('transforms string to Date', () => {
      const result = futureDateSchema.parse('2030-01-01T00:00:00Z');
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('dateRangeSchema', () => {
    it('accepts valid range', () => {
      const result = dateRangeSchema.parse({
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-31T00:00:00Z',
      });
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('rejects end before start', () => {
      expect(() =>
        dateRangeSchema.parse({
          startDate: '2025-02-01T00:00:00Z',
          endDate: '2025-01-01T00:00:00Z',
        })
      ).toThrow();
    });

    it('accepts equal start and end dates', () => {
      const result = dateRangeSchema.parse({
        startDate: '2025-01-15T00:00:00Z',
        endDate: '2025-01-15T00:00:00Z',
      });
      expect(result.startDate!.getTime()).toBe(result.endDate!.getTime());
    });

    it('accepts omitted dates (both optional)', () => {
      const result = dateRangeSchema.parse({});
      expect(result.startDate).toBeUndefined();
      expect(result.endDate).toBeUndefined();
    });

    it('accepts only startDate', () => {
      const result = dateRangeSchema.parse({ startDate: '2025-01-01T00:00:00Z' });
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeUndefined();
    });
  });

  describe('timeRangePresetSchema', () => {
    it.each(['last_hour', 'last_24h', 'last_7d', 'last_30d', 'last_90d', 'custom'])(
      'accepts "%s"',
      (preset) => {
        expect(timeRangePresetSchema.parse(preset)).toBe(preset);
      }
    );

    it('rejects invalid preset', () => {
      expect(() => timeRangePresetSchema.parse('last_year')).toThrow();
    });
  });
});

describe('Sort Schemas', () => {
  describe('sortDirectionSchema', () => {
    it('accepts "asc"', () => {
      expect(sortDirectionSchema.parse('asc')).toBe('asc');
    });

    it('accepts "desc"', () => {
      expect(sortDirectionSchema.parse('desc')).toBe('desc');
    });

    it('rejects invalid direction', () => {
      expect(() => sortDirectionSchema.parse('up')).toThrow();
    });
  });

  describe('createSortSchema', () => {
    const fields = ['name', 'created_at', 'status'] as const;
    const schema = createSortSchema(fields);

    it('accepts valid sortBy field', () => {
      const result = schema.parse({ sortBy: 'name' });
      expect(result.sortBy).toBe('name');
    });

    it('rejects invalid sortBy field', () => {
      expect(() => schema.parse({ sortBy: 'invalid' })).toThrow();
    });

    it('accepts omitted fields', () => {
      const result = schema.parse({});
      expect(result.sortBy).toBeUndefined();
    });
  });
});

describe('Field Validations', () => {
  describe('objectIdSchema', () => {
    it('accepts valid 24-char hex string', () => {
      expect(objectIdSchema.parse('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
    });

    it('rejects short string', () => {
      expect(() => objectIdSchema.parse('507f1f77')).toThrow();
    });

    it('rejects non-hex characters', () => {
      expect(() => objectIdSchema.parse('507f1f77bcf86cd79943901g')).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => objectIdSchema.parse('')).toThrow();
    });
  });

  describe('deviceIdSchema', () => {
    it('accepts valid device ID', () => {
      expect(deviceIdSchema.parse('device_001')).toBe('device_001');
    });

    it('accepts hyphens', () => {
      expect(deviceIdSchema.parse('device-001')).toBe('device-001');
    });

    it('rejects empty string', () => {
      expect(() => deviceIdSchema.parse('')).toThrow();
    });

    it('rejects special characters', () => {
      expect(() => deviceIdSchema.parse('device 001')).toThrow();
    });

    it('rejects string over 100 chars', () => {
      expect(() => deviceIdSchema.parse('a'.repeat(101))).toThrow();
    });
  });

  describe('serialNumberSchema', () => {
    it('accepts valid serial number', () => {
      expect(serialNumberSchema.parse('SN-12345')).toBe('SN-12345');
    });

    it('rejects special characters', () => {
      expect(() => serialNumberSchema.parse('SN_12345')).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => serialNumberSchema.parse('')).toThrow();
    });

    it('rejects over 50 characters', () => {
      expect(() => serialNumberSchema.parse('A'.repeat(51))).toThrow();
    });
  });

  describe('buildingIdSchema', () => {
    it('accepts valid building ID', () => {
      expect(buildingIdSchema.parse('bldg_001')).toBe('bldg_001');
    });

    it('rejects spaces', () => {
      expect(() => buildingIdSchema.parse('bldg 001')).toThrow();
    });
  });

  describe('floorSchema', () => {
    it('accepts valid floor', () => {
      expect(floorSchema.parse(5)).toBe(5);
    });

    it('accepts negative floors (basement)', () => {
      expect(floorSchema.parse(-5)).toBe(-5);
    });

    it('rejects below -10', () => {
      expect(() => floorSchema.parse(-11)).toThrow();
    });

    it('rejects above 200', () => {
      expect(() => floorSchema.parse(201)).toThrow();
    });

    it('rejects non-integer', () => {
      expect(() => floorSchema.parse(1.5)).toThrow();
    });
  });

  describe('roomNameSchema', () => {
    it('accepts valid room name', () => {
      expect(roomNameSchema.parse('Server Room A')).toBe('Server Room A');
    });

    it('rejects empty', () => {
      expect(() => roomNameSchema.parse('')).toThrow();
    });

    it('rejects over 100 characters', () => {
      expect(() => roomNameSchema.parse('x'.repeat(101))).toThrow();
    });
  });

  describe('percentageSchema', () => {
    it('accepts 0', () => {
      expect(percentageSchema.parse(0)).toBe(0);
    });

    it('accepts 100', () => {
      expect(percentageSchema.parse(100)).toBe(100);
    });

    it('rejects negative', () => {
      expect(() => percentageSchema.parse(-1)).toThrow();
    });

    it('rejects above 100', () => {
      expect(() => percentageSchema.parse(101)).toThrow();
    });
  });

  describe('batteryLevelSchema', () => {
    it('is identical to percentageSchema behavior', () => {
      expect(batteryLevelSchema.parse(50)).toBe(50);
      expect(() => batteryLevelSchema.parse(-1)).toThrow();
      expect(() => batteryLevelSchema.parse(101)).toThrow();
    });
  });

  describe('signalStrengthSchema', () => {
    it('accepts valid dBm value', () => {
      expect(signalStrengthSchema.parse(-70)).toBe(-70);
    });

    it('accepts percentage value', () => {
      expect(signalStrengthSchema.parse(80)).toBe(80);
    });

    it('rejects below -150', () => {
      expect(() => signalStrengthSchema.parse(-151)).toThrow();
    });

    it('rejects above 100', () => {
      expect(() => signalStrengthSchema.parse(101)).toThrow();
    });
  });

  describe('confidenceScoreSchema', () => {
    it('accepts 0', () => {
      expect(confidenceScoreSchema.parse(0)).toBe(0);
    });

    it('accepts 1', () => {
      expect(confidenceScoreSchema.parse(1)).toBe(1);
    });

    it('accepts 0.5', () => {
      expect(confidenceScoreSchema.parse(0.5)).toBe(0.5);
    });

    it('rejects negative', () => {
      expect(() => confidenceScoreSchema.parse(-0.1)).toThrow();
    });

    it('rejects above 1', () => {
      expect(() => confidenceScoreSchema.parse(1.1)).toThrow();
    });
  });

  describe('anomalyScoreSchema', () => {
    it('accepts valid range 0-1', () => {
      expect(anomalyScoreSchema.parse(0.7)).toBe(0.7);
    });

    it('rejects above 1', () => {
      expect(() => anomalyScoreSchema.parse(1.5)).toThrow();
    });
  });

  describe('thresholdSchema', () => {
    it('accepts 0', () => {
      expect(thresholdSchema.parse(0)).toBe(0);
    });

    it('rejects negative', () => {
      expect(() => thresholdSchema.parse(-1)).toThrow();
    });

    it('accepts large positive number', () => {
      expect(thresholdSchema.parse(99999)).toBe(99999);
    });
  });

  describe('samplingIntervalSchema', () => {
    it('accepts 1 second', () => {
      expect(samplingIntervalSchema.parse(1)).toBe(1);
    });

    it('accepts 86400 seconds', () => {
      expect(samplingIntervalSchema.parse(86400)).toBe(86400);
    });

    it('rejects 0', () => {
      expect(() => samplingIntervalSchema.parse(0)).toThrow();
    });

    it('rejects above 86400', () => {
      expect(() => samplingIntervalSchema.parse(86401)).toThrow();
    });

    it('rejects non-integer', () => {
      expect(() => samplingIntervalSchema.parse(1.5)).toThrow();
    });
  });

  describe('retentionDaysSchema', () => {
    it('accepts 1 day', () => {
      expect(retentionDaysSchema.parse(1)).toBe(1);
    });

    it('accepts 3650 days', () => {
      expect(retentionDaysSchema.parse(3650)).toBe(3650);
    });

    it('rejects 0', () => {
      expect(() => retentionDaysSchema.parse(0)).toThrow();
    });

    it('rejects above 3650', () => {
      expect(() => retentionDaysSchema.parse(3651)).toThrow();
    });
  });

  describe('tagsSchema', () => {
    it('accepts valid tags array', () => {
      const result = tagsSchema.parse(['critical', 'production']);
      expect(result).toEqual(['critical', 'production']);
    });

    it('defaults to empty array', () => {
      expect(tagsSchema.parse(undefined)).toEqual([]);
    });

    it('rejects tags with spaces', () => {
      expect(() => tagsSchema.parse(['invalid tag'])).toThrow();
    });

    it('rejects empty tag strings', () => {
      expect(() => tagsSchema.parse([''])).toThrow();
    });

    it('rejects tags over 50 characters', () => {
      expect(() => tagsSchema.parse(['a'.repeat(51)])).toThrow();
    });

    it('rejects more than 20 tags', () => {
      const tooMany = Array.from({ length: 21 }, (_, i) => `tag${i}`);
      expect(() => tagsSchema.parse(tooMany)).toThrow();
    });
  });

  describe('departmentSchema', () => {
    it('accepts valid department', () => {
      expect(departmentSchema.parse('Engineering')).toBe('Engineering');
    });

    it('rejects empty', () => {
      expect(() => departmentSchema.parse('')).toThrow();
    });
  });

  describe('costCenterSchema', () => {
    it('accepts valid cost center', () => {
      expect(costCenterSchema.parse('CC-001')).toBe('CC-001');
    });

    it('accepts undefined (optional)', () => {
      expect(costCenterSchema.parse(undefined)).toBeUndefined();
    });

    it('rejects over 50 characters', () => {
      expect(() => costCenterSchema.parse('x'.repeat(51))).toThrow();
    });
  });

  describe('manufacturerSchema', () => {
    it('accepts valid manufacturer', () => {
      expect(manufacturerSchema.parse('Honeywell')).toBe('Honeywell');
    });

    it('rejects empty', () => {
      expect(() => manufacturerSchema.parse('')).toThrow();
    });
  });

  describe('modelNameSchema', () => {
    it('accepts valid model name', () => {
      expect(modelNameSchema.parse('T9000')).toBe('T9000');
    });

    it('rejects empty', () => {
      expect(() => modelNameSchema.parse('')).toThrow();
    });
  });

  describe('firmwareVersionSchema', () => {
    it('accepts semver format', () => {
      expect(firmwareVersionSchema.parse('1.2.3')).toBe('1.2.3');
    });

    it('accepts semver with tag', () => {
      expect(firmwareVersionSchema.parse('1.2.3-beta')).toBe('1.2.3-beta');
    });

    it('accepts simple version', () => {
      expect(firmwareVersionSchema.parse('1')).toBe('1');
    });

    it('rejects invalid format', () => {
      expect(() => firmwareVersionSchema.parse('v1.2.3')).toThrow();
    });

    it('rejects empty', () => {
      expect(() => firmwareVersionSchema.parse('')).toThrow();
    });
  });

  describe('zoneSchema', () => {
    it('accepts valid zone', () => {
      expect(zoneSchema.parse('Zone-A')).toBe('Zone-A');
    });

    it('accepts undefined (optional)', () => {
      expect(zoneSchema.parse(undefined)).toBeUndefined();
    });

    it('rejects over 50 characters', () => {
      expect(() => zoneSchema.parse('z'.repeat(51))).toThrow();
    });
  });

  describe('coordinatesSchema', () => {
    it('accepts valid x,y coordinates', () => {
      const result = coordinatesSchema.parse({ x: 10, y: 20 });
      expect(result).toEqual({ x: 10, y: 20 });
    });

    it('accepts x,y,z coordinates', () => {
      const result = coordinatesSchema.parse({ x: 10, y: 20, z: 5 });
      expect(result).toEqual({ x: 10, y: 20, z: 5 });
    });

    it('accepts undefined (optional)', () => {
      expect(coordinatesSchema.parse(undefined)).toBeUndefined();
    });

    it('rejects extra properties (strict)', () => {
      expect(() => coordinatesSchema.parse({ x: 10, y: 20, w: 5 })).toThrow();
    });

    it('rejects missing x or y', () => {
      expect(() => coordinatesSchema.parse({ x: 10 })).toThrow();
    });
  });

  describe('userIdentifierSchema', () => {
    it('accepts valid identifier', () => {
      expect(userIdentifierSchema.parse('admin@example.com')).toBe('admin@example.com');
    });

    it('rejects empty', () => {
      expect(() => userIdentifierSchema.parse('')).toThrow();
    });

    it('rejects over 100 characters', () => {
      expect(() => userIdentifierSchema.parse('a'.repeat(101))).toThrow();
    });
  });

  describe('errorCodeSchema', () => {
    it('accepts valid error code', () => {
      expect(errorCodeSchema.parse('ERR_001')).toBe('ERR_001');
    });

    it('rejects empty', () => {
      expect(() => errorCodeSchema.parse('')).toThrow();
    });

    it('rejects over 50 characters', () => {
      expect(() => errorCodeSchema.parse('E'.repeat(51))).toThrow();
    });
  });

  describe('errorMessageSchema', () => {
    it('accepts valid message', () => {
      expect(errorMessageSchema.parse('Something went wrong')).toBe('Something went wrong');
    });

    it('accepts empty string', () => {
      expect(errorMessageSchema.parse('')).toBe('');
    });

    it('rejects over 500 characters', () => {
      expect(() => errorMessageSchema.parse('x'.repeat(501))).toThrow();
    });
  });
});

describe('Query Parameter Helpers', () => {
  describe('stringToNumberSchema', () => {
    it('transforms "123" to 123', () => {
      expect(stringToNumberSchema.parse('123')).toBe(123);
    });

    it('transforms "0" to 0', () => {
      expect(stringToNumberSchema.parse('0')).toBe(0);
    });

    it('rejects non-numeric string', () => {
      expect(() => stringToNumberSchema.parse('abc')).toThrow();
    });
  });

  describe('stringToBooleanSchema', () => {
    it('transforms "true" to true', () => {
      expect(stringToBooleanSchema.parse('true')).toBe(true);
    });

    it('transforms "1" to true', () => {
      expect(stringToBooleanSchema.parse('1')).toBe(true);
    });

    it('transforms "false" to false', () => {
      expect(stringToBooleanSchema.parse('false')).toBe(false);
    });

    it('transforms "0" to false', () => {
      expect(stringToBooleanSchema.parse('0')).toBe(false);
    });

    it('transforms arbitrary string to false', () => {
      expect(stringToBooleanSchema.parse('maybe')).toBe(false);
    });
  });

  describe('commaSeparatedToArraySchema', () => {
    it('splits comma-separated values', () => {
      expect(commaSeparatedToArraySchema.parse('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('trims whitespace', () => {
      expect(commaSeparatedToArraySchema.parse(' a , b , c ')).toEqual(['a', 'b', 'c']);
    });

    it('filters empty strings', () => {
      expect(commaSeparatedToArraySchema.parse('a,,b')).toEqual(['a', 'b']);
    });

    it('handles single value', () => {
      expect(commaSeparatedToArraySchema.parse('single')).toEqual(['single']);
    });
  });
});
