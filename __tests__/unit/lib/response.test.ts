/**
 * Response Utilities Unit Tests
 *
 * Tests for standardized API response formatters.
 */

import {
  successResponse,
  jsonSuccess,
  errorResponse,
  jsonError,
  simpleErrorResponse,
  jsonSimpleError,
  paginatedResponse,
  jsonPaginated,
  listResponse,
  jsonList,
  createdResponse,
  noContentResponse,
  acceptedResponse,
  isSuccessResponse,
  isErrorResponse,
  isPaginatedResponse,
  type PaginationInfo,
  type SuccessResponse,
  type PaginatedResponse,
  type ErrorResponse,
} from '@/lib/api/response';
import { ApiError } from '@/lib/errors/ApiError';

describe('Response Utilities', () => {
  // Sample test data
  const testDevice = {
    _id: 'device_001',
    serial_number: 'SN-001',
    status: 'active',
  };

  const testDevices = [
    { _id: 'device_001', serial_number: 'SN-001' },
    { _id: 'device_002', serial_number: 'SN-002' },
  ];

  const testPagination: PaginationInfo = {
    total: 100,
    page: 1,
    limit: 20,
    totalPages: 5,
    hasNext: true,
    hasPrevious: false,
  };

  // ==========================================================================
  // successResponse()
  // ==========================================================================

  describe('successResponse()', () => {
    it('should create a success response with data', () => {
      const response = successResponse(testDevice);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(testDevice);
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include message when provided', () => {
      const message = 'Device created successfully';
      const response = successResponse(testDevice, message);

      expect(response.success).toBe(true);
      expect(response.message).toBe(message);
      expect(response.data).toEqual(testDevice);
    });

    it('should not include message field when not provided', () => {
      const response = successResponse(testDevice);

      expect(response).not.toHaveProperty('message');
    });

    it('should accept any data type', () => {
      const stringResponse = successResponse('test string');
      const numberResponse = successResponse(123);
      const arrayResponse = successResponse([1, 2, 3]);
      const nullResponse = successResponse(null);

      expect(stringResponse.data).toBe('test string');
      expect(numberResponse.data).toBe(123);
      expect(arrayResponse.data).toEqual([1, 2, 3]);
      expect(nullResponse.data).toBeNull();
    });

    it('should include valid ISO timestamp', () => {
      const response = successResponse(testDevice);
      const timestamp = new Date(response.timestamp);

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.toISOString()).toBe(response.timestamp);
    });
  });

  // ==========================================================================
  // jsonSuccess()
  // ==========================================================================

  describe('jsonSuccess()', () => {
    it('should create a Response object with default 200 status', async () => {
      const response = jsonSuccess(testDevice);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual(testDevice);
    });

    it('should accept custom status code', async () => {
      const response = jsonSuccess(testDevice, undefined, 201);

      expect(response.status).toBe(201);
    });

    it('should include message in response body', async () => {
      const message = 'Operation successful';
      const response = jsonSuccess(testDevice, message);
      const body = await response.json();

      expect(body.message).toBe(message);
    });

    it('should set Content-Type to application/json', () => {
      const response = jsonSuccess(testDevice);

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });
  });

  // ==========================================================================
  // errorResponse()
  // ==========================================================================

  describe('errorResponse()', () => {
    it('should create error response from ApiError', () => {
      const error = ApiError.notFound('Device', 'device_001');
      const response = errorResponse(error);

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('NOT_FOUND');
      expect(response.error.statusCode).toBe(404);
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include metadata when present', () => {
      const error = ApiError.validationError('Invalid input', {
        field: 'email',
      });
      const response = errorResponse(error);

      expect(response.error.metadata).toEqual({ field: 'email' });
    });

    it('should delegate to ApiError.toJSON()', () => {
      const error = ApiError.badRequest('Test error');
      const jsonResult = error.toJSON();
      const responseResult = errorResponse(error);

      expect(responseResult).toEqual(jsonResult);
    });
  });

  // ==========================================================================
  // jsonError()
  // ==========================================================================

  describe('jsonError()', () => {
    it('should create a Response object from ApiError', async () => {
      const error = ApiError.unauthorized('Invalid token');
      const response = jsonError(error);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should delegate to ApiError.toResponse()', () => {
      const error = ApiError.internalError();
      const responseResult = jsonError(error);
      const toResponseResult = error.toResponse();

      expect(responseResult.status).toBe(toResponseResult.status);
    });
  });

  // ==========================================================================
  // simpleErrorResponse()
  // ==========================================================================

  describe('simpleErrorResponse()', () => {
    it('should create simple error response', () => {
      const response = simpleErrorResponse('TEST_ERROR', 400, 'Test message');

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('TEST_ERROR');
      expect(response.error.statusCode).toBe(400);
      expect(response.error.message).toBe('Test message');
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should not include metadata', () => {
      const response = simpleErrorResponse('ERROR', 500, 'Message');

      expect(response.error).not.toHaveProperty('metadata');
    });

    it('should accept any valid HTTP status code', () => {
      const response404 = simpleErrorResponse('NOT_FOUND', 404, 'Not found');
      const response503 = simpleErrorResponse('UNAVAILABLE', 503, 'Unavailable');

      expect(response404.error.statusCode).toBe(404);
      expect(response503.error.statusCode).toBe(503);
    });
  });

  // ==========================================================================
  // jsonSimpleError()
  // ==========================================================================

  describe('jsonSimpleError()', () => {
    it('should create Response object from simple error', async () => {
      const response = jsonSimpleError('ERROR', 400, 'Bad request');

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ERROR');
      expect(body.error.message).toBe('Bad request');
    });

    it('should use statusCode for Response status', async () => {
      const response = jsonSimpleError('FORBIDDEN', 403, 'Access denied');

      expect(response.status).toBe(403);
    });
  });

  // ==========================================================================
  // paginatedResponse()
  // ==========================================================================

  describe('paginatedResponse()', () => {
    it('should create paginated response', () => {
      const response = paginatedResponse(testDevices, testPagination);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(testDevices);
      expect(response.pagination).toEqual(testPagination);
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include all pagination fields', () => {
      const response = paginatedResponse(testDevices, testPagination);

      expect(response.pagination.total).toBe(100);
      expect(response.pagination.page).toBe(1);
      expect(response.pagination.limit).toBe(20);
      expect(response.pagination.totalPages).toBe(5);
      expect(response.pagination.hasNext).toBe(true);
      expect(response.pagination.hasPrevious).toBe(false);
    });

    it('should handle empty data array', () => {
      const response = paginatedResponse([], {
        ...testPagination,
        total: 0,
        totalPages: 1,
        hasNext: false,
      });

      expect(response.data).toEqual([]);
      expect(response.pagination.total).toBe(0);
    });

    it('should include cursor fields when present', () => {
      const paginationWithCursors: PaginationInfo = {
        ...testPagination,
        nextCursor: 'next_abc123',
        prevCursor: 'prev_xyz789',
      };

      const response = paginatedResponse(testDevices, paginationWithCursors);

      expect(response.pagination.nextCursor).toBe('next_abc123');
      expect(response.pagination.prevCursor).toBe('prev_xyz789');
    });
  });

  // ==========================================================================
  // jsonPaginated()
  // ==========================================================================

  describe('jsonPaginated()', () => {
    it('should create Response object with pagination', async () => {
      const response = jsonPaginated(testDevices, testPagination);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual(testDevices);
      expect(body.pagination).toEqual(testPagination);
    });

    it('should accept custom status code', async () => {
      const response = jsonPaginated(testDevices, testPagination, 206);

      expect(response.status).toBe(206);
    });
  });

  // ==========================================================================
  // listResponse()
  // ==========================================================================

  describe('listResponse()', () => {
    it('should create list response with total', () => {
      const response = listResponse(testDevices, 100);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(testDevices);
      expect(response.total).toBe(100);
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include pagination when provided', () => {
      const response = listResponse(testDevices, 100, testPagination);

      expect(response.pagination).toEqual(testPagination);
    });

    it('should not include pagination field when not provided', () => {
      const response = listResponse(testDevices, 50);

      expect(response).not.toHaveProperty('pagination');
    });

    it('should handle total of 0', () => {
      const response = listResponse([], 0);

      expect(response.data).toEqual([]);
      expect(response.total).toBe(0);
    });
  });

  // ==========================================================================
  // jsonList()
  // ==========================================================================

  describe('jsonList()', () => {
    it('should create Response object with list', async () => {
      const response = jsonList(testDevices, 100);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual(testDevices);
      expect(body.total).toBe(100);
    });

    it('should accept custom status code', async () => {
      const response = jsonList(testDevices, 100, undefined, 206);

      expect(response.status).toBe(206);
    });

    it('should include pagination when provided', async () => {
      const response = jsonList(testDevices, 100, testPagination);
      const body = await response.json();

      expect(body.pagination).toEqual(testPagination);
    });
  });

  // ==========================================================================
  // createdResponse()
  // ==========================================================================

  describe('createdResponse()', () => {
    it('should create 201 Created response', async () => {
      const response = createdResponse(testDevice);

      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual(testDevice);
      expect(body.message).toBe('Resource created successfully');
    });

    it('should accept custom message', async () => {
      const customMessage = 'Device created';
      const response = createdResponse(testDevice, customMessage);
      const body = await response.json();

      expect(body.message).toBe(customMessage);
    });
  });

  // ==========================================================================
  // noContentResponse()
  // ==========================================================================

  describe('noContentResponse()', () => {
    it('should create 204 No Content response', async () => {
      const response = noContentResponse();

      expect(response.status).toBe(204);

      // 204 responses should have no body
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should return Response instance', () => {
      const response = noContentResponse();

      expect(response).toBeInstanceOf(Response);
    });
  });

  // ==========================================================================
  // acceptedResponse()
  // ==========================================================================

  describe('acceptedResponse()', () => {
    it('should create 202 Accepted response', async () => {
      const response = acceptedResponse({ jobId: 'job_123' });

      expect(response.status).toBe(202);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ jobId: 'job_123' });
      expect(body.message).toBe('Request accepted for processing');
    });

    it('should accept custom message', async () => {
      const customMessage = 'Async job started';
      const response = acceptedResponse({ jobId: 'job_456' }, customMessage);
      const body = await response.json();

      expect(body.message).toBe(customMessage);
    });
  });

  // ==========================================================================
  // TYPE GUARDS
  // ==========================================================================

  describe('isSuccessResponse()', () => {
    it('should return true for success response', () => {
      const response = successResponse(testDevice);

      expect(isSuccessResponse(response)).toBe(true);
    });

    it('should return true for paginated response', () => {
      const response = paginatedResponse(testDevices, testPagination);

      expect(isSuccessResponse(response)).toBe(true);
    });

    it('should return false for error response', () => {
      const error = ApiError.notFound('Device');
      const response = errorResponse(error);

      expect(isSuccessResponse(response)).toBe(false);
    });
  });

  describe('isErrorResponse()', () => {
    it('should return true for error response', () => {
      const error = ApiError.badRequest('Invalid');
      const response = errorResponse(error);

      expect(isErrorResponse(response)).toBe(true);
    });

    it('should return false for success response', () => {
      const response = successResponse(testDevice);

      expect(isErrorResponse(response)).toBe(false);
    });

    it('should return false for paginated response', () => {
      const response = paginatedResponse(testDevices, testPagination);

      expect(isErrorResponse(response)).toBe(false);
    });
  });

  describe('isPaginatedResponse()', () => {
    it('should return true for paginated response', () => {
      const response = paginatedResponse(testDevices, testPagination);

      expect(isPaginatedResponse(response)).toBe(true);
    });

    it('should return false for regular success response', () => {
      const response = successResponse(testDevice);

      expect(isPaginatedResponse(response)).toBe(false);
    });

    it('should return false for error response', () => {
      const error = ApiError.notFound('Device');
      const response = errorResponse(error);

      expect(isPaginatedResponse(response)).toBe(false);
    });

    it('should return false for list response without pagination', () => {
      const response = listResponse(testDevices, 100);

      expect(isPaginatedResponse(response)).toBe(false);
    });

    it('should return true for list response with pagination', () => {
      const response = listResponse(testDevices, 100, testPagination);

      expect(isPaginatedResponse(response)).toBe(true);
    });
  });

  // ==========================================================================
  // TYPE INFERENCE TESTS
  // ==========================================================================

  describe('Type Guards - TypeScript Type Narrowing', () => {
    it('should narrow types correctly with isSuccessResponse', () => {
      const response: SuccessResponse<typeof testDevice> | ErrorResponse =
        successResponse(testDevice);

      if (isSuccessResponse(response))
        // TypeScript should know this is SuccessResponse
        expect(response.data).toBeDefined();
    });

    it('should narrow types correctly with isErrorResponse', () => {
      const error = ApiError.notFound('Device');
      const response: SuccessResponse<unknown> | ErrorResponse = errorResponse(error);

      if (isErrorResponse(response))
        // TypeScript should know this is ErrorResponse
        expect(response.error).toBeDefined();
    });

    it('should narrow types correctly with isPaginatedResponse', () => {
      const response:
        | SuccessResponse<typeof testDevices>
        | PaginatedResponse<(typeof testDevices)[number]> = paginatedResponse(
        testDevices,
        testPagination
      );

      if (isPaginatedResponse(response))
        // TypeScript should know this is PaginatedResponse
        expect(response.pagination).toBeDefined();
    });
  });
});
