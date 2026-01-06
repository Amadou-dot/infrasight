/**
 * Rate Limit Middleware
 *
 * Wraps API handlers with rate limiting logic.
 * Supports both IP-based and device-based limiting.
 */

import type { NextRequest } from 'next/server';
import {
  checkRateLimit,
  checkMultipleRateLimits,
  type RateLimitResult,
} from './limiter';
import { getRateLimitConfig, isRateLimitEnabled } from './config';
import { ApiError } from '../errors/ApiError';
import { logger } from '../monitoring/logger';

/**
 * Extract client IP from request headers
 * Handles various proxy configurations
 */
export function getClientIp(request: NextRequest): string {
  // Check headers in order of preference
  const headers = [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip', // Cloudflare
    'x-client-ip',
    'x-cluster-client-ip',
  ];

  for (const header of headers) {
    const value = request.headers.get(header);
    if (value) {
      // x-forwarded-for can contain multiple IPs, take the first
      const ip = value.split(',')[0].trim();
      if (ip) return ip;
    }
  }

  // Fallback - may not be accurate in all environments
  return 'unknown';
}

/**
 * Extract device ID from request body (for ingestion endpoint)
 * Clones the request to avoid consuming the body
 */
async function extractDeviceId(request: NextRequest): Promise<string | null> {
  try {
    // Clone the request to avoid consuming the body
    const clonedRequest = request.clone();
    const body = await clonedRequest.json();

    // For bulk ingestion, use the first device ID
    if (Array.isArray(body.readings) && body.readings.length > 0) {
      const firstReading = body.readings[0];
      return firstReading.metadata?.device_id || firstReading.device_id || null;
    }

    // Single reading
    return body.metadata?.device_id || body.device_id || null;
  } catch {
    // Body parsing failed - likely not JSON or empty
    return null;
  }
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  response: Response,
  result: RateLimitResult
): Response {
  const headers = new Headers(response.headers);

  headers.set('X-RateLimit-Limit', String(result.limit));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(result.resetIn));

  if (result.retryAfter !== undefined) 
    headers.set('Retry-After', String(result.retryAfter));
  

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Rate limit middleware wrapper
 *
 * @example
 * ```typescript
 * export const POST = withRateLimit(async (request: NextRequest) => {
 *   // Handler code
 * });
 * ```
 */
export function withRateLimit<T extends [NextRequest, ...unknown[]]>(
  handler: (...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    // Check if rate limiting is enabled
    if (!isRateLimitEnabled()) 
      return handler(...args);
    

    const request = args[0];
    const path = request.nextUrl.pathname;
    const method = request.method;

    // Get rate limit config for this endpoint
    const config = getRateLimitConfig(path, method);
    if (!config) 
      // No config means exempt from rate limiting
      return handler(...args);
    

    const clientIp = getClientIp(request);

    // Build limits to check
    const limitsToCheck: Array<{ identifier: string; config: typeof config.perIp }> = [
      { identifier: clientIp, config: config.perIp },
    ];

    // For ingestion endpoint, also check per-device limit
    if (config.perDevice && path.includes('/readings/ingest')) {
      const deviceId = await extractDeviceId(request);
      if (deviceId) 
        limitsToCheck.push({ identifier: deviceId, config: config.perDevice });
      
    }

    // Check rate limits
    const result = await checkMultipleRateLimits(limitsToCheck);

    if (!result.allowed) {
      logger.warn('Request rate limited', {
        path,
        method,
        clientIp: clientIp.slice(0, 8) + '...',
        current: result.current,
        limit: result.limit,
      });

      const error = ApiError.rateLimitExceeded(result.retryAfter, {
        limit: result.limit,
        current: result.current,
        resetIn: result.resetIn,
      });

      return addRateLimitHeaders(error.toResponse(), result);
    }

    // Execute handler and add rate limit headers to response
    const response = await handler(...args);
    return addRateLimitHeaders(response, result);
  };
}

/**
 * Create a custom rate limit middleware with specific configuration
 */
export function createRateLimitMiddleware(
  customConfig: {
    name: string;
    max: number;
    windowSeconds: number;
    getIdentifier?: (request: NextRequest) => Promise<string>;
  }
) {
  return function <T extends [NextRequest, ...unknown[]]>(
    handler: (...args: T) => Promise<Response>
  ): (...args: T) => Promise<Response> {
    return async (...args: T): Promise<Response> => {
      if (!isRateLimitEnabled()) 
        return handler(...args);
      

      const request = args[0];
      const identifier = customConfig.getIdentifier
        ? await customConfig.getIdentifier(request)
        : getClientIp(request);

      const result = await checkRateLimit(identifier, {
        name: customConfig.name,
        max: customConfig.max,
        windowSeconds: customConfig.windowSeconds,
      });

      if (!result.allowed) {
        const error = ApiError.rateLimitExceeded(result.retryAfter, {
          limit: result.limit,
          current: result.current,
        });
        return addRateLimitHeaders(error.toResponse(), result);
      }

      const response = await handler(...args);
      return addRateLimitHeaders(response, result);
    };
  };
}
