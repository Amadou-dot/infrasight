/**
 * Request Validation Middleware
 *
 * Combines header validation, body size limits, and query parameter whitelisting.
 * Integrates with existing error handling infrastructure.
 */

import type { NextRequest } from 'next/server';
import { validateHeaders, type HeaderValidationOptions } from './headers';
import { validateBodySize, type BodySizeConfig, DEFAULT_BODY_SIZE_CONFIG } from './bodySize';
import { ApiError } from '../errors/ApiError';
import { ErrorCodes } from '../errors/errorCodes';

export interface RequestValidationOptions {
  /** Header validation options */
  headers?: HeaderValidationOptions;
  /** Body size configuration */
  bodySize?: BodySizeConfig;
  /** Allowed query parameters (whitelist). If not provided, all params are allowed */
  allowedQueryParams?: string[];
  /** Skip validation entirely */
  skip?: boolean;
}

/**
 * Validates a request and throws ApiError on validation failure
 */
export async function validateRequest(
  request: NextRequest,
  options: RequestValidationOptions = {}
): Promise<void> {
  if (options.skip) return;

  const pathname = request.nextUrl.pathname;

  // 1. Validate headers
  validateHeaders(request, options.headers);

  // 2. Validate body size for mutation requests
  const method = request.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(method))
    await validateBodySize(request, pathname, options.bodySize ?? DEFAULT_BODY_SIZE_CONFIG);

  // 3. Validate query parameters (if whitelist provided)
  if (options.allowedQueryParams) {
    const searchParams = request.nextUrl.searchParams;
    const providedParams = Array.from(searchParams.keys());

    const unknownParams = providedParams.filter(
      param => !options.allowedQueryParams!.includes(param)
    );

    if (unknownParams.length > 0)
      throw new ApiError(
        ErrorCodes.INVALID_QUERY_PARAM,
        400,
        `Unknown query parameter${unknownParams.length > 1 ? 's' : ''}: ${unknownParams.join(', ')}`,
        {
          unknown: unknownParams,
          allowed: options.allowedQueryParams,
        }
      );
  }
}

/**
 * Higher-order function that wraps a handler with request validation
 *
 * @example
 * ```typescript
 * export const POST = withRequestValidation(
 *   async (request: NextRequest) => {
 *     // Handler code
 *   },
 *   { allowedQueryParams: ['format'] }
 * );
 * ```
 */
export function withRequestValidation<T extends [NextRequest, ...unknown[]]>(
  handler: (...args: T) => Promise<Response>,
  options: RequestValidationOptions = {}
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    const request = args[0];

    try {
      await validateRequest(request, options);
      return await handler(...args);
    } catch (error) {
      if (ApiError.isApiError(error)) return error.toResponse();

      throw error;
    }
  };
}

/**
 * Pre-built validation configurations for common endpoint types
 */
export const ValidationPresets = {
  /** Standard JSON API endpoint */
  jsonApi: {
    headers: {
      requireContentType: true,
      allowedContentTypes: ['application/json'],
    },
  } as RequestValidationOptions,

  /** Bulk data ingestion endpoint */
  bulkIngestion: {
    headers: {
      requireContentType: true,
      allowedContentTypes: ['application/json'],
    },
    bodySize: {
      default: 10 * 1024 * 1024, // 10MB
      bulk: 10 * 1024 * 1024,
    },
  } as RequestValidationOptions,

  /** Read-only endpoint (no body validation) */
  readOnly: {
    headers: {
      requireContentType: false,
    },
  } as RequestValidationOptions,
};
