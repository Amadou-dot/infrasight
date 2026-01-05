/**
 * Request Tracing
 *
 * Generates and propagates correlation IDs for request tracing.
 * Enables tracking requests across services and log aggregation.
 */

import { randomUUID } from 'crypto';

/** Standard header names for trace propagation */
const TRACE_HEADER = 'x-trace-id';
const CORRELATION_HEADER = 'x-correlation-id';
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Generate a new trace ID
 * Uses a shortened UUID format for readability
 */
export function generateTraceId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * Extract or generate trace ID from request headers
 * Checks multiple common header names for compatibility
 */
export function getTraceId(request: Request): string {
  return (
    request.headers.get(TRACE_HEADER) ||
    request.headers.get(CORRELATION_HEADER) ||
    request.headers.get(REQUEST_ID_HEADER) ||
    generateTraceId()
  );
}

/**
 * Add trace ID to response headers
 */
export function addTraceHeaders(response: Response, traceId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(TRACE_HEADER, traceId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create request timing tracker
 */
export function createRequestTimer(): {
  start: number;
  elapsed: () => number;
} {
  const start = performance.now();
  return {
    start,
    elapsed: () => Math.round(performance.now() - start),
  };
}

/**
 * Higher-order function that wraps a handler with tracing
 *
 * @example
 * ```typescript
 * export const GET = withTracing(async (traceId, request) => {
 *   logger.info('Processing request', { traceId });
 *   // Handler code
 * });
 * ```
 */
export function withTracing<T extends [Request, ...unknown[]]>(
  handler: (traceId: string, ...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    const request = args[0];
    const traceId = getTraceId(request);

    const response = await handler(traceId, ...args);
    return addTraceHeaders(response, traceId);
  };
}

/**
 * Request context for passing trace information through the call stack
 */
export interface RequestContext {
  traceId: string;
  startTime: number;
  method: string;
  path: string;
}

/**
 * Create request context from a request
 */
export function createRequestContext(request: Request): RequestContext {
  const url = new URL(request.url);
  return {
    traceId: getTraceId(request),
    startTime: performance.now(),
    method: request.method,
    path: url.pathname,
  };
}
