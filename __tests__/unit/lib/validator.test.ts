/**
 * Validator Utility Tests
 *
 * Tests for Zod schema validation wrapper functions.
 */

import { z } from 'zod';
import {
  validateInput,
  validateOrThrow,
  validateQuery,
  validateQueryOrThrow,
  validateBody,
  validateBodyOrThrow,
  validateValue,
  formatZodErrors,
  formatErrorMessage,
  createSchema,
  mergeSchemas,
  type ValidationResult,
  type ValidationError,
} from '@/lib/validations/validator';
import { ApiError } from '@/lib/errors/ApiError';

describe('Validator Utilities', () => {
  // ==========================================================================
  // formatZodErrors()
  // ==========================================================================

  describe('formatZodErrors()', () => {
    it('should format basic type errors', () => {
      const schema = z.object({ name: z.string() });
      const result = schema.safeParse({ name: 123 });

      if (!result.success) {
        const errors = formatZodErrors(result.error);

        expect(errors).toHaveLength(1);
        expect(errors[0].path).toBe('name');
        expect(errors[0].code).toBe('invalid_type');
        expect(errors[0].expected).toBe('string');
      }
    });

    it('should format nested path errors', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      });
      const result = schema.safeParse({ user: { email: 'invalid' } });

      if (!result.success) {
        const errors = formatZodErrors(result.error);

        expect(errors[0].path).toBe('user.email');
      }
    });

    it('should format too_small errors', () => {
      const schema = z.object({ count: z.number().min(5) });
      const result = schema.safeParse({ count: 3 });

      if (!result.success) {
        const errors = formatZodErrors(result.error);

        expect(errors[0].code).toBe('too_small');
        expect(errors[0].expected).toContain('at least');
      }
    });

    it('should format too_big errors', () => {
      const schema = z.object({ count: z.number().max(10) });
      const result = schema.safeParse({ count: 15 });

      if (!result.success) {
        const errors = formatZodErrors(result.error);

        expect(errors[0].code).toBe('too_big');
        expect(errors[0].expected).toContain('at most');
      }
    });

    it('should handle root-level errors', () => {
      const schema = z.string();
      const result = schema.safeParse(123);

      if (!result.success) {
        const errors = formatZodErrors(result.error);

        expect(errors[0].path).toBe('root');
      }
    });
  });

  // ==========================================================================
  // formatErrorMessage()
  // ==========================================================================

  describe('formatErrorMessage()', () => {
    it('should return generic message for empty errors', () => {
      const message = formatErrorMessage([]);

      expect(message).toBe('Validation failed');
    });

    it('should format single error with path', () => {
      const errors: ValidationError[] = [
        { path: 'email', message: 'Invalid email', code: 'invalid_string' },
      ];

      const message = formatErrorMessage(errors);

      expect(message).toBe('email: Invalid email');
    });

    it('should format single root error without path prefix', () => {
      const errors: ValidationError[] = [
        { path: 'root', message: 'Invalid value', code: 'invalid_type' },
      ];

      const message = formatErrorMessage(errors);

      expect(message).toBe('Invalid value');
    });

    it('should format multiple errors with truncation', () => {
      const errors: ValidationError[] = [
        { path: 'field1', message: 'Error 1', code: 'custom' },
        { path: 'field2', message: 'Error 2', code: 'custom' },
        { path: 'field3', message: 'Error 3', code: 'custom' },
        { path: 'field4', message: 'Error 4', code: 'custom' },
        { path: 'field5', message: 'Error 5', code: 'custom' },
      ];

      const message = formatErrorMessage(errors);

      expect(message).toContain('Validation failed');
      expect(message).toContain('field1: Error 1');
      expect(message).toContain('field2: Error 2');
      expect(message).toContain('field3: Error 3');
      expect(message).toContain('and 2 more');
    });

    it('should include context prefix when provided', () => {
      const errors: ValidationError[] = [
        { path: 'name', message: 'Required', code: 'invalid_type' },
      ];

      const message = formatErrorMessage(errors, 'Query parameter');

      expect(message).toBe('Query parameter: name: Required');
    });
  });

  // ==========================================================================
  // validateInput()
  // ==========================================================================

  describe('validateInput()', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().min(0),
    });

    it('should return success for valid input', () => {
      const result = validateInput({ name: 'John', age: 30 }, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'John', age: 30 });
      }
    });

    it('should return errors for invalid input', () => {
      const result = validateInput({ name: 123, age: -1 }, schema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should sanitize input by default', () => {
      const result = validateInput({ name: 'John', age: 30, $gt: 100 }, schema);

      // $gt should be stripped by sanitizer
      expect(result.success).toBe(true);
    });

    it('should skip sanitization when disabled', () => {
      const result = validateInput(
        { name: 'John', age: 30 },
        schema,
        { sanitize: false }
      );

      expect(result.success).toBe(true);
    });

    it('should strip unknown keys when requested', () => {
      const result = validateInput(
        { name: 'John', age: 30, extra: 'field' },
        schema,
        { stripUnknown: true }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extra');
      }
    });

    it('should handle null input gracefully', () => {
      const result = validateInput(null, schema);

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // validateOrThrow()
  // ==========================================================================

  describe('validateOrThrow()', () => {
    const schema = z.object({ name: z.string() });

    it('should return data for valid input', () => {
      const data = validateOrThrow({ name: 'John' }, schema);

      expect(data).toEqual({ name: 'John' });
    });

    it('should throw ApiError for invalid input', () => {
      expect(() => {
        validateOrThrow({ name: 123 }, schema);
      }).toThrow(ApiError);
    });

    it('should include context in error message', () => {
      try {
        validateOrThrow({ name: 123 }, schema, { context: 'Device' });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.message).toContain('Device');
      }
    });
  });

  // ==========================================================================
  // validateQuery()
  // ==========================================================================

  describe('validateQuery()', () => {
    const schema = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      status: z.string().optional(),
    });

    it('should validate URLSearchParams', () => {
      const params = new URLSearchParams('page=1&limit=10&status=active');

      const result = validateQuery(params, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ page: 1, limit: 10, status: 'active' });
      }
    });

    it('should validate URL object', () => {
      const url = new URL('http://localhost/api?page=2&limit=20');

      const result = validateQuery(url, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.page).toBe(2);
      }
    });

    it('should validate URL string', () => {
      const result = validateQuery('http://localhost/api?page=3', schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.page).toBe(3);
      }
    });

    it('should handle query string without URL', () => {
      const result = validateQuery('page=4&status=inactive', schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.page).toBe(4);
        expect(result.data?.status).toBe('inactive');
      }
    });

    it('should handle multiple values for same key', () => {
      const arraySchema = z.object({
        tags: z.union([z.string(), z.array(z.string())]).optional(),
      });
      const params = new URLSearchParams('tags=a&tags=b&tags=c');

      const result = validateQuery(params, arraySchema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.tags).toEqual(['a', 'b', 'c']);
      }
    });
  });

  // ==========================================================================
  // validateQueryOrThrow()
  // ==========================================================================

  describe('validateQueryOrThrow()', () => {
    const schema = z.object({
      page: z.coerce.number().min(1),
    });

    it('should return data for valid query', () => {
      const data = validateQueryOrThrow('page=5', schema);

      expect(data.page).toBe(5);
    });

    it('should throw ApiError for invalid query', () => {
      expect(() => {
        validateQueryOrThrow('page=0', schema);
      }).toThrow(ApiError);
    });
  });

  // ==========================================================================
  // validateBody()
  // ==========================================================================

  describe('validateBody()', () => {
    const schema = z.object({
      name: z.string(),
      value: z.number(),
    });

    const createMockRequest = (body: unknown, valid = true): Request => {
      return {
        json: valid
          ? jest.fn().mockResolvedValue(body)
          : jest.fn().mockRejectedValue(new SyntaxError('Invalid JSON')),
      } as unknown as Request;
    };

    it('should validate valid JSON body', async () => {
      const request = createMockRequest({ name: 'Test', value: 42 });

      const result = await validateBody(request, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'Test', value: 42 });
      }
    });

    it('should return errors for invalid body', async () => {
      const request = createMockRequest({ name: 123, value: 'invalid' });

      const result = await validateBody(request, schema);

      expect(result.success).toBe(false);
    });

    it('should handle JSON parsing error', async () => {
      const request = createMockRequest(null, false);

      const result = await validateBody(request, schema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].code).toBe('invalid_json');
        expect(result.errors[0].message).toBe('Invalid JSON in request body');
      }
    });

    it('should handle other parsing errors', async () => {
      const request = {
        json: jest.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as Request;

      const result = await validateBody(request, schema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].code).toBe('parse_error');
      }
    });
  });

  // ==========================================================================
  // validateBodyOrThrow()
  // ==========================================================================

  describe('validateBodyOrThrow()', () => {
    const schema = z.object({ name: z.string() });

    it('should return data for valid body', async () => {
      const request = {
        json: jest.fn().mockResolvedValue({ name: 'Test' }),
      } as unknown as Request;

      const data = await validateBodyOrThrow(request, schema);

      expect(data).toEqual({ name: 'Test' });
    });

    it('should throw ApiError for invalid body', async () => {
      const request = {
        json: jest.fn().mockResolvedValue({ name: 123 }),
      } as unknown as Request;

      await expect(validateBodyOrThrow(request, schema)).rejects.toThrow(ApiError);
    });

    it('should use INVALID_BODY code for JSON errors', async () => {
      const request = {
        json: jest.fn().mockRejectedValue(new SyntaxError('Invalid JSON')),
      } as unknown as Request;

      try {
        await validateBodyOrThrow(request, schema);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.errorCode).toBe('INVALID_BODY');
      }
    });
  });

  // ==========================================================================
  // validateValue()
  // ==========================================================================

  describe('validateValue()', () => {
    it('should validate single value', () => {
      const schema = z.string().email();

      const result = validateValue('test@example.com', schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('test@example.com');
      }
    });

    it('should return error for invalid value', () => {
      const schema = z.string().email();

      const result = validateValue('invalid-email', schema);

      expect(result.success).toBe(false);
    });

    it('should use provided field name in error path', () => {
      const schema = z.string().email();

      const result = validateValue('invalid', schema, 'userEmail');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].path).toBe('userEmail');
      }
    });
  });

  // ==========================================================================
  // createSchema()
  // ==========================================================================

  describe('createSchema()', () => {
    const baseSchema = z.object({
      name: z.string(),
      age: z.number(),
    });

    it('should return schema unchanged with no options', () => {
      const schema = createSchema(baseSchema);
      const result = schema.safeParse({ name: 'John', age: 30 });

      expect(result.success).toBe(true);
    });

    it('should create partial schema', () => {
      const schema = createSchema(baseSchema, { partial: true });

      // All fields should be optional
      const result = schema.safeParse({});

      expect(result.success).toBe(true);
    });

    it('should strip unknown keys', () => {
      const schema = createSchema(baseSchema, { strip: true });
      const result = schema.safeParse({ name: 'John', age: 30, extra: 'field' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extra');
      }
    });

    it('should make all fields required', () => {
      const optionalSchema = z.object({
        name: z.string().optional(),
        age: z.number().optional(),
      });
      const schema = createSchema(optionalSchema, { required: true });

      const result = schema.safeParse({ name: 'John' }); // missing age

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // mergeSchemas()
  // ==========================================================================

  describe('mergeSchemas()', () => {
    it('should merge two schemas', () => {
      const base = z.object({ name: z.string() });
      const extension = z.object({ age: z.number() });

      const merged = mergeSchemas(base, extension);
      const result = merged.safeParse({ name: 'John', age: 30 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'John', age: 30 });
      }
    });

    it('should fail when merged schema requirements not met', () => {
      const base = z.object({ name: z.string() });
      const extension = z.object({ age: z.number() });

      const merged = mergeSchemas(base, extension);
      const result = merged.safeParse({ name: 'John' }); // missing age

      expect(result.success).toBe(false);
    });
  });
});
