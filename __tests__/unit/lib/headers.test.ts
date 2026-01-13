/**
 * Header Validation Middleware Tests
 *
 * Tests for request header validation.
 */

import { validateHeaders, extractRequestMetadata } from '@/lib/middleware/headers';
import { ApiError } from '@/lib/errors/ApiError';

describe('Header Validation Middleware', () => {
  // ==========================================================================
  // validateHeaders()
  // ==========================================================================

  describe('validateHeaders()', () => {
    const createMockRequest = (method: string, headers: Record<string, string> = {}): Request => {
      const h = new Headers();
      for (const [key, value] of Object.entries(headers)) h.set(key, value);

      return { method, headers: h } as Request;
    };

    describe('Content-Type validation', () => {
      it('should pass when Content-Type is application/json for POST', () => {
        const request = createMockRequest('POST', {
          'content-type': 'application/json',
        });

        expect(() => validateHeaders(request)).not.toThrow();
      });

      it('should pass when Content-Type is application/json for PUT', () => {
        const request = createMockRequest('PUT', {
          'content-type': 'application/json',
        });

        expect(() => validateHeaders(request)).not.toThrow();
      });

      it('should pass when Content-Type is application/json for PATCH', () => {
        const request = createMockRequest('PATCH', {
          'content-type': 'application/json',
        });

        expect(() => validateHeaders(request)).not.toThrow();
      });

      it('should pass when Content-Type has charset parameter', () => {
        const request = createMockRequest('POST', {
          'content-type': 'application/json; charset=utf-8',
        });

        expect(() => validateHeaders(request)).not.toThrow();
      });

      it('should pass for GET requests without Content-Type', () => {
        const request = createMockRequest('GET', {});

        expect(() => validateHeaders(request)).not.toThrow();
      });

      it('should pass for DELETE requests without Content-Type', () => {
        const request = createMockRequest('DELETE', {});

        expect(() => validateHeaders(request)).not.toThrow();
      });

      it('should throw ApiError for POST without Content-Type', () => {
        const request = createMockRequest('POST', {});

        expect(() => validateHeaders(request)).toThrow(ApiError);

        try {
          validateHeaders(request);
        } catch (error) {
          const apiError = error as ApiError;
          expect(apiError.statusCode).toBe(400);
          expect(apiError.message).toContain('Content-Type header is required');
        }
      });

      it('should throw ApiError for unsupported Content-Type', () => {
        const request = createMockRequest('POST', {
          'content-type': 'text/plain',
        });

        expect(() => validateHeaders(request)).toThrow(ApiError);

        try {
          validateHeaders(request);
        } catch (error) {
          const apiError = error as ApiError;
          expect(apiError.statusCode).toBe(415);
          expect(apiError.message).toContain('Unsupported Content-Type');
        }
      });

      it('should allow custom Content-Types via options', () => {
        const request = createMockRequest('POST', {
          'content-type': 'text/xml',
        });

        expect(() =>
          validateHeaders(request, {
            allowedContentTypes: ['application/json', 'text/xml'],
          })
        ).not.toThrow();
      });

      it('should skip Content-Type validation when disabled', () => {
        const request = createMockRequest('POST', {});

        expect(() => validateHeaders(request, { requireContentType: false })).not.toThrow();
      });

      it('should handle case-insensitive Content-Type', () => {
        const request = createMockRequest('POST', {
          'content-type': 'APPLICATION/JSON',
        });

        expect(() => validateHeaders(request)).not.toThrow();
      });

      it('should handle lowercase method names', () => {
        const request = createMockRequest('post', {
          'content-type': 'application/json',
        });

        expect(() => validateHeaders(request)).not.toThrow();
      });
    });

    describe('Required headers validation', () => {
      it('should pass when all required headers are present', () => {
        const request = createMockRequest('GET', {
          'x-api-key': 'test-key',
          'x-tenant-id': 'tenant-123',
        });

        expect(() =>
          validateHeaders(request, {
            requiredHeaders: ['x-api-key', 'x-tenant-id'],
          })
        ).not.toThrow();
      });

      it('should throw ApiError when required header is missing', () => {
        const request = createMockRequest('GET', {
          'x-api-key': 'test-key',
        });

        expect(() =>
          validateHeaders(request, {
            requiredHeaders: ['x-api-key', 'x-tenant-id'],
          })
        ).toThrow(ApiError);

        try {
          validateHeaders(request, {
            requiredHeaders: ['x-api-key', 'x-tenant-id'],
          });
        } catch (error) {
          const apiError = error as ApiError;
          expect(apiError.statusCode).toBe(400);
          expect(apiError.message).toContain('Missing required header: x-tenant-id');
        }
      });

      it('should pass with no required headers specified', () => {
        const request = createMockRequest('GET', {});

        expect(() => validateHeaders(request, {})).not.toThrow();
      });
    });

    describe('Combined validation', () => {
      it('should validate both Content-Type and required headers', () => {
        const request = createMockRequest('POST', {
          'content-type': 'application/json',
          'x-api-key': 'test-key',
        });

        expect(() =>
          validateHeaders(request, {
            requireContentType: true,
            requiredHeaders: ['x-api-key'],
          })
        ).not.toThrow();
      });

      it('should fail if either validation fails', () => {
        const request = createMockRequest('POST', {
          'content-type': 'application/json',
          // Missing x-api-key
        });

        expect(() =>
          validateHeaders(request, {
            requiredHeaders: ['x-api-key'],
          })
        ).toThrow(ApiError);
      });
    });
  });

  // ==========================================================================
  // extractRequestMetadata()
  // ==========================================================================

  describe('extractRequestMetadata()', () => {
    const createMockRequest = (headers: Record<string, string>): Request => {
      const h = new Headers();
      for (const [key, value] of Object.entries(headers)) h.set(key, value);

      return { headers: h } as Request;
    };

    it('should extract all metadata when present', () => {
      const request = createMockRequest({
        'user-agent': 'Mozilla/5.0',
        'accept-language': 'en-US,en;q=0.9',
        origin: 'https://example.com',
        referer: 'https://example.com/page',
      });

      const metadata = extractRequestMetadata(request);

      expect(metadata).toEqual({
        userAgent: 'Mozilla/5.0',
        acceptLanguage: 'en-US,en;q=0.9',
        origin: 'https://example.com',
        referer: 'https://example.com/page',
      });
    });

    it('should return null for missing headers', () => {
      const request = createMockRequest({});

      const metadata = extractRequestMetadata(request);

      expect(metadata).toEqual({
        userAgent: null,
        acceptLanguage: null,
        origin: null,
        referer: null,
      });
    });

    it('should handle partial metadata', () => {
      const request = createMockRequest({
        'user-agent': 'curl/7.64.1',
      });

      const metadata = extractRequestMetadata(request);

      expect(metadata.userAgent).toBe('curl/7.64.1');
      expect(metadata.acceptLanguage).toBeNull();
      expect(metadata.origin).toBeNull();
      expect(metadata.referer).toBeNull();
    });
  });
});
