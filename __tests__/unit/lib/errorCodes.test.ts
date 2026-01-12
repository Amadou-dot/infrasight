/**
 * Error Codes Tests
 *
 * Tests for centralized error code definitions.
 */

import {
  ErrorCodes,
  ErrorCodeRegistry,
  getStatusCodeForError,
  getErrorDescription,
  isValidErrorCode,
  getErrorCodesForStatus,
  type ErrorCode,
} from '@/lib/errors/errorCodes';

describe('Error Codes', () => {
  // ==========================================================================
  // ErrorCodes
  // ==========================================================================

  describe('ErrorCodes', () => {
    it('should define all authentication error codes', () => {
      expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
      expect(ErrorCodes.FORBIDDEN).toBe('FORBIDDEN');
      expect(ErrorCodes.INVALID_TOKEN).toBe('INVALID_TOKEN');
      expect(ErrorCodes.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
      expect(ErrorCodes.INSUFFICIENT_PERMISSIONS).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should define all validation error codes', () => {
      expect(ErrorCodes.BAD_REQUEST).toBe('BAD_REQUEST');
      expect(ErrorCodes.INVALID_INPUT).toBe('INVALID_INPUT');
      expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ErrorCodes.INVALID_QUERY_PARAM).toBe('INVALID_QUERY_PARAM');
      expect(ErrorCodes.INVALID_BODY).toBe('INVALID_BODY');
    });

    it('should define all not found error codes', () => {
      expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
      expect(ErrorCodes.DEVICE_NOT_FOUND).toBe('DEVICE_NOT_FOUND');
      expect(ErrorCodes.READING_NOT_FOUND).toBe('READING_NOT_FOUND');
      expect(ErrorCodes.ROUTE_NOT_FOUND).toBe('ROUTE_NOT_FOUND');
    });

    it('should define all conflict error codes', () => {
      expect(ErrorCodes.CONFLICT).toBe('CONFLICT');
      expect(ErrorCodes.DUPLICATE_RESOURCE).toBe('DUPLICATE_RESOURCE');
      expect(ErrorCodes.SERIAL_NUMBER_EXISTS).toBe('SERIAL_NUMBER_EXISTS');
    });

    it('should define all server error codes', () => {
      expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
      expect(ErrorCodes.DATABASE_ERROR).toBe('DATABASE_ERROR');
      expect(ErrorCodes.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
    });
  });

  // ==========================================================================
  // ErrorCodeRegistry
  // ==========================================================================

  describe('ErrorCodeRegistry', () => {
    it('should have entries for all ErrorCodes', () => {
      const errorCodeValues = Object.values(ErrorCodes);

      for (const code of errorCodeValues) {
        expect(ErrorCodeRegistry[code as ErrorCode]).toBeDefined();
        expect(ErrorCodeRegistry[code as ErrorCode].code).toBe(code);
        expect(typeof ErrorCodeRegistry[code as ErrorCode].statusCode).toBe('number');
        expect(typeof ErrorCodeRegistry[code as ErrorCode].description).toBe('string');
      }
    });

    it('should map authentication errors to 401/403', () => {
      expect(ErrorCodeRegistry[ErrorCodes.UNAUTHORIZED].statusCode).toBe(401);
      expect(ErrorCodeRegistry[ErrorCodes.FORBIDDEN].statusCode).toBe(403);
      expect(ErrorCodeRegistry[ErrorCodes.INVALID_TOKEN].statusCode).toBe(401);
    });

    it('should map validation errors to 400', () => {
      expect(ErrorCodeRegistry[ErrorCodes.BAD_REQUEST].statusCode).toBe(400);
      expect(ErrorCodeRegistry[ErrorCodes.VALIDATION_ERROR].statusCode).toBe(400);
      expect(ErrorCodeRegistry[ErrorCodes.INVALID_QUERY_PARAM].statusCode).toBe(400);
    });

    it('should map not found errors to 404', () => {
      expect(ErrorCodeRegistry[ErrorCodes.NOT_FOUND].statusCode).toBe(404);
      expect(ErrorCodeRegistry[ErrorCodes.DEVICE_NOT_FOUND].statusCode).toBe(404);
      expect(ErrorCodeRegistry[ErrorCodes.ROUTE_NOT_FOUND].statusCode).toBe(404);
    });

    it('should map conflict errors to 409', () => {
      expect(ErrorCodeRegistry[ErrorCodes.CONFLICT].statusCode).toBe(409);
      expect(ErrorCodeRegistry[ErrorCodes.DUPLICATE_RESOURCE].statusCode).toBe(409);
    });

    it('should map rate limit errors to 429', () => {
      expect(ErrorCodeRegistry[ErrorCodes.RATE_LIMIT_EXCEEDED].statusCode).toBe(429);
      expect(ErrorCodeRegistry[ErrorCodes.TOO_MANY_REQUESTS].statusCode).toBe(429);
    });

    it('should map server errors to 5xx', () => {
      expect(ErrorCodeRegistry[ErrorCodes.INTERNAL_ERROR].statusCode).toBe(500);
      expect(ErrorCodeRegistry[ErrorCodes.DATABASE_ERROR].statusCode).toBe(500);
      expect(ErrorCodeRegistry[ErrorCodes.SERVICE_UNAVAILABLE].statusCode).toBe(503);
      expect(ErrorCodeRegistry[ErrorCodes.GATEWAY_TIMEOUT].statusCode).toBe(504);
    });
  });

  // ==========================================================================
  // getStatusCodeForError()
  // ==========================================================================

  describe('getStatusCodeForError()', () => {
    it('should return correct status code for known error', () => {
      expect(getStatusCodeForError(ErrorCodes.NOT_FOUND)).toBe(404);
      expect(getStatusCodeForError(ErrorCodes.BAD_REQUEST)).toBe(400);
      expect(getStatusCodeForError(ErrorCodes.INTERNAL_ERROR)).toBe(500);
    });

    it('should return 500 for unknown error code', () => {
      // Type assertion needed for testing edge case
      expect(getStatusCodeForError('UNKNOWN_CODE' as ErrorCode)).toBe(500);
    });
  });

  // ==========================================================================
  // getErrorDescription()
  // ==========================================================================

  describe('getErrorDescription()', () => {
    it('should return description for known error', () => {
      const description = getErrorDescription(ErrorCodes.DEVICE_NOT_FOUND);

      expect(description).toContain('device');
      expect(description).toContain('not found');
    });

    it('should return generic message for unknown error', () => {
      const description = getErrorDescription('UNKNOWN_CODE' as ErrorCode);

      expect(description).toBe('An error occurred');
    });
  });

  // ==========================================================================
  // isValidErrorCode()
  // ==========================================================================

  describe('isValidErrorCode()', () => {
    it('should return true for valid error codes', () => {
      expect(isValidErrorCode('NOT_FOUND')).toBe(true);
      expect(isValidErrorCode('BAD_REQUEST')).toBe(true);
      expect(isValidErrorCode('INTERNAL_ERROR')).toBe(true);
    });

    it('should return false for invalid error codes', () => {
      expect(isValidErrorCode('INVALID_CODE')).toBe(false);
      expect(isValidErrorCode('random_string')).toBe(false);
      expect(isValidErrorCode('')).toBe(false);
    });
  });

  // ==========================================================================
  // getErrorCodesForStatus()
  // ==========================================================================

  describe('getErrorCodesForStatus()', () => {
    it('should return all error codes for status 400', () => {
      const codes = getErrorCodesForStatus(400);

      expect(codes).toContain(ErrorCodes.BAD_REQUEST);
      expect(codes).toContain(ErrorCodes.VALIDATION_ERROR);
      expect(codes).toContain(ErrorCodes.INVALID_QUERY_PARAM);
      expect(codes.length).toBeGreaterThan(5);
    });

    it('should return all error codes for status 404', () => {
      const codes = getErrorCodesForStatus(404);

      expect(codes).toContain(ErrorCodes.NOT_FOUND);
      expect(codes).toContain(ErrorCodes.DEVICE_NOT_FOUND);
      expect(codes).toContain(ErrorCodes.ROUTE_NOT_FOUND);
    });

    it('should return all error codes for status 500', () => {
      const codes = getErrorCodesForStatus(500);

      expect(codes).toContain(ErrorCodes.INTERNAL_ERROR);
      expect(codes).toContain(ErrorCodes.DATABASE_ERROR);
    });

    it('should return empty array for unused status code', () => {
      const codes = getErrorCodesForStatus(418); // I'm a teapot

      expect(codes).toHaveLength(0);
    });

    it('should return codes for status 401', () => {
      const codes = getErrorCodesForStatus(401);

      expect(codes).toContain(ErrorCodes.UNAUTHORIZED);
      expect(codes).toContain(ErrorCodes.INVALID_TOKEN);
      expect(codes).toContain(ErrorCodes.TOKEN_EXPIRED);
    });

    it('should return codes for status 403', () => {
      const codes = getErrorCodesForStatus(403);

      expect(codes).toContain(ErrorCodes.FORBIDDEN);
      expect(codes).toContain(ErrorCodes.INSUFFICIENT_PERMISSIONS);
    });

    it('should return codes for status 409', () => {
      const codes = getErrorCodesForStatus(409);

      expect(codes).toContain(ErrorCodes.CONFLICT);
      expect(codes).toContain(ErrorCodes.DUPLICATE_RESOURCE);
    });

    it('should return codes for status 429', () => {
      const codes = getErrorCodesForStatus(429);

      expect(codes).toContain(ErrorCodes.RATE_LIMIT_EXCEEDED);
      expect(codes).toContain(ErrorCodes.TOO_MANY_REQUESTS);
    });
  });
});
