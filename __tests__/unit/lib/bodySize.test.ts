/**
 * Body Size Middleware Tests
 *
 * Tests for request body size validation and limits.
 */

import {
  getMaxBodySize,
  validateBodySize,
  DEFAULT_BODY_SIZE_CONFIG,
} from '@/lib/middleware/bodySize';
import { ApiError } from '@/lib/errors/ApiError';

describe('Body Size Middleware', () => {
  // ==========================================================================
  // DEFAULT_BODY_SIZE_CONFIG
  // ==========================================================================

  describe('DEFAULT_BODY_SIZE_CONFIG', () => {
    it('should define default body size limit as 1MB', () => {
      expect(DEFAULT_BODY_SIZE_CONFIG.default).toBe(1 * 1024 * 1024);
    });

    it('should define bulk body size limit as 10MB', () => {
      expect(DEFAULT_BODY_SIZE_CONFIG.bulk).toBe(10 * 1024 * 1024);
    });
  });

  // ==========================================================================
  // getMaxBodySize()
  // ==========================================================================

  describe('getMaxBodySize()', () => {
    it('should return default size for regular endpoints', () => {
      const paths = [
        '/api/v2/devices',
        '/api/v2/devices/device_001',
        '/api/v2/readings',
        '/api/v2/analytics/health',
      ];

      for (const path of paths) {
        expect(getMaxBodySize(path)).toBe(DEFAULT_BODY_SIZE_CONFIG.default);
      }
    });

    it('should return bulk size for readings ingest endpoint', () => {
      const result = getMaxBodySize('/api/v2/readings/ingest');

      expect(result).toBe(DEFAULT_BODY_SIZE_CONFIG.bulk);
    });

    it('should return bulk size for readings ingest with query params', () => {
      // startsWith check should handle query params
      const result = getMaxBodySize('/api/v2/readings/ingest?format=json');

      expect(result).toBe(DEFAULT_BODY_SIZE_CONFIG.bulk);
    });

    it('should use custom config when provided', () => {
      const customConfig = {
        default: 500 * 1024, // 500KB
        bulk: 5 * 1024 * 1024, // 5MB
      };

      expect(getMaxBodySize('/api/v2/devices', customConfig)).toBe(500 * 1024);
      expect(getMaxBodySize('/api/v2/readings/ingest', customConfig)).toBe(5 * 1024 * 1024);
    });
  });

  // ==========================================================================
  // validateBodySize()
  // ==========================================================================

  describe('validateBodySize()', () => {
    const createMockRequest = (contentLength: string | null): Request => {
      const headers = new Headers();
      if (contentLength !== null) {
        headers.set('content-length', contentLength);
      }
      return {
        headers,
      } as unknown as Request;
    };

    it('should pass validation when no content-length header', async () => {
      const request = createMockRequest(null);

      await expect(
        validateBodySize(request, '/api/v2/devices')
      ).resolves.toBeUndefined();
    });

    it('should pass validation when body size is within limit', async () => {
      const request = createMockRequest('1024'); // 1KB

      await expect(
        validateBodySize(request, '/api/v2/devices')
      ).resolves.toBeUndefined();
    });

    it('should pass validation when body size equals limit', async () => {
      const limit = DEFAULT_BODY_SIZE_CONFIG.default.toString();
      const request = createMockRequest(limit);

      await expect(
        validateBodySize(request, '/api/v2/devices')
      ).resolves.toBeUndefined();
    });

    it('should throw ApiError when body exceeds default limit', async () => {
      const overLimit = (DEFAULT_BODY_SIZE_CONFIG.default + 1).toString();
      const request = createMockRequest(overLimit);

      await expect(
        validateBodySize(request, '/api/v2/devices')
      ).rejects.toThrow(ApiError);

      try {
        await validateBodySize(request, '/api/v2/devices');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.statusCode).toBe(413);
        expect(apiError.message).toContain('Request body too large');
        expect(apiError.message).toContain('1.0MB');
      }
    });

    it('should throw ApiError when body exceeds bulk limit', async () => {
      const overLimit = (DEFAULT_BODY_SIZE_CONFIG.bulk + 1).toString();
      const request = createMockRequest(overLimit);

      await expect(
        validateBodySize(request, '/api/v2/readings/ingest')
      ).rejects.toThrow(ApiError);

      try {
        await validateBodySize(request, '/api/v2/readings/ingest');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.statusCode).toBe(413);
        expect(apiError.message).toContain('10.0MB');
      }
    });

    it('should throw ApiError for invalid content-length header', async () => {
      const request = createMockRequest('not-a-number');

      await expect(
        validateBodySize(request, '/api/v2/devices')
      ).rejects.toThrow(ApiError);

      try {
        await validateBodySize(request, '/api/v2/devices');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.statusCode).toBe(400);
        expect(apiError.message).toContain('Invalid Content-Length header');
      }
    });

    it('should allow large body for bulk endpoint', async () => {
      // 5MB is under the 10MB bulk limit
      const request = createMockRequest((5 * 1024 * 1024).toString());

      await expect(
        validateBodySize(request, '/api/v2/readings/ingest')
      ).resolves.toBeUndefined();
    });

    it('should reject same size for regular endpoint', async () => {
      // 5MB is over the 1MB regular limit
      const request = createMockRequest((5 * 1024 * 1024).toString());

      await expect(
        validateBodySize(request, '/api/v2/devices')
      ).rejects.toThrow(ApiError);
    });

    it('should use custom config when provided', async () => {
      const customConfig = {
        default: 100, // 100 bytes
        bulk: 1000, // 1000 bytes
      };
      const request = createMockRequest('500');

      // Should fail with custom config (500 > 100)
      await expect(
        validateBodySize(request, '/api/v2/devices', customConfig)
      ).rejects.toThrow(ApiError);

      // But should pass for bulk endpoint (500 < 1000)
      await expect(
        validateBodySize(request, '/api/v2/readings/ingest', customConfig)
      ).resolves.toBeUndefined();
    });

    it('should include detailed metadata in error', async () => {
      const request = createMockRequest((2 * 1024 * 1024).toString()); // 2MB

      try {
        await validateBodySize(request, '/api/v2/devices');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.metadata).toEqual(
          expect.objectContaining({
            received: '2.0MB',
            maximum: '1.0MB',
            receivedBytes: 2 * 1024 * 1024,
            maximumBytes: 1 * 1024 * 1024,
          })
        );
      }
    });
  });

  // ==========================================================================
  // formatBytes internal function (tested indirectly)
  // ==========================================================================

  describe('formatBytes (via error messages)', () => {
    const createMockRequest = (contentLength: string): Request => {
      const headers = new Headers();
      headers.set('content-length', contentLength);
      return { headers } as unknown as Request;
    };

    it('should format bytes correctly', async () => {
      // Test KB formatting
      const request = createMockRequest((2 * 1024 * 1024).toString());
      try {
        await validateBodySize(request, '/api/v2/devices');
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.metadata?.received).toBe('2.0MB');
      }
    });

    it('should format small sizes as KB', async () => {
      const customConfig = { default: 100, bulk: 100 };
      const request = createMockRequest((50 * 1024).toString()); // 50KB

      try {
        await validateBodySize(request, '/api/v2/devices', customConfig);
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.metadata?.received).toBe('50.0KB');
      }
    });
  });
});
