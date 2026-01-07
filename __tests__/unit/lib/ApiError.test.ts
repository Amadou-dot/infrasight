/**
 * ApiError Unit Tests
 *
 * Tests for the ApiError class and its static factory methods.
 */

import { ApiError } from '@/lib/errors/ApiError';

describe('ApiError', () => {
  describe('Constructor', () => {
    it('should create an ApiError instance with all properties', () => {
      const metadata = { field: 'email', expected: 'valid email' };
      const error = new ApiError('TEST_ERROR', 400, 'Test message', metadata);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ApiError');
      expect(error.errorCode).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Test message');
      expect(error.metadata).toEqual(metadata);
      expect(error.isOperational).toBe(true);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should create an ApiError without metadata', () => {
      const error = new ApiError('TEST_ERROR', 404, 'Not found');

      expect(error.errorCode).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Not found');
      expect(error.metadata).toBeUndefined();
    });

    it('should maintain proper prototype chain', () => {
      const error = new ApiError('TEST', 400, 'Test');

      expect(error instanceof ApiError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should capture stack trace', () => {
      const error = new ApiError('TEST', 400, 'Test');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ApiError');
    });
  });

  describe('toJSON()', () => {
    it('should convert error to JSON format', () => {
      const error = new ApiError('TEST_ERROR', 400, 'Test message');
      const json = error.toJSON();

      expect(json).toEqual({
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: 'Test message',
          statusCode: 400,
        },
        timestamp: expect.any(String),
      });
    });

    it('should include metadata in JSON when present', () => {
      const metadata = { field: 'email' };
      const error = new ApiError('VALIDATION_ERROR', 400, 'Invalid email', metadata);
      const json = error.toJSON();

      expect(json.error.metadata).toEqual(metadata);
    });

    it('should exclude metadata from JSON when empty', () => {
      const error = new ApiError('TEST_ERROR', 400, 'Test', {});
      const json = error.toJSON();

      expect(json.error).not.toHaveProperty('metadata');
    });

    it('should format timestamp as ISO string', () => {
      const error = new ApiError('TEST', 400, 'Test');
      const json = error.toJSON();

      expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(json.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('toResponse()', () => {
    it('should create a Response object with correct status code', () => {
      const error = new ApiError('TEST_ERROR', 404, 'Not found');
      const response = error.toResponse();

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(404);
    });

    it('should create a Response with JSON body', async () => {
      const error = new ApiError('TEST_ERROR', 400, 'Bad request');
      const response = error.toResponse();
      const body = await response.json();

      expect(body).toEqual({
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: 'Bad request',
          statusCode: 400,
        },
        timestamp: expect.any(String),
      });
    });
  });

  describe('Static Factory Methods', () => {
    describe('badRequest()', () => {
      it('should create a 400 bad request error', () => {
        const error = ApiError.badRequest('Invalid request');

        expect(error.errorCode).toBe('BAD_REQUEST');
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Invalid request');
      });

      it('should accept metadata', () => {
        const metadata = { param: 'id' };
        const error = ApiError.badRequest('Invalid ID', metadata);

        expect(error.metadata).toEqual(metadata);
      });
    });

    describe('validationError()', () => {
      it('should create a validation error', () => {
        const error = ApiError.validationError('Validation failed');

        expect(error.errorCode).toBe('VALIDATION_ERROR');
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Validation failed');
      });
    });

    describe('invalidInput()', () => {
      it('should create an invalid input error', () => {
        const error = ApiError.invalidInput('Invalid input format');

        expect(error.errorCode).toBe('INVALID_INPUT');
        expect(error.statusCode).toBe(400);
      });
    });

    describe('unauthorized()', () => {
      it('should create a 401 unauthorized error', () => {
        const error = ApiError.unauthorized();

        expect(error.errorCode).toBe('UNAUTHORIZED');
        expect(error.statusCode).toBe(401);
        expect(error.message).toBe('Authentication required');
      });

      it('should accept custom message', () => {
        const error = ApiError.unauthorized('Invalid token');

        expect(error.message).toBe('Invalid token');
      });
    });

    describe('forbidden()', () => {
      it('should create a 403 forbidden error', () => {
        const error = ApiError.forbidden();

        expect(error.errorCode).toBe('FORBIDDEN');
        expect(error.statusCode).toBe(403);
        expect(error.message).toContain('permission');
      });

      it('should accept custom message', () => {
        const error = ApiError.forbidden('Admin access required');

        expect(error.message).toBe('Admin access required');
      });
    });

    describe('notFound()', () => {
      it('should create a not found error with identifier', () => {
        const error = ApiError.notFound('Device', 'device_001');

        expect(error.errorCode).toBe('NOT_FOUND');
        expect(error.statusCode).toBe(404);
        expect(error.message).toContain('Device');
        expect(error.message).toContain('device_001');
        expect(error.metadata?.resourceType).toBe('Device');
        expect(error.metadata?.id).toBe('device_001');
      });

      it('should create a not found error without identifier', () => {
        const error = ApiError.notFound('User');

        expect(error.message).toBe('User not found');
        expect(error.metadata?.resourceType).toBe('User');
        expect(error.metadata?.id).toBeUndefined();
      });

      it('should accept object identifier', () => {
        const error = ApiError.notFound('Device', { serial: 'ABC123' });

        expect(error.message).toContain('{"serial":"ABC123"}');
      });
    });

    describe('deviceNotFound()', () => {
      it('should create a device not found error', () => {
        const error = ApiError.deviceNotFound('device_001');

        expect(error.errorCode).toBe('DEVICE_NOT_FOUND');
        expect(error.statusCode).toBe(404);
        expect(error.message).toContain('device_001');
        expect(error.metadata?.id).toBe('device_001');
      });
    });

    describe('readingNotFound()', () => {
      it('should create a reading not found error', () => {
        const error = ApiError.readingNotFound('reading_001');

        expect(error.errorCode).toBe('READING_NOT_FOUND');
        expect(error.statusCode).toBe(404);
        expect(error.message).toContain('reading_001');
      });
    });

    describe('conflict()', () => {
      it('should create a 409 conflict error', () => {
        const error = ApiError.conflict('Resource already exists');

        expect(error.errorCode).toBe('CONFLICT');
        expect(error.statusCode).toBe(409);
      });
    });

    describe('duplicate()', () => {
      it('should create a duplicate resource error', () => {
        const error = ApiError.duplicate('Device', 'serial_number', 'SN-001');

        expect(error.errorCode).toBe('DUPLICATE_RESOURCE');
        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('Device');
        expect(error.message).toContain('serial_number');
        expect(error.message).toContain('SN-001');
        expect(error.metadata?.field).toBe('serial_number');
        expect(error.metadata?.value).toBe('SN-001');
      });
    });

    describe('unprocessableEntity()', () => {
      it('should create a 422 unprocessable entity error', () => {
        const error = ApiError.unprocessableEntity('Invalid state transition');

        expect(error.errorCode).toBe('UNPROCESSABLE_ENTITY');
        expect(error.statusCode).toBe(422);
      });
    });

    describe('rateLimitExceeded()', () => {
      it('should create a rate limit error without retry time', () => {
        const error = ApiError.rateLimitExceeded();

        expect(error.errorCode).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.statusCode).toBe(429);
        expect(error.message).toBe('Rate limit exceeded');
      });

      it('should create a rate limit error with retry time', () => {
        const error = ApiError.rateLimitExceeded(60);

        expect(error.message).toContain('60 seconds');
        expect(error.metadata?.retryAfter).toBe(60);
      });

      it('should merge retry time with custom metadata', () => {
        const error = ApiError.rateLimitExceeded(30, { endpoint: '/api/v2/devices' });

        expect(error.metadata?.retryAfter).toBe(30);
        expect(error.metadata?.endpoint).toBe('/api/v2/devices');
      });
    });

    describe('internalError()', () => {
      it('should create a 500 internal error', () => {
        const error = ApiError.internalError();

        expect(error.errorCode).toBe('INTERNAL_ERROR');
        expect(error.statusCode).toBe(500);
        expect(error.message).toContain('unexpected');
        expect(error.isOperational).toBe(false);
      });

      it('should accept custom message', () => {
        const error = ApiError.internalError('Database connection failed');

        expect(error.message).toBe('Database connection failed');
        expect(error.isOperational).toBe(false);
      });
    });

    describe('badGateway()', () => {
      it('should create a 502 bad gateway error', () => {
        const error = ApiError.badGateway('Payment Service');

        expect(error.errorCode).toBe('BAD_GATEWAY');
        expect(error.statusCode).toBe(502);
        expect(error.message).toContain('Payment Service');
        expect(error.metadata?.service).toBe('Payment Service');
      });
    });

    describe('serviceUnavailable()', () => {
      it('should create a 503 service unavailable error', () => {
        const error = ApiError.serviceUnavailable();

        expect(error.errorCode).toBe('SERVICE_UNAVAILABLE');
        expect(error.statusCode).toBe(503);
        expect(error.message).toContain('unavailable');
      });
    });

    describe('gatewayTimeout()', () => {
      it('should create a 504 gateway timeout error', () => {
        const error = ApiError.gatewayTimeout('External API');

        expect(error.errorCode).toBe('GATEWAY_TIMEOUT');
        expect(error.statusCode).toBe(504);
        expect(error.message).toContain('External API');
        expect(error.message).toContain('timed out');
        expect(error.metadata?.service).toBe('External API');
      });
    });
  });

  describe('Error Inheritance', () => {
    it('should work with instanceof checks', () => {
      const error = ApiError.notFound('Resource');

      expect(error instanceof ApiError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should work in try-catch blocks', () => {
      try {
        throw ApiError.badRequest('Test error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (error instanceof ApiError) {
          expect(error.statusCode).toBe(400);
        }
      }
    });
  });

  describe('isOperational Flag', () => {
    it('should mark operational errors as operational', () => {
      const errors = [
        ApiError.badRequest('test'),
        ApiError.notFound('test'),
        ApiError.unauthorized(),
        ApiError.forbidden(),
        ApiError.conflict('test'),
      ];

      errors.forEach((error) => {
        expect(error.isOperational).toBe(true);
      });
    });

    it('should mark internal errors as non-operational', () => {
      const error = ApiError.internalError();

      expect(error.isOperational).toBe(false);
    });
  });
});
