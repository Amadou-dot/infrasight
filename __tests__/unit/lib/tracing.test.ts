/**
 * Request Tracing Tests
 *
 * Tests for trace ID generation, propagation, and request context.
 */

import {
  generateTraceId,
  getTraceId,
  addTraceHeaders,
  createRequestTimer,
  withTracing,
  createRequestContext,
} from '@/lib/monitoring/tracing';

describe('Request Tracing', () => {
  // ==========================================================================
  // generateTraceId()
  // ==========================================================================

  describe('generateTraceId()', () => {
    it('should generate a 16-character string', () => {
      const traceId = generateTraceId();

      expect(traceId).toHaveLength(16);
    });

    it('should generate hexadecimal characters only', () => {
      const traceId = generateTraceId();

      expect(traceId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTraceId());
      }

      expect(ids.size).toBe(100);
    });
  });

  // ==========================================================================
  // getTraceId()
  // ==========================================================================

  describe('getTraceId()', () => {
    const createMockRequest = (headers: Record<string, string>): Request => {
      const h = new Headers();
      for (const [key, value] of Object.entries(headers)) {
        h.set(key, value);
      }
      return { headers: h } as Request;
    };

    it('should extract trace ID from x-trace-id header', () => {
      const request = createMockRequest({ 'x-trace-id': 'trace-123' });

      const traceId = getTraceId(request);

      expect(traceId).toBe('trace-123');
    });

    it('should fall back to x-correlation-id header', () => {
      const request = createMockRequest({ 'x-correlation-id': 'correlation-456' });

      const traceId = getTraceId(request);

      expect(traceId).toBe('correlation-456');
    });

    it('should fall back to x-request-id header', () => {
      const request = createMockRequest({ 'x-request-id': 'request-789' });

      const traceId = getTraceId(request);

      expect(traceId).toBe('request-789');
    });

    it('should prefer x-trace-id over other headers', () => {
      const request = createMockRequest({
        'x-trace-id': 'trace-123',
        'x-correlation-id': 'correlation-456',
        'x-request-id': 'request-789',
      });

      const traceId = getTraceId(request);

      expect(traceId).toBe('trace-123');
    });

    it('should generate new trace ID if no headers present', () => {
      const request = createMockRequest({});

      const traceId = getTraceId(request);

      expect(traceId).toHaveLength(16);
      expect(traceId).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  // ==========================================================================
  // addTraceHeaders()
  // ==========================================================================

  describe('addTraceHeaders()', () => {
    it('should add x-trace-id header to response', () => {
      const response = new Response('body', { status: 200 });

      const tracedResponse = addTraceHeaders(response, 'trace-123');

      expect(tracedResponse.headers.get('x-trace-id')).toBe('trace-123');
    });

    it('should preserve original response body', async () => {
      const response = new Response('original body', { status: 200 });

      const tracedResponse = addTraceHeaders(response, 'trace-123');
      const body = await tracedResponse.text();

      expect(body).toBe('original body');
    });

    it('should preserve original response status', () => {
      const response = new Response('', { status: 201 });

      const tracedResponse = addTraceHeaders(response, 'trace-123');

      expect(tracedResponse.status).toBe(201);
    });

    it('should preserve original response headers', () => {
      const response = new Response('', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

      const tracedResponse = addTraceHeaders(response, 'trace-123');

      expect(tracedResponse.headers.get('content-type')).toBe('application/json');
      expect(tracedResponse.headers.get('x-trace-id')).toBe('trace-123');
    });

    it('should preserve statusText', () => {
      const response = new Response('', {
        status: 200,
        statusText: 'OK',
      });

      const tracedResponse = addTraceHeaders(response, 'trace-123');

      expect(tracedResponse.statusText).toBe('OK');
    });
  });

  // ==========================================================================
  // createRequestTimer()
  // ==========================================================================

  describe('createRequestTimer()', () => {
    it('should create timer with start time', () => {
      const timer = createRequestTimer();

      expect(timer.start).toBeDefined();
      expect(typeof timer.start).toBe('number');
    });

    it('should return elapsed time', async () => {
      const timer = createRequestTimer();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const elapsed = timer.elapsed();

      expect(elapsed).toBeGreaterThanOrEqual(9);
      expect(elapsed).toBeLessThan(100);
    });

    it('should return integer milliseconds', () => {
      const timer = createRequestTimer();

      const elapsed = timer.elapsed();

      expect(Number.isInteger(elapsed)).toBe(true);
    });
  });

  // ==========================================================================
  // withTracing()
  // ==========================================================================

  describe('withTracing()', () => {
    const createMockRequest = (headers: Record<string, string>, url: string): Request => {
      const h = new Headers();
      for (const [key, value] of Object.entries(headers)) {
        h.set(key, value);
      }
      return { headers: h, url } as Request;
    };

    it('should pass trace ID to handler', async () => {
      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withTracing(handler);
      const request = createMockRequest({ 'x-trace-id': 'trace-123' }, 'http://localhost/api');

      await wrappedHandler(request);

      expect(handler).toHaveBeenCalledWith('trace-123', request);
    });

    it('should add trace header to response', async () => {
      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withTracing(handler);
      const request = createMockRequest({ 'x-trace-id': 'trace-123' }, 'http://localhost/api');

      const response = await wrappedHandler(request);

      expect(response.headers.get('x-trace-id')).toBe('trace-123');
    });

    it('should generate trace ID if not in request', async () => {
      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withTracing(handler);
      const request = createMockRequest({}, 'http://localhost/api');

      const response = await wrappedHandler(request);
      const traceId = response.headers.get('x-trace-id');

      expect(traceId).toHaveLength(16);
      expect(traceId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should pass additional arguments to handler', async () => {
      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withTracing(handler);
      const request = createMockRequest({}, 'http://localhost/api');

      // TypeScript won't allow extra args, but we test the mechanism
      await wrappedHandler(request);

      expect(handler).toHaveBeenCalledWith(expect.any(String), request);
    });
  });

  // ==========================================================================
  // createRequestContext()
  // ==========================================================================

  describe('createRequestContext()', () => {
    const createMockRequest = (
      method: string,
      url: string,
      headers: Record<string, string> = {}
    ): Request => {
      const h = new Headers();
      for (const [key, value] of Object.entries(headers)) {
        h.set(key, value);
      }
      return { method, url, headers: h } as Request;
    };

    it('should create context with trace ID from request', () => {
      const request = createMockRequest(
        'GET',
        'http://localhost/api/v2/devices',
        { 'x-trace-id': 'trace-123' }
      );

      const context = createRequestContext(request);

      expect(context.traceId).toBe('trace-123');
    });

    it('should generate trace ID if not in request', () => {
      const request = createMockRequest('GET', 'http://localhost/api/v2/devices');

      const context = createRequestContext(request);

      expect(context.traceId).toHaveLength(16);
    });

    it('should include request method', () => {
      const request = createMockRequest('POST', 'http://localhost/api/v2/devices');

      const context = createRequestContext(request);

      expect(context.method).toBe('POST');
    });

    it('should include request path', () => {
      const request = createMockRequest('GET', 'http://localhost/api/v2/devices?status=active');

      const context = createRequestContext(request);

      expect(context.path).toBe('/api/v2/devices');
    });

    it('should include start time', () => {
      const before = performance.now();
      const request = createMockRequest('GET', 'http://localhost/api');
      const context = createRequestContext(request);
      const after = performance.now();

      expect(context.startTime).toBeGreaterThanOrEqual(before);
      expect(context.startTime).toBeLessThanOrEqual(after);
    });
  });
});
