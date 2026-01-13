/**
 * Error Handler Unit Tests
 *
 * Tests for centralized error handling that normalizes various error types
 * into consistent ApiError instances.
 */

import { ZodError, z } from 'zod';
import {
  handleError,
  normalizeError,
  withErrorHandler,
  errorToResponse,
} from '@/lib/errors/errorHandler';
import { ApiError } from '@/lib/errors/ApiError';
import { ErrorCodes } from '@/lib/errors/errorCodes';

describe('Error Handler', () => {
  // ==========================================================================
  // handleError() - ApiError instances
  // ==========================================================================

  describe('handleError() - ApiError instances', () => {
    it('should pass through ApiError as-is', () => {
      const originalError = ApiError.notFound('Device', 'device_001');
      const { error } = handleError(originalError);

      expect(error).toBe(originalError);
      expect(error.errorCode).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });

    it('should set shouldLog=true for 5xx ApiErrors', () => {
      const serverError = ApiError.internalError();
      const { shouldLog } = handleError(serverError);

      expect(shouldLog).toBe(true);
    });

    it('should set shouldLog=false for 4xx ApiErrors', () => {
      const clientError = ApiError.badRequest('Invalid input');
      const { shouldLog } = handleError(clientError);

      expect(shouldLog).toBe(false);
    });

    it('should log 5xx errors when logError=true', () => {
      const logger = jest.fn();
      const serverError = ApiError.internalError();

      handleError(serverError, { logger });

      expect(logger).toHaveBeenCalledWith(
        serverError,
        expect.objectContaining({
          errorCode: serverError.errorCode,
          statusCode: serverError.statusCode,
        })
      );
    });

    it('should not log 4xx errors by default', () => {
      const logger = jest.fn();
      const clientError = ApiError.badRequest('Invalid');

      handleError(clientError, { logger });

      expect(logger).not.toHaveBeenCalled();
    });

    it('should not log when logError=false', () => {
      const logger = jest.fn();
      const serverError = ApiError.internalError();

      handleError(serverError, { logger, logError: false });

      expect(logger).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // handleError() - Zod validation errors
  // ==========================================================================

  describe('handleError() - Zod validation errors', () => {
    it('should convert Zod errors to ApiError with VALIDATION_ERROR code', () => {
      const schema = z.object({
        email: z.string().email(),
      });

      try {
        schema.parse({ email: 'invalid' });
      } catch (zodError) {
        const { error, shouldLog } = handleError(zodError);

        expect(error.errorCode).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.statusCode).toBe(400);
        expect(shouldLog).toBe(false);
      }
    });

    it('should format single Zod error with field path', () => {
      const schema = z.object({
        age: z.number().min(0),
      });

      try {
        schema.parse({ age: -5 });
      } catch (zodError) {
        const { error } = handleError(zodError);

        expect(error.message).toContain('age');
        expect(error.metadata?.field).toBe('age');
      }
    });

    it('should format multiple Zod errors', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(0),
      });

      try {
        schema.parse({ email: 'invalid', age: -1 });
      } catch (zodError) {
        const { error } = handleError(zodError);

        expect(error.message).toContain('Validation failed');
        expect(error.message).toContain('email');
        expect(error.message).toContain('age');
      }
    });

    it('should include detailed error metadata', () => {
      const schema = z.object({
        name: z.string().min(1),
      });

      try {
        schema.parse({ name: '' });
      } catch (zodError) {
        const { error } = handleError(zodError);

        expect(error.metadata?.errors).toBeDefined();
        expect(Array.isArray(error.metadata?.errors)).toBe(true);
        expect(error.metadata?.errors[0]).toHaveProperty('path');
        expect(error.metadata?.errors[0]).toHaveProperty('message');
        expect(error.metadata?.errors[0]).toHaveProperty('code');
      }
    });
  });

  // ==========================================================================
  // handleError() - Mongoose/MongoDB errors
  // ==========================================================================

  describe('handleError() - Mongoose validation errors', () => {
    it('should convert Mongoose ValidationError to ApiError', () => {
      const mongooseError = new Error('Validation failed') as Error & {
        name: string;
        errors: Record<string, { message: string; path: string; value?: unknown }>;
      };
      mongooseError.name = 'ValidationError';
      mongooseError.errors = {
        serial_number: {
          message: 'Serial number is required',
          path: 'serial_number',
          value: undefined,
        },
      };

      const { error, shouldLog } = handleError(mongooseError);

      expect(error.errorCode).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.statusCode).toBe(400);
      expect(shouldLog).toBe(false);
    });

    it('should format Mongoose validation errors', () => {
      const mongooseError = new Error('Validation failed') as Error & {
        name: string;
        errors: Record<string, { message: string; path: string }>;
      };
      mongooseError.name = 'ValidationError';
      mongooseError.errors = {
        manufacturer: {
          message: 'Manufacturer is required',
          path: 'manufacturer',
        },
      };

      const { error } = handleError(mongooseError);

      expect(error.message).toContain('manufacturer');
      expect(error.message).toContain('required');
      expect(error.metadata?.field).toBe('manufacturer');
    });

    it('should handle multiple Mongoose validation errors', () => {
      const mongooseError = new Error('Validation failed') as Error & {
        name: string;
        errors: Record<string, { message: string; path: string }>;
      };
      mongooseError.name = 'ValidationError';
      mongooseError.errors = {
        serial_number: {
          message: 'Serial number is required',
          path: 'serial_number',
        },
        manufacturer: {
          message: 'Manufacturer is required',
          path: 'manufacturer',
        },
      };

      const { error } = handleError(mongooseError);

      expect(error.message).toContain('Validation failed');
      expect(error.metadata?.errors).toHaveLength(2);
    });
  });

  describe('handleError() - Mongoose CastError', () => {
    it('should convert CastError to ApiError with INVALID_FORMAT', () => {
      const castError = new Error('Cast to ObjectId failed') as Error & {
        name: string;
        path: string;
        value: unknown;
        kind: string;
      };
      castError.name = 'CastError';
      castError.path = '_id';
      castError.value = 'invalid_id';
      castError.kind = 'ObjectId';

      const { error, shouldLog } = handleError(castError);

      expect(error.errorCode).toBe(ErrorCodes.INVALID_FORMAT);
      expect(error.statusCode).toBe(400);
      expect(shouldLog).toBe(false);
    });

    it('should include field and expected type in message', () => {
      const castError = new Error('Cast failed') as Error & {
        name: string;
        path: string;
        value: unknown;
        kind: string;
      };
      castError.name = 'CastError';
      castError.path = 'count';
      castError.value = 'abc';
      castError.kind = 'Number';

      const { error } = handleError(castError);

      expect(error.message).toContain('count');
      expect(error.message).toContain('Number');
      expect(error.metadata?.field).toBe('count');
      expect(error.metadata?.expected).toBe('Number');
    });
  });

  describe('handleError() - MongoDB duplicate key errors', () => {
    it('should handle duplicate serial_number error', () => {
      const duplicateError = new Error('E11000 duplicate key error') as Error & {
        code: number;
        keyPattern: Record<string, number>;
        keyValue: Record<string, unknown>;
      };
      duplicateError.code = 11000;
      duplicateError.keyPattern = { serial_number: 1 };
      duplicateError.keyValue = { serial_number: 'SN-001' };

      const { error, shouldLog } = handleError(duplicateError);

      expect(error.errorCode).toBe(ErrorCodes.SERIAL_NUMBER_EXISTS);
      expect(error.statusCode).toBe(409);
      expect(error.message).toContain('SN-001');
      expect(shouldLog).toBe(false);
    });

    it('should handle duplicate _id error', () => {
      const duplicateError = new Error('E11000 duplicate key error') as Error & {
        code: number;
        keyPattern: Record<string, number>;
        keyValue: Record<string, unknown>;
      };
      duplicateError.code = 11000;
      duplicateError.keyPattern = { _id: 1 };
      duplicateError.keyValue = { _id: 'device_001' };

      const { error } = handleError(duplicateError);

      expect(error.errorCode).toBe(ErrorCodes.DEVICE_ID_EXISTS);
      expect(error.statusCode).toBe(409);
      expect(error.message).toContain('device_001');
    });

    it('should handle generic duplicate key error', () => {
      const duplicateError = new Error('E11000 duplicate key error') as Error & {
        code: number;
        keyPattern: Record<string, number>;
        keyValue: Record<string, unknown>;
      };
      duplicateError.code = 11000;
      duplicateError.keyPattern = { email: 1 };
      duplicateError.keyValue = { email: 'test@example.com' };

      const { error } = handleError(duplicateError);

      expect(error.errorCode).toBe(ErrorCodes.DUPLICATE_RESOURCE);
      expect(error.statusCode).toBe(409);
      expect(error.metadata?.field).toBe('email');
      expect(error.metadata?.value).toBe('test@example.com');
    });
  });

  describe('handleError() - MongoDB connection errors', () => {
    it('should handle ECONNREFUSED errors', () => {
      const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:27017') as Error & {
        code: number | undefined;
      };
      connectionError.code = undefined;

      const { error, shouldLog } = handleError(connectionError);

      expect(error.errorCode).toBe(ErrorCodes.CONNECTION_ERROR);
      expect(error.statusCode).toBe(500);
      expect(shouldLog).toBe(true);
    });

    it('should handle ETIMEDOUT errors', () => {
      const timeoutError = new Error('connect ETIMEDOUT') as Error & {
        code: number | undefined;
      };
      timeoutError.code = undefined;

      const { error } = handleError(timeoutError);

      expect(error.errorCode).toBe(ErrorCodes.CONNECTION_ERROR);
      expect(error.statusCode).toBe(500);
    });

    it('should handle generic MongoDB errors', () => {
      const dbError = new Error('Something went wrong in MongoDB') as Error & {
        code: number;
      };
      dbError.code = 999;

      const { error, shouldLog } = handleError(dbError);

      expect(error.errorCode).toBe(ErrorCodes.DATABASE_ERROR);
      expect(error.statusCode).toBe(500);
      expect(shouldLog).toBe(true);
    });
  });

  // ==========================================================================
  // handleError() - Standard Error instances
  // ==========================================================================

  describe('handleError() - Standard Error instances', () => {
    it('should convert timeout errors to GATEWAY_TIMEOUT', () => {
      const timeoutError = new Error('Request timeout exceeded');
      const { error, shouldLog } = handleError(timeoutError);

      expect(error.errorCode).toBe(ErrorCodes.GATEWAY_TIMEOUT);
      expect(error.statusCode).toBe(504);
      expect(shouldLog).toBe(true);
    });

    it('should convert network errors to CONNECTION_ERROR', () => {
      const networkError = new Error('Network connection failed');
      const { error } = handleError(networkError);

      expect(error.errorCode).toBe(ErrorCodes.CONNECTION_ERROR);
      expect(error.statusCode).toBe(500);
    });

    it('should convert generic errors to INTERNAL_ERROR', () => {
      const genericError = new Error('Something unexpected happened');
      const { error, shouldLog } = handleError(genericError);

      expect(error.errorCode).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.statusCode).toBe(500);
      expect(shouldLog).toBe(true);
    });

    it('should preserve original stack trace', () => {
      const originalError = new Error('Test error');
      const originalStack = originalError.stack;

      const { error } = handleError(originalError);

      expect(error.stack).toBe(originalStack);
    });

    it('should include original message in metadata', () => {
      const originalError = new Error('Database connection lost');
      const { error } = handleError(originalError);

      expect(error.metadata?.originalMessage).toBe('Database connection lost');
    });
  });

  // ==========================================================================
  // handleError() - Unknown error types
  // ==========================================================================

  describe('handleError() - Unknown error types', () => {
    it('should handle string errors', () => {
      const { error, shouldLog } = handleError('Something went wrong');

      expect(error.errorCode).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Something went wrong');
      expect(shouldLog).toBe(true);
    });

    it('should handle null/undefined errors', () => {
      const { error: nullError } = handleError(null);
      const { error: undefinedError } = handleError(undefined);

      expect(nullError.errorCode).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(undefinedError.errorCode).toBe(ErrorCodes.INTERNAL_ERROR);
    });

    it('should handle object errors', () => {
      const { error } = handleError({ custom: 'error object' });

      expect(error.errorCode).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.message).toBe('An unexpected error occurred');
    });

    it('should handle number errors', () => {
      const { error } = handleError(404);

      expect(error.errorCode).toBe(ErrorCodes.INTERNAL_ERROR);
    });
  });

  // ==========================================================================
  // handleError() - Logging options
  // ==========================================================================

  describe('handleError() - Logging options', () => {
    it('should call custom logger with error and context', () => {
      const logger = jest.fn();
      const context = { requestId: 'req_123', userId: 'user_456' };
      const serverError = ApiError.internalError();

      handleError(serverError, { logger, context });

      expect(logger).toHaveBeenCalledWith(
        serverError,
        expect.objectContaining({
          requestId: 'req_123',
          userId: 'user_456',
          errorCode: serverError.errorCode,
          statusCode: serverError.statusCode,
        })
      );
    });

    it('should use console.error by default', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const serverError = ApiError.internalError();

      handleError(serverError);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should include ISO timestamp in log context', () => {
      const logger = jest.fn();
      const serverError = ApiError.internalError();

      handleError(serverError, { logger });

      const loggedContext = logger.mock.calls[0][1];
      expect(loggedContext.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ==========================================================================
  // normalizeError()
  // ==========================================================================

  describe('normalizeError()', () => {
    it('should return ApiError directly', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['field'],
          message: 'Expected string',
        },
      ]);

      const error = normalizeError(zodError);

      expect(error).toBeInstanceOf(ApiError);
      expect(error.errorCode).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should pass options to handleError', () => {
      const logger = jest.fn();
      const serverError = new Error('Server error');

      normalizeError(serverError, { logger });

      expect(logger).toHaveBeenCalled();
    });

    it('should work as a convenience wrapper', () => {
      const originalError = ApiError.notFound('Device');
      const normalized = normalizeError(originalError);

      expect(normalized).toBe(originalError);
    });
  });

  // ==========================================================================
  // withErrorHandler()
  // ==========================================================================

  describe('withErrorHandler()', () => {
    it('should pass through successful responses', async () => {
      const handler = jest.fn().mockResolvedValue(Response.json({ success: true }));
      const wrappedHandler = withErrorHandler(handler);

      const response = await wrappedHandler('arg1', 'arg2');
      const body = await response.json();

      expect(body.success).toBe(true);
      expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should catch and convert errors to Response', async () => {
      const handler = jest.fn().mockRejectedValue(ApiError.notFound('Device'));
      const wrappedHandler = withErrorHandler(handler);

      const response = await wrappedHandler();
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should handle Zod validation errors', async () => {
      const schema = z.object({ email: z.string().email() });
      const handler = jest.fn().mockImplementation(async () => {
        schema.parse({ email: 'invalid' });
        return Response.json({ success: true });
      });
      const wrappedHandler = withErrorHandler(handler);

      const response = await wrappedHandler();
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should handle generic errors', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Unexpected error'));
      const wrappedHandler = withErrorHandler(handler);

      const response = await wrappedHandler();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
    });

    it('should preserve handler arguments', async () => {
      const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }));
      const wrappedHandler = withErrorHandler(handler);

      await wrappedHandler('arg1', 123, { key: 'value' });

      expect(handler).toHaveBeenCalledWith('arg1', 123, { key: 'value' });
    });
  });

  // ==========================================================================
  // errorToResponse()
  // ==========================================================================

  describe('errorToResponse()', () => {
    it('should convert any error to Response', async () => {
      const error = new Error('Test error');
      const response = errorToResponse(error);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    });

    it('should handle ApiError instances', async () => {
      const error = ApiError.badRequest('Invalid input');
      const response = errorToResponse(error);

      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('should pass options to handleError', () => {
      const logger = jest.fn();
      const error = new Error('Server error');

      errorToResponse(error, { logger });

      expect(logger).toHaveBeenCalled();
    });

    it('should handle Zod validation errors', async () => {
      const schema = z.object({ age: z.number() });
      let zodError;
      try {
        schema.parse({ age: 'not a number' });
      } catch (e) {
        zodError = e;
      }

      const response = errorToResponse(zodError!);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });
});
