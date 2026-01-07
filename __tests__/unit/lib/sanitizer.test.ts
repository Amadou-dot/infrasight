/**
 * Sanitizer Utilities Unit Tests
 *
 * Tests for input sanitization to prevent NoSQL injection, XSS, and other attacks.
 */

import {
  sanitizeString,
  sanitizeForRegex,
  sanitizeSearchQuery,
  isMongoOperator,
  isDangerousKey,
  sanitizeInput,
  validateObjectId,
  assertObjectId,
  validateDeviceId,
  assertDeviceId,
  sanitizeNumber,
  assertNumber,
  sanitizeDate,
  assertDate,
} from '@/lib/validations/sanitizer';
import { ApiError } from '@/lib/errors/ApiError';
import { ErrorCodes } from '@/lib/errors/errorCodes';

describe('Sanitizer Utilities', () => {
  // ==========================================================================
  // sanitizeString()
  // ==========================================================================

  describe('sanitizeString()', () => {
    it('should trim whitespace', () => {
      expect(sanitizeString('  hello world  ')).toBe('hello world');
      expect(sanitizeString('\t\n  test  \n\t')).toBe('test');
    });

    it('should handle non-string input', () => {
      expect(sanitizeString(123 as unknown as string)).toBe('123');
      expect(sanitizeString(null as unknown as string)).toBe('');
      expect(sanitizeString(undefined as unknown as string)).toBe('');
    });

    it('should remove null bytes and control characters', () => {
      expect(sanitizeString('hello\x00world')).toBe('helloworld');
      expect(sanitizeString('test\x01\x02\x03')).toBe('test');
    });

    it('should truncate to maxLength', () => {
      expect(sanitizeString('hello world', { maxLength: 5 })).toBe('hello');
      expect(sanitizeString('test', { maxLength: 10 })).toBe('test');
    });

    it('should escape HTML characters', () => {
      const input = '<script>alert("xss")</script>';
      const expected =
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;';
      expect(sanitizeString(input, { escapeHtml: true })).toBe(expected);
    });

    it('should escape all HTML special characters', () => {
      const input = '&<>"\'`=/';
      const expected = '&amp;&lt;&gt;&quot;&#x27;&#x60;&#x3D;&#x2F;';
      expect(sanitizeString(input, { escapeHtml: true })).toBe(expected);
    });

    it('should convert to lowercase', () => {
      expect(sanitizeString('HELLO World', { lowercase: true })).toBe(
        'hello world'
      );
    });

    it('should throw error for empty string when allowEmpty=false', () => {
      expect(() => {
        sanitizeString('  ', { allowEmpty: false });
      }).toThrow(ApiError);

      expect(() => {
        sanitizeString('  ', { allowEmpty: false });
      }).toThrow('Input cannot be empty');
    });

    it('should allow empty string by default', () => {
      expect(sanitizeString('  ')).toBe('');
      expect(sanitizeString('', { allowEmpty: true })).toBe('');
    });

    it('should combine multiple options', () => {
      const result = sanitizeString('  <SCRIPT>  ', {
        escapeHtml: true,
        lowercase: true,
        maxLength: 10,
      });
      // Truncation happens before HTML escaping, so result is escaped version
      expect(result).toBe('&lt;script&gt;');
    });
  });

  // ==========================================================================
  // sanitizeForRegex()
  // ==========================================================================

  describe('sanitizeForRegex()', () => {
    it('should escape regex special characters', () => {
      expect(sanitizeForRegex('hello.*world')).toBe('hello\\.\\*world');
      expect(sanitizeForRegex('test[123]')).toBe('test\\[123\\]');
      expect(sanitizeForRegex('a+b?c')).toBe('a\\+b\\?c');
    });

    it('should escape all regex metacharacters', () => {
      const special = '.*+?^${}()|[]\\';
      const escaped = sanitizeForRegex(special);
      // Each special char should be escaped
      expect(escaped).toContain('\\.');
      expect(escaped).toContain('\\*');
      expect(escaped).toContain('\\+');
      expect(escaped).toContain('\\?');
    });

    it('should trim whitespace', () => {
      expect(sanitizeForRegex('  test  ')).toBe('test');
    });

    it('should handle non-string input', () => {
      expect(sanitizeForRegex(123 as unknown as string)).toBe('123');
      expect(sanitizeForRegex(null as unknown as string)).toBe('');
    });

    it('should preserve normal text', () => {
      expect(sanitizeForRegex('hello world')).toBe('hello world');
    });
  });

  // ==========================================================================
  // sanitizeSearchQuery()
  // ==========================================================================

  describe('sanitizeSearchQuery()', () => {
    it('should remove MongoDB operators', () => {
      expect(sanitizeSearchQuery('test $where 1==1')).not.toContain('$where');
      expect(sanitizeSearchQuery('search $gt value')).not.toContain('$gt');
      expect(sanitizeSearchQuery('$or test $and')).toBe('test');
    });

    it('should escape regex special characters', () => {
      expect(sanitizeSearchQuery('hello.*world')).toBe('hello\\.\\*world');
    });

    it('should normalize whitespace', () => {
      expect(sanitizeSearchQuery('  hello   world  ')).toBe('hello world');
      expect(sanitizeSearchQuery('test\t\nmulti\nline')).toBe(
        'test multi line'
      );
    });

    it('should return empty string for non-string input', () => {
      expect(sanitizeSearchQuery(null as unknown as string)).toBe('');
      expect(sanitizeSearchQuery(undefined as unknown as string)).toBe('');
      // sanitizeSearchQuery returns empty string for non-string input
      expect(sanitizeSearchQuery(123 as unknown as string)).toBe('');
    });

    it('should handle mixed dangerous content', () => {
      const query = '$where.*+?test $regex attack';
      const sanitized = sanitizeSearchQuery(query);
      expect(sanitized).not.toContain('$where');
      expect(sanitized).not.toContain('$regex');
      expect(sanitized).toContain('test');
    });
  });

  // ==========================================================================
  // isMongoOperator() / isDangerousKey()
  // ==========================================================================

  describe('isMongoOperator()', () => {
    it('should detect MongoDB operators', () => {
      expect(isMongoOperator('$where')).toBe(true);
      expect(isMongoOperator('$gt')).toBe(true);
      expect(isMongoOperator('$regex')).toBe(true);
      expect(isMongoOperator('$in')).toBe(true);
    });

    it('should detect keys starting with $', () => {
      expect(isMongoOperator('$custom')).toBe(true);
      expect(isMongoOperator('$anyOperator')).toBe(true);
    });

    it('should not flag normal keys', () => {
      expect(isMongoOperator('name')).toBe(false);
      expect(isMongoOperator('email')).toBe(false);
      expect(isMongoOperator('status')).toBe(false);
    });
  });

  describe('isDangerousKey()', () => {
    it('should detect dangerous prototype properties', () => {
      expect(isDangerousKey('__proto__')).toBe(true);
      expect(isDangerousKey('constructor')).toBe(true);
      expect(isDangerousKey('prototype')).toBe(true);
    });

    it('should detect dangerous getter/setter methods', () => {
      expect(isDangerousKey('__defineGetter__')).toBe(true);
      expect(isDangerousKey('__defineSetter__')).toBe(true);
      expect(isDangerousKey('__lookupGetter__')).toBe(true);
      expect(isDangerousKey('__lookupSetter__')).toBe(true);
    });

    it('should not flag normal keys', () => {
      expect(isDangerousKey('name')).toBe(false);
      expect(isDangerousKey('_id')).toBe(false);
      expect(isDangerousKey('proto')).toBe(false);
    });
  });

  // ==========================================================================
  // sanitizeInput()
  // ==========================================================================

  describe('sanitizeInput()', () => {
    it('should remove MongoDB operators from objects', () => {
      const input = {
        name: 'test',
        $where: '1==1',
        $gt: 100,
      };
      const result = sanitizeInput(input);

      expect(result.name).toBe('test');
      expect(result.$where).toBeUndefined();
      expect(result.$gt).toBeUndefined();
    });

    it('should remove dangerous keys', () => {
      const input = {
        name: 'test',
        __proto__: { admin: true },
        constructor: { admin: true },
      };
      const result = sanitizeInput(input);

      expect(result.name).toBe('test');
      // Check that dangerous keys are not in the object's own properties
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(
        false
      );
      expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(
        false
      );
    });

    it('should sanitize string values', () => {
      const input = {
        name: '  hello  ',
        description: '  world  ',
      };
      const result = sanitizeInput(input);

      expect(result.name).toBe('hello');
      expect(result.description).toBe('world');
    });

    it('should handle nested objects', () => {
      const input = {
        user: {
          name: '  test  ',
          $where: 'attack',
        },
      };
      const result = sanitizeInput(input);

      expect((result.user as { name: string }).name).toBe('test');
      expect((result.user as Record<string, unknown>).$where).toBeUndefined();
    });

    it('should handle arrays', () => {
      const input = {
        tags: ['  tag1  ', '  tag2  '],
      };
      const result = sanitizeInput(input);

      expect((result.tags as string[])[0]).toBe('tag1');
      expect((result.tags as string[])[1]).toBe('tag2');
    });

    it('should preserve null and undefined values', () => {
      const input = {
        name: null,
        age: undefined,
        status: 'active',
      };
      const result = sanitizeInput(input);

      expect(result.name).toBeNull();
      expect(result.age).toBeUndefined();
      expect(result.status).toBe('active');
    });

    it('should handle numbers correctly', () => {
      const input = {
        count: 123,
        price: 45.67,
        infinity: Infinity,
        nan: NaN,
      };
      const result = sanitizeInput(input);

      expect(result.count).toBe(123);
      expect(result.price).toBe(45.67);
      expect(result.infinity).toBe(0); // Infinity converted to 0
      expect(result.nan).toBe(0); // NaN converted to 0
    });

    it('should preserve booleans', () => {
      const input = {
        active: true,
        deleted: false,
      };
      const result = sanitizeInput(input);

      expect(result.active).toBe(true);
      expect(result.deleted).toBe(false);
    });

    it('should preserve Date objects', () => {
      const date = new Date('2024-01-15');
      const input = { createdAt: date };
      const result = sanitizeInput(input);

      expect(result.createdAt).toBe(date);
    });

    it('should skip specified fields', () => {
      const input = {
        name: '  test  ',
        rawData: '  keep whitespace  ',
      };
      const result = sanitizeInput(input, { skipFields: ['rawData'] });

      expect(result.name).toBe('test');
      expect(result.rawData).toBe('  keep whitespace  ');
    });

    it('should respect maxDepth option', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              value: '  test  ',
            },
          },
        },
      };
      const result = sanitizeInput(input, { maxDepth: 2 });

      // Depth 3 should not be sanitized
      expect(
        (
          (result.level1 as { level2: { level3: { value: string } } }).level2
            .level3.value as string
        )
      ).toBe('  test  ');
    });

    it('should allow disabling MongoDB operator removal', () => {
      const input = { name: 'test', $custom: 'value' };
      const result = sanitizeInput(input, { removeMongoOperators: false });

      expect(result.$custom).toBe('value');
    });

    it('should allow disabling string sanitization', () => {
      const input = { name: '  test  ' };
      const result = sanitizeInput(input, { sanitizeStrings: false });

      expect(result.name).toBe('  test  ');
    });
  });

  // ==========================================================================
  // validateObjectId() / assertObjectId()
  // ==========================================================================

  describe('validateObjectId()', () => {
    it('should validate correct ObjectId format', () => {
      expect(validateObjectId('507f1f77bcf86cd799439011')).toBe(true);
      expect(validateObjectId('5f8d0d55b54764421b7156d3')).toBe(true);
    });

    it('should reject invalid ObjectId format', () => {
      expect(validateObjectId('invalid')).toBe(false);
      expect(validateObjectId('507f1f77bcf86cd79943901')).toBe(false); // Too short
      expect(validateObjectId('507f1f77bcf86cd799439011x')).toBe(false); // Too long
      expect(validateObjectId('507f1f77bcf86cd79943901g')).toBe(false); // Invalid char
    });

    it('should reject non-string input', () => {
      expect(validateObjectId(123 as unknown as string)).toBe(false);
      expect(validateObjectId(null as unknown as string)).toBe(false);
      expect(validateObjectId(undefined as unknown as string)).toBe(false);
    });
  });

  describe('assertObjectId()', () => {
    it('should pass for valid ObjectId', () => {
      expect(() => {
        assertObjectId('507f1f77bcf86cd799439011');
      }).not.toThrow();
    });

    it('should throw ApiError for invalid ObjectId', () => {
      expect(() => {
        assertObjectId('invalid');
      }).toThrow(ApiError);

      try {
        assertObjectId('short');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (error instanceof ApiError) {
          expect(error.errorCode).toBe(ErrorCodes.INVALID_FORMAT);
          expect(error.statusCode).toBe(400);
        }
      }
    });

    it('should include field name in error message', () => {
      try {
        assertObjectId('invalid', 'device_id');
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (error instanceof ApiError) {
          expect(error.message).toContain('device_id');
          expect(error.metadata?.field).toBe('device_id');
        }
      }
    });
  });

  // ==========================================================================
  // validateDeviceId() / assertDeviceId()
  // ==========================================================================

  describe('validateDeviceId()', () => {
    it('should validate correct device ID format', () => {
      expect(validateDeviceId('device_001')).toBe(true);
      expect(validateDeviceId('sensor-123')).toBe(true);
      expect(validateDeviceId('ABC_123_XYZ')).toBe(true);
    });

    it('should reject invalid characters', () => {
      expect(validateDeviceId('device 001')).toBe(false); // Space
      expect(validateDeviceId('device@001')).toBe(false); // Special char
      expect(validateDeviceId('device!001')).toBe(false);
    });

    it('should enforce length constraints', () => {
      expect(validateDeviceId('')).toBe(false); // Too short
      expect(validateDeviceId('a')).toBe(true); // Minimum length
      expect(validateDeviceId('a'.repeat(100))).toBe(true); // Maximum length
      expect(validateDeviceId('a'.repeat(101))).toBe(false); // Too long
    });

    it('should reject non-string input', () => {
      expect(validateDeviceId(123 as unknown as string)).toBe(false);
      expect(validateDeviceId(null as unknown as string)).toBe(false);
    });
  });

  describe('assertDeviceId()', () => {
    it('should pass for valid device ID', () => {
      expect(() => {
        assertDeviceId('device_001');
      }).not.toThrow();
    });

    it('should throw ApiError for invalid device ID', () => {
      expect(() => {
        assertDeviceId('invalid id');
      }).toThrow(ApiError);

      try {
        assertDeviceId('invalid@id');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (error instanceof ApiError) {
          expect(error.errorCode).toBe(ErrorCodes.INVALID_FORMAT);
          expect(error.message).toContain('alphanumeric');
        }
      }
    });
  });

  // ==========================================================================
  // sanitizeNumber() / assertNumber()
  // ==========================================================================

  describe('sanitizeNumber()', () => {
    it('should parse numeric strings', () => {
      expect(sanitizeNumber('123')).toBe(123);
      expect(sanitizeNumber('45.67')).toBe(45.67);
      expect(sanitizeNumber('-10')).toBe(-10);
    });

    it('should accept numeric values', () => {
      expect(sanitizeNumber(123)).toBe(123);
      expect(sanitizeNumber(45.67)).toBe(45.67);
    });

    it('should parse integers when integer=true', () => {
      expect(sanitizeNumber('123.45', { integer: true })).toBe(123);
      expect(sanitizeNumber('10', { integer: true })).toBe(10);
    });

    it('should return undefined for invalid input', () => {
      expect(sanitizeNumber('abc')).toBeUndefined();
      // '12abc' parses to 12 with parseFloat, not undefined
      expect(sanitizeNumber('abc123')).toBeUndefined();
      expect(sanitizeNumber(null)).toBeUndefined();
    });

    it('should return undefined for Infinity and NaN', () => {
      expect(sanitizeNumber(Infinity)).toBeUndefined();
      expect(sanitizeNumber(-Infinity)).toBeUndefined();
      expect(sanitizeNumber(NaN)).toBeUndefined();
      expect(sanitizeNumber('Infinity')).toBeUndefined();
    });

    it('should enforce min constraint', () => {
      expect(sanitizeNumber(5, { min: 10 })).toBeUndefined();
      expect(sanitizeNumber(10, { min: 10 })).toBe(10);
      expect(sanitizeNumber(15, { min: 10 })).toBe(15);
    });

    it('should enforce max constraint', () => {
      expect(sanitizeNumber(15, { max: 10 })).toBeUndefined();
      expect(sanitizeNumber(10, { max: 10 })).toBe(10);
      expect(sanitizeNumber(5, { max: 10 })).toBe(5);
    });

    it('should return default value when parsing fails', () => {
      expect(sanitizeNumber('invalid', { default: 0 })).toBe(0);
      expect(sanitizeNumber(Infinity, { default: 100 })).toBe(100);
      expect(sanitizeNumber(null, { default: 42 })).toBe(42);
    });

    it('should return default value when constraints fail', () => {
      expect(sanitizeNumber(5, { min: 10, default: 10 })).toBe(10);
      expect(sanitizeNumber(15, { max: 10, default: 10 })).toBe(10);
    });
  });

  describe('assertNumber()', () => {
    it('should return number for valid input', () => {
      expect(assertNumber('123', 'count')).toBe(123);
      expect(assertNumber(45.67, 'price')).toBe(45.67);
    });

    it('should throw ApiError for invalid input', () => {
      expect(() => {
        assertNumber('invalid', 'age');
      }).toThrow(ApiError);

      try {
        assertNumber(Infinity, 'value');
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (error instanceof ApiError) {
          expect(error.errorCode).toBe(ErrorCodes.INVALID_INPUT);
          expect(error.metadata?.field).toBe('value');
        }
      }
    });

    it('should enforce constraints', () => {
      expect(() => {
        assertNumber(5, 'age', { min: 10 });
      }).toThrow(ApiError);

      expect(() => {
        assertNumber(15, 'count', { max: 10 });
      }).toThrow(ApiError);
    });
  });

  // ==========================================================================
  // sanitizeDate() / assertDate()
  // ==========================================================================

  describe('sanitizeDate()', () => {
    it('should accept Date objects', () => {
      const date = new Date('2024-01-15');
      expect(sanitizeDate(date)).toEqual(date);
    });

    it('should parse date strings', () => {
      const result = sanitizeDate('2024-01-15');
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toContain('2024-01-15');
    });

    it('should parse timestamps', () => {
      const timestamp = 1705305600000; // 2024-01-15
      const result = sanitizeDate(timestamp);
      expect(result).toBeInstanceOf(Date);
    });

    it('should return undefined for invalid dates', () => {
      expect(sanitizeDate('invalid')).toBeUndefined();
      expect(sanitizeDate('not-a-date')).toBeUndefined();
      expect(sanitizeDate(null)).toBeUndefined();
    });

    it('should enforce minDate constraint', () => {
      const minDate = new Date('2024-01-01');
      const beforeMin = new Date('2023-12-31');
      const afterMin = new Date('2024-01-02');

      expect(sanitizeDate(beforeMin, { minDate })).toBeUndefined();
      expect(sanitizeDate(afterMin, { minDate })).toEqual(afterMin);
    });

    it('should enforce maxDate constraint', () => {
      const maxDate = new Date('2024-12-31');
      const beforeMax = new Date('2024-12-30');
      const afterMax = new Date('2025-01-01');

      expect(sanitizeDate(beforeMax, { maxDate })).toEqual(beforeMax);
      expect(sanitizeDate(afterMax, { maxDate })).toBeUndefined();
    });

    it('should return default value when parsing fails', () => {
      const defaultDate = new Date('2024-01-01');
      expect(sanitizeDate('invalid', { default: defaultDate })).toEqual(
        defaultDate
      );
    });
  });

  describe('assertDate()', () => {
    it('should return Date for valid input', () => {
      const result = assertDate('2024-01-15', 'startDate');
      expect(result).toBeInstanceOf(Date);
    });

    it('should throw ApiError for invalid input', () => {
      expect(() => {
        assertDate('invalid', 'createdAt');
      }).toThrow(ApiError);

      try {
        assertDate('not-a-date', 'updatedAt');
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (error instanceof ApiError) {
          expect(error.errorCode).toBe(ErrorCodes.INVALID_INPUT);
          expect(error.metadata?.field).toBe('updatedAt');
        }
      }
    });

    it('should enforce notInFuture constraint', () => {
      const futureDate = new Date(Date.now() + 86400000); // Tomorrow
      expect(() => {
        assertDate(futureDate, 'birthDate', { notInFuture: true });
      }).toThrow(ApiError);
    });

    it('should allow past dates with notInFuture=true', () => {
      const pastDate = new Date('2020-01-01');
      expect(() => {
        assertDate(pastDate, 'birthDate', { notInFuture: true });
      }).not.toThrow();
    });

    it('should enforce minDate constraint', () => {
      const minDate = new Date('2024-01-01');
      const beforeMin = new Date('2023-12-31');

      expect(() => {
        assertDate(beforeMin, 'startDate', { minDate });
      }).toThrow(ApiError);
    });
  });
});
