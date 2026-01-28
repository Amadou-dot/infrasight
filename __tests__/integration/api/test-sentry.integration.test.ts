/**
 * Test Sentry API Integration Tests
 *
 * Integration tests for /api/v2/test-sentry endpoint.
 */

import { GET, POST } from '@/app/api/v2/test-sentry/route';

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

/**
 * Helper to set NODE_ENV for testing
 */
function setNodeEnv(env: string) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value: env,
    writable: true,
    configurable: true,
  });
}

describe('/api/v2/test-sentry Integration Tests', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    // Restore NODE_ENV
    setNodeEnv(originalEnv || 'test');
  });

  // ==========================================================================
  // PRODUCTION MODE TESTS
  // ==========================================================================

  describe('Production Mode', () => {
    beforeEach(() => {
      setNodeEnv('production');
    });

    it('GET should return 404 in production', async () => {
      const response = await GET();
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Not available in production');
    });

    it('POST should return 404 in production', async () => {
      const response = await POST();
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Not available in production');
    });
  });

  // ==========================================================================
  // DEVELOPMENT MODE TESTS
  // ==========================================================================

  describe('Development Mode', () => {
    beforeEach(() => {
      setNodeEnv('development');
    });

    it('GET should return 500 error in development', async () => {
      const response = await GET();
      const data = await parseResponse<{
        success: boolean;
        error: { code: string };
      }>(response);

      // The error is caught by withErrorHandler and returned as 500
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });

    it('POST should return 500 error in development', async () => {
      const response = await POST();
      const data = await parseResponse<{
        success: boolean;
        error: { code: string };
      }>(response);

      // The error is caught by withErrorHandler and returned as 500
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ==========================================================================
  // TEST MODE TESTS
  // ==========================================================================

  describe('Test Mode', () => {
    beforeEach(() => {
      setNodeEnv('test');
    });

    it('GET should return 500 error in test mode', async () => {
      const response = await GET();
      const data = await parseResponse<{
        success: boolean;
        error: { code: string };
      }>(response);

      // Test mode is not production, so it should throw and return 500
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });

    it('POST should return 500 error in test mode', async () => {
      const response = await POST();
      const data = await parseResponse<{
        success: boolean;
        error: { code: string };
      }>(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
