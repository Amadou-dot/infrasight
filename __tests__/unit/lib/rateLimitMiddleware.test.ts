/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Rate Limit Middleware Tests
 *
 * Tests for rate limiting middleware functions.
 */

import type { NextRequest } from 'next/server';
import {
  getClientIp,
  addRateLimitHeaders,
  withRateLimit,
  createRateLimitMiddleware,
} from '@/lib/ratelimit/middleware';
import type { RateLimitResult } from '@/lib/ratelimit/limiter';

// Mock dependencies
jest.mock('@/lib/ratelimit/limiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({
    allowed: true,
    remaining: 99,
    limit: 100,
    resetIn: 60,
    current: 1,
  }),
  checkMultipleRateLimits: jest.fn().mockResolvedValue({
    allowed: true,
    remaining: 99,
    limit: 100,
    resetIn: 60,
    current: 1,
  }),
}));

jest.mock('@/lib/ratelimit/config', () => ({
  isRateLimitEnabled: jest.fn().mockReturnValue(true),
  getRateLimitConfig: jest.fn().mockReturnValue({
    perIp: { name: 'test', max: 100, windowSeconds: 60 },
  }),
}));

jest.mock('@/lib/monitoring/logger', () => ({
  logger: {
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Rate Limit Middleware', () => {
  // ==========================================================================
  // getClientIp()
  // ==========================================================================

  describe('getClientIp()', () => {
    const createMockRequest = (headers: Record<string, string>): NextRequest => {
      const h = new Headers();
      for (const [key, value] of Object.entries(headers)) h.set(key, value);

      return { headers: h } as NextRequest;
    };

    it('should extract IP from x-forwarded-for header', () => {
      const request = createMockRequest({
        'x-forwarded-for': '192.168.1.1, 10.0.0.1',
      });

      const ip = getClientIp(request);

      expect(ip).toBe('192.168.1.1');
    });

    it('should extract IP from x-real-ip header', () => {
      const request = createMockRequest({
        'x-real-ip': '192.168.1.2',
      });

      const ip = getClientIp(request);

      expect(ip).toBe('192.168.1.2');
    });

    it('should extract IP from cf-connecting-ip header (Cloudflare)', () => {
      const request = createMockRequest({
        'cf-connecting-ip': '192.168.1.3',
      });

      const ip = getClientIp(request);

      expect(ip).toBe('192.168.1.3');
    });

    it('should prefer x-forwarded-for over other headers', () => {
      const request = createMockRequest({
        'x-forwarded-for': '192.168.1.1',
        'x-real-ip': '192.168.1.2',
        'cf-connecting-ip': '192.168.1.3',
      });

      const ip = getClientIp(request);

      expect(ip).toBe('192.168.1.1');
    });

    it('should return "unknown" when no IP headers present', () => {
      const request = createMockRequest({});

      const ip = getClientIp(request);

      expect(ip).toBe('unknown');
    });

    it('should handle x-client-ip header', () => {
      const request = createMockRequest({
        'x-client-ip': '192.168.1.4',
      });

      const ip = getClientIp(request);

      expect(ip).toBe('192.168.1.4');
    });

    it('should trim whitespace from IP', () => {
      const request = createMockRequest({
        'x-forwarded-for': '  192.168.1.1  ',
      });

      const ip = getClientIp(request);

      expect(ip).toBe('192.168.1.1');
    });
  });

  // ==========================================================================
  // addRateLimitHeaders()
  // ==========================================================================

  describe('addRateLimitHeaders()', () => {
    it('should add rate limit headers to response', () => {
      const response = new Response('OK');
      const result: RateLimitResult = {
        allowed: true,
        remaining: 50,
        limit: 100,
        resetIn: 30,
        current: 50,
      };

      const newResponse = addRateLimitHeaders(response, result);

      expect(newResponse.headers.get('X-RateLimit-Limit')).toBe('100');
      expect(newResponse.headers.get('X-RateLimit-Remaining')).toBe('50');
      expect(newResponse.headers.get('X-RateLimit-Reset')).toBe('30');
    });

    it('should add Retry-After header when present', () => {
      const response = new Response('OK');
      const result: RateLimitResult = {
        allowed: false,
        remaining: 0,
        limit: 100,
        resetIn: 45,
        current: 100,
        retryAfter: 45,
      };

      const newResponse = addRateLimitHeaders(response, result);

      expect(newResponse.headers.get('Retry-After')).toBe('45');
    });

    it('should not add Retry-After when not present', () => {
      const response = new Response('OK');
      const result: RateLimitResult = {
        allowed: true,
        remaining: 50,
        limit: 100,
        resetIn: 30,
        current: 50,
      };

      const newResponse = addRateLimitHeaders(response, result);

      expect(newResponse.headers.get('Retry-After')).toBeNull();
    });

    it('should preserve original response status', () => {
      const response = new Response('Created', { status: 201 });
      const result: RateLimitResult = {
        allowed: true,
        remaining: 99,
        limit: 100,
        resetIn: 60,
        current: 1,
      };

      const newResponse = addRateLimitHeaders(response, result);

      expect(newResponse.status).toBe(201);
    });

    it('should preserve original response headers', () => {
      const response = new Response('OK', {
        headers: { 'content-type': 'application/json' },
      });
      const result: RateLimitResult = {
        allowed: true,
        remaining: 99,
        limit: 100,
        resetIn: 60,
        current: 1,
      };

      const newResponse = addRateLimitHeaders(response, result);

      expect(newResponse.headers.get('content-type')).toBe('application/json');
    });
  });

  // ==========================================================================
  // withRateLimit()
  // ==========================================================================

  describe('withRateLimit()', () => {
    const createMockNextRequest = (
      path: string,
      method: string = 'POST',
      headers: Record<string, string> = {}
    ): NextRequest => {
      const h = new Headers(headers);
      return {
        headers: h,
        method,
        nextUrl: {
          pathname: path,
        },
      } as unknown as NextRequest;
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should call handler when rate limiting is disabled', async () => {
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      isRateLimitEnabled.mockReturnValue(false);

      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withRateLimit(handler);
      const request = createMockNextRequest('/api/v2/devices');

      await wrappedHandler(request);

      expect(handler).toHaveBeenCalledWith(request);
    });

    it('should call handler when allowed by rate limit', async () => {
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      isRateLimitEnabled.mockReturnValue(true);

      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withRateLimit(handler);
      const request = createMockNextRequest('/api/v2/devices');

      const response = await wrappedHandler(request);

      expect(handler).toHaveBeenCalled();
      expect(response.headers.get('X-RateLimit-Limit')).toBeDefined();
    });

    it('should call handler when no rate limit config', async () => {
      const { isRateLimitEnabled, getRateLimitConfig } = require('@/lib/ratelimit/config');
      isRateLimitEnabled.mockReturnValue(true);
      getRateLimitConfig.mockReturnValue(null);

      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withRateLimit(handler);
      const request = createMockNextRequest('/api/v2/exempt-endpoint');

      await wrappedHandler(request);

      expect(handler).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // createRateLimitMiddleware()
  // ==========================================================================

  describe('createRateLimitMiddleware()', () => {
    const createMockNextRequest = (): NextRequest => {
      return {
        headers: new Headers({ 'x-forwarded-for': '192.168.1.1' }),
        method: 'POST',
        nextUrl: { pathname: '/api/v2/custom' },
      } as unknown as NextRequest;
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should create middleware with custom config', async () => {
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      isRateLimitEnabled.mockReturnValue(true);

      const customMiddleware = createRateLimitMiddleware({
        name: 'custom',
        max: 50,
        windowSeconds: 30,
      });

      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = customMiddleware(handler);
      const request = createMockNextRequest();

      const response = await wrappedHandler(request);

      expect(handler).toHaveBeenCalled();
      expect(response.headers.get('X-RateLimit-Limit')).toBeDefined();
    });

    it('should skip when rate limiting is disabled', async () => {
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      isRateLimitEnabled.mockReturnValue(false);

      const customMiddleware = createRateLimitMiddleware({
        name: 'custom',
        max: 50,
        windowSeconds: 30,
      });

      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = customMiddleware(handler);
      const request = createMockNextRequest();

      await wrappedHandler(request);

      expect(handler).toHaveBeenCalled();
    });

    it('should use custom identifier function when provided', async () => {
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      const { checkRateLimit } = require('@/lib/ratelimit/limiter');
      isRateLimitEnabled.mockReturnValue(true);

      const customMiddleware = createRateLimitMiddleware({
        name: 'custom',
        max: 50,
        windowSeconds: 30,
        getIdentifier: async () => 'custom-identifier',
      });

      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = customMiddleware(handler);
      const request = createMockNextRequest();

      await wrappedHandler(request);

      expect(checkRateLimit).toHaveBeenCalledWith('custom-identifier', expect.any(Object));
    });
  });
});
