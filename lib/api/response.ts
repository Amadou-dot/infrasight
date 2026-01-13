/**
 * API Response Utilities
 *
 * Standardized response formatters for consistent API responses.
 * All responses follow a unified structure with success indicator,
 * data/error payload, and timestamp.
 */

import type { ApiError, ApiErrorJSON } from '../errors/ApiError';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Pagination metadata for paginated responses
 */
export interface PaginationInfo {
  /** Total number of items across all pages */
  total: number;
  /** Current page number (1-indexed) */
  page: number;
  /** Items per page */
  limit: number;
  /** Total number of pages */
  totalPages: number;
  /** Whether there's a next page */
  hasNext: boolean;
  /** Whether there's a previous page */
  hasPrevious: boolean;
  /** Cursor for next page (cursor-based pagination) */
  nextCursor?: string;
  /** Cursor for previous page (cursor-based pagination) */
  prevCursor?: string;
}

/**
 * Base success response
 */
export interface SuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
}

/**
 * Paginated success response
 */
export interface PaginatedResponse<T> extends SuccessResponse<T[]> {
  pagination: PaginationInfo;
}

/**
 * List response with total count
 */
export interface ListResponse<T> extends SuccessResponse<T[]> {
  total: number;
  pagination?: PaginationInfo;
}

/**
 * Error response (re-export from ApiError for convenience)
 */
export type ErrorResponse = ApiErrorJSON;

/**
 * Generic API response union type
 */
export type ApiResponse<T> = SuccessResponse<T> | PaginatedResponse<T> | ErrorResponse;

// ============================================================================
// RESPONSE FORMATTERS
// ============================================================================

/**
 * Creates a success response
 *
 * @example
 * ```typescript
 * return successResponse(device);
 * // { success: true, data: {...}, timestamp: "2024-..." }
 *
 * return successResponse(device, 'Device created successfully');
 * // { success: true, data: {...}, message: "Device created...", timestamp: "2024-..." }
 * ```
 */
export function successResponse<T>(data: T, message?: string): SuccessResponse<T> {
  return {
    success: true,
    data,
    ...(message ? { message } : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a success Response object for Next.js
 */
export function jsonSuccess<T>(data: T, message?: string, status = 200): Response {
  return Response.json(successResponse(data, message), { status });
}

/**
 * Creates an error response from an ApiError
 *
 * @example
 * ```typescript
 * return errorResponse(ApiError.notFound('Device', 'device_001'));
 * // { success: false, error: {...}, timestamp: "2024-..." }
 * ```
 */
export function errorResponse(error: ApiError): ErrorResponse {
  return error.toJSON();
}

/**
 * Creates an error Response object for Next.js
 */
export function jsonError(error: ApiError): Response {
  return error.toResponse();
}

/**
 * Creates a simple error response from code, status, and message
 */
export function simpleErrorResponse(
  code: string,
  statusCode: number,
  message: string
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      statusCode,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an error Response object from code, status, and message
 */
export function jsonSimpleError(code: string, statusCode: number, message: string): Response {
  return Response.json(simpleErrorResponse(code, statusCode, message), {
    status: statusCode,
  });
}

/**
 * Creates a paginated response
 *
 * @example
 * ```typescript
 * return paginatedResponse(devices, {
 *   total: 100,
 *   page: 1,
 *   limit: 20,
 *   totalPages: 5,
 *   hasNext: true,
 *   hasPrevious: false,
 * });
 * ```
 */
export function paginatedResponse<T>(data: T[], pagination: PaginationInfo): PaginatedResponse<T> {
  return {
    success: true,
    data,
    pagination,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a paginated Response object for Next.js
 */
export function jsonPaginated<T>(data: T[], pagination: PaginationInfo, status = 200): Response {
  return Response.json(paginatedResponse(data, pagination), { status });
}

/**
 * Creates a list response with total count
 *
 * @example
 * ```typescript
 * return listResponse(devices, 100);
 * // { success: true, data: [...], total: 100, timestamp: "2024-..." }
 * ```
 */
export function listResponse<T>(
  data: T[],
  total: number,
  pagination?: PaginationInfo
): ListResponse<T> {
  return {
    success: true,
    data,
    total,
    ...(pagination ? { pagination } : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a list Response object for Next.js
 */
export function jsonList<T>(
  data: T[],
  total: number,
  pagination?: PaginationInfo,
  status = 200
): Response {
  return Response.json(listResponse(data, total, pagination), { status });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a 201 Created response
 */
export function createdResponse<T>(data: T, message?: string): Response {
  return jsonSuccess(data, message ?? 'Resource created successfully', 201);
}

/**
 * Creates a 204 No Content response
 */
export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Creates a 202 Accepted response (for async operations)
 */
export function acceptedResponse<T>(data: T, message?: string): Response {
  return jsonSuccess(data, message ?? 'Request accepted for processing', 202);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a response is successful
 */
export function isSuccessResponse<T>(
  response: ApiResponse<T>
): response is SuccessResponse<T> | PaginatedResponse<T> {
  return response.success === true;
}

/**
 * Type guard to check if a response is an error
 */
export function isErrorResponse<T>(response: ApiResponse<T>): response is ErrorResponse {
  return response.success === false;
}

/**
 * Type guard to check if a response is paginated
 */
export function isPaginatedResponse<T>(response: ApiResponse<T>): response is PaginatedResponse<T> {
  return response.success === true && 'pagination' in response;
}

const responseUtils = {
  successResponse,
  errorResponse,
  paginatedResponse,
  listResponse,
  jsonSuccess,
  jsonError,
  jsonPaginated,
  jsonList,
  createdResponse,
  noContentResponse,
  acceptedResponse,
};

export default responseUtils;
