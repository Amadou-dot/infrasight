/**
 * Metrics API Integration Tests
 *
 * Integration tests for GET /api/v2/metrics endpoint.
 */

import { GET } from '@/app/api/v2/metrics/route';

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('GET /api/v2/metrics Integration Tests', () => {
  const originalEnv = process.env;

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
  });

  // ==========================================================================
  // METRICS DISABLED TESTS
  // ==========================================================================

  describe('When Metrics are Disabled', () => {
    beforeEach(() => {
      process.env.ENABLE_METRICS = 'false';
    });

    it('should return 404 when metrics are disabled', async () => {
      const request = new Request('http://localhost:3000/api/v2/metrics');
      const response = await GET(request);

      expect(response.status).toBe(404);
    });

    it('should return error message when metrics are disabled', async () => {
      const request = new Request('http://localhost:3000/api/v2/metrics');
      const response = await GET(request);
      const data = await parseResponse<{ error: string }>(response);

      expect(data.error).toContain('Metrics are disabled');
      expect(data.error).toContain('ENABLE_METRICS=true');
    });
  });

  // ==========================================================================
  // METRICS ENABLED TESTS
  // ==========================================================================

  describe('When Metrics are Enabled', () => {
    beforeEach(() => {
      process.env.ENABLE_METRICS = 'true';
    });

    describe('Prometheus Format (Default)', () => {
      it('should return Prometheus-compatible metrics', async () => {
        const request = new Request('http://localhost:3000/api/v2/metrics');
        const response = await GET(request);

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('text/plain');
      });

      it('should include metric type declarations', async () => {
        const request = new Request('http://localhost:3000/api/v2/metrics');
        const response = await GET(request);
        const text = await response.text();

        expect(text).toContain('# HELP');
        expect(text).toContain('# TYPE');
      });
    });

    describe('JSON Format', () => {
      it('should return JSON when format=json is specified', async () => {
        const request = new Request('http://localhost:3000/api/v2/metrics?format=json');
        const response = await GET(request);
        const data = await parseResponse<Record<string, unknown>>(response);

        expect(response.status).toBe(200);
        expect(data).toBeDefined();
        expect(typeof data).toBe('object');
      });

      it('should include metrics snapshot structure in JSON format', async () => {
        const request = new Request('http://localhost:3000/api/v2/metrics?format=json');
        const response = await GET(request);
        const data = await parseResponse<Record<string, unknown>>(response);

        expect(data).toHaveProperty('requests');
        expect(data).toHaveProperty('errors');
        expect(data).toHaveProperty('cache');
        expect(data).toHaveProperty('timestamp');
      });
    });
  });
});
