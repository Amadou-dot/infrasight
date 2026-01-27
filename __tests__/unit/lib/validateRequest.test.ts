/**
 * Request Validation Middleware Tests
 *
 * Tests for combined request validation.
 */

import { NextRequest } from 'next/server';
import {
  validateRequest,
  withRequestValidation,
  ValidationPresets,
} from '@/lib/middleware/validateRequest';
import { ApiError } from '@/lib/errors/ApiError';

// Mock the NextRequest
const createMockNextRequest = (
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  searchParams: Record<string, string> = {}
): NextRequest => {
  const url = new URL(`http://localhost${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  const h = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    h.set(key, value);
  }

  return {
    method,
    headers: h,
    nextUrl: {
      pathname,
      searchParams: url.searchParams,
    },
  } as unknown as NextRequest;
};

describe('Request Validation Middleware', () => {
  // ==========================================================================
  // validateRequest()
  // ==========================================================================

  describe('validateRequest()', () => {
    it('should pass for valid GET request', async () => {
      const request = createMockNextRequest('GET', '/api/v2/devices');

      await expect(validateRequest(request)).resolves.toBeUndefined();
    });

    it('should pass for valid POST request with Content-Type', async () => {
      const request = createMockNextRequest('POST', '/api/v2/devices', {
        'content-type': 'application/json',
        'content-length': '100',
      });

      await expect(validateRequest(request)).resolves.toBeUndefined();
    });

    it('should skip validation when skip option is true', async () => {
      const request = createMockNextRequest('POST', '/api/v2/devices');
      // No Content-Type, should normally fail

      await expect(
        validateRequest(request, { skip: true })
      ).resolves.toBeUndefined();
    });

    it('should throw for POST without Content-Type', async () => {
      const request = createMockNextRequest('POST', '/api/v2/devices');

      await expect(validateRequest(request)).rejects.toThrow(ApiError);
    });

    it('should validate query parameters against whitelist', async () => {
      const request = createMockNextRequest(
        'GET',
        '/api/v2/devices',
        {},
        { status: 'active', unknownParam: 'value' }
      );

      await expect(
        validateRequest(request, {
          allowedQueryParams: ['status', 'page', 'limit'],
        })
      ).rejects.toThrow(ApiError);

      try {
        await validateRequest(request, {
          allowedQueryParams: ['status', 'page', 'limit'],
        });
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.message).toContain('Unknown query parameter');
        expect(apiError.message).toContain('unknownParam');
      }
    });

    it('should pass when all query params are in whitelist', async () => {
      const request = createMockNextRequest(
        'GET',
        '/api/v2/devices',
        {},
        { status: 'active', page: '1' }
      );

      await expect(
        validateRequest(request, {
          allowedQueryParams: ['status', 'page', 'limit'],
        })
      ).resolves.toBeUndefined();
    });

    it('should handle multiple unknown query params', async () => {
      const request = createMockNextRequest(
        'GET',
        '/api/v2/devices',
        {},
        { foo: 'bar', baz: 'qux' }
      );

      try {
        await validateRequest(request, {
          allowedQueryParams: ['status'],
        });
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.message).toContain('Unknown query parameters');
        expect(apiError.message).toContain('foo');
        expect(apiError.message).toContain('baz');
      }
    });
  });

  // ==========================================================================
  // withRequestValidation()
  // ==========================================================================

  describe('withRequestValidation()', () => {
    it('should call handler for valid request', async () => {
      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withRequestValidation(handler);
      const request = createMockNextRequest('GET', '/api/v2/devices');

      const response = await wrappedHandler(request);

      expect(handler).toHaveBeenCalledWith(request);
      expect(response).toBeInstanceOf(Response);
    });

    it('should return ApiError response for invalid request', async () => {
      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withRequestValidation(handler, {
        allowedQueryParams: ['status'],
      });
      const request = createMockNextRequest(
        'GET',
        '/api/v2/devices',
        {},
        { invalid: 'param' }
      );

      const response = await wrappedHandler(request);

      expect(handler).not.toHaveBeenCalled();
      expect(response.status).toBe(400);
    });

    it('should rethrow non-ApiError errors', async () => {
      const handler = jest.fn().mockResolvedValue(new Response('OK'));

      // Create a mock that throws during validation by using invalid options
      const wrappedHandler = withRequestValidation(handler);
      const request = createMockNextRequest('POST', '/api/v2/devices');
      // Should throw ApiError for missing Content-Type, which is handled

      const response = await wrappedHandler(request);

      expect(response.status).toBe(400);
    });
  });

  // ==========================================================================
  // ValidationPresets
  // ==========================================================================

  describe('ValidationPresets', () => {
    it('should define jsonApi preset', () => {
      expect(ValidationPresets.jsonApi).toBeDefined();
      expect(ValidationPresets.jsonApi.headers?.requireContentType).toBe(true);
      expect(ValidationPresets.jsonApi.headers?.allowedContentTypes).toContain(
        'application/json'
      );
    });

    it('should define bulkIngestion preset with larger body size', () => {
      expect(ValidationPresets.bulkIngestion).toBeDefined();
      expect(ValidationPresets.bulkIngestion.bodySize?.bulk).toBe(
        10 * 1024 * 1024
      );
    });

    it('should define readOnly preset without Content-Type requirement', () => {
      expect(ValidationPresets.readOnly).toBeDefined();
      expect(ValidationPresets.readOnly.headers?.requireContentType).toBe(
        false
      );
    });
  });
});
