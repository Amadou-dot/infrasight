/**
 * Pagination Utilities
 *
 * Functions for extracting and calculating pagination parameters.
 * Supports both cursor-based and offset-based pagination.
 */

import { z } from 'zod';
import { ApiError } from '../errors/ApiError';
import { ErrorCodes } from '../errors/errorCodes';
import type { PaginationInfo } from './response';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default number of items per page */
export const DEFAULT_PAGE_SIZE = 20;

/** Maximum number of items per page */
export const MAX_PAGE_SIZE = 100;

/** Maximum number of items per page for analytics endpoints */
export const MAX_ANALYTICS_PAGE_SIZE = 1000;

/** Minimum number of items per page */
export const MIN_PAGE_SIZE = 1;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Offset-based pagination parameters
 */
export interface OffsetPaginationParams {
  type: 'offset';
  page: number;
  limit: number;
  skip: number;
}

/**
 * Cursor-based pagination parameters
 */
export interface CursorPaginationParams {
  type: 'cursor';
  cursor?: string;
  limit: number;
  decodedCursor?: DecodedCursor;
}

/**
 * Decoded cursor data
 */
export interface DecodedCursor {
  /** The field to sort by */
  field: string;
  /** The value of the last item */
  value: string | number | Date;
  /** The ID of the last item (for tie-breaking) */
  lastId: string;
}

/**
 * Union type for pagination parameters
 */
export type PaginationParams = OffsetPaginationParams | CursorPaginationParams;

/**
 * Raw pagination input from query parameters
 */
export interface RawPaginationInput {
  page?: string | number;
  limit?: string | number;
  cursor?: string;
}

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Schema for validating offset pagination
 */
export const offsetPaginationSchema = z.object({
  page: z.coerce
    .number()
    .int('Page must be an integer')
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(MIN_PAGE_SIZE, `Limit must be at least ${MIN_PAGE_SIZE}`)
    .max(MAX_PAGE_SIZE, `Limit cannot exceed ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
});

/**
 * Schema for validating cursor pagination
 */
export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(MIN_PAGE_SIZE, `Limit must be at least ${MIN_PAGE_SIZE}`)
    .max(MAX_PAGE_SIZE, `Limit cannot exceed ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
});

// ============================================================================
// PAGINATION EXTRACTION
// ============================================================================

/**
 * Extracts offset-based pagination parameters from query
 *
 * @param query - Raw pagination input from query parameters
 * @param options - Optional configuration
 * @param options.maxLimit - Maximum allowed limit (default: MAX_PAGE_SIZE = 100)
 *
 * @example
 * ```typescript
 * const params = getOffsetPaginationParams({ page: '2', limit: '10' });
 * // { type: 'offset', page: 2, limit: 10, skip: 10 }
 *
 * // For analytics endpoints with higher limit:
 * const params = getOffsetPaginationParams({ limit: '500' }, { maxLimit: 1000 });
 * ```
 */
export function getOffsetPaginationParams(
  query: RawPaginationInput,
  options: { maxLimit?: number } = {}
): OffsetPaginationParams {
  const maxLimit = options.maxLimit ?? MAX_PAGE_SIZE;

  // Create schema with custom max limit
  const schema = z.object({
    page: z.coerce
      .number()
      .int('Page must be an integer')
      .min(1, 'Page must be at least 1')
      .default(1),
    limit: z.coerce
      .number()
      .int('Limit must be an integer')
      .min(MIN_PAGE_SIZE, `Limit must be at least ${MIN_PAGE_SIZE}`)
      .max(maxLimit, `Limit cannot exceed ${maxLimit}`)
      .default(DEFAULT_PAGE_SIZE),
  });

  const result = schema.safeParse({
    page: query.page,
    limit: query.limit,
  });

  if (!result.success) {
    const firstError = result.error.issues[0];
    throw new ApiError(
      ErrorCodes.INVALID_PAGINATION,
      400,
      firstError?.message ?? 'Invalid pagination parameters',
      { field: firstError?.path.join('.') }
    );
  }

  const { page, limit } = result.data;

  return {
    type: 'offset',
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

/**
 * Extracts cursor-based pagination parameters from query
 *
 * @example
 * ```typescript
 * const params = getCursorPaginationParams({ cursor: 'abc123', limit: '10' });
 * // { type: 'cursor', cursor: 'abc123', limit: 10, decodedCursor: {...} }
 * ```
 */
export function getCursorPaginationParams(query: RawPaginationInput): CursorPaginationParams {
  const result = cursorPaginationSchema.safeParse({
    cursor: query.cursor,
    limit: query.limit,
  });

  if (!result.success) {
    const firstError = result.error.issues[0];
    throw new ApiError(
      ErrorCodes.INVALID_PAGINATION,
      400,
      firstError?.message ?? 'Invalid pagination parameters',
      { field: firstError?.path.join('.') }
    );
  }

  const { cursor, limit } = result.data;

  let decodedCursor: DecodedCursor | undefined;
  if (cursor) decodedCursor = decodeCursor(cursor);

  return {
    type: 'cursor',
    cursor,
    limit,
    decodedCursor,
  };
}

/**
 * Auto-detects and extracts pagination parameters
 * Uses cursor if provided, otherwise offset
 */
export function getPaginationParams(query: RawPaginationInput): PaginationParams {
  if (query.cursor) return getCursorPaginationParams(query);

  return getOffsetPaginationParams(query);
}

/**
 * Extracts pagination from URL searchParams
 */
export function getPaginationFromSearchParams(searchParams: URLSearchParams): PaginationParams {
  return getPaginationParams({
    page: searchParams.get('page') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
  });
}

// ============================================================================
// PAGINATION CALCULATION
// ============================================================================

/**
 * Calculates pagination metadata for offset-based pagination
 *
 * @example
 * ```typescript
 * const pagination = calculateOffsetPagination(100, 1, 20);
 * // {
 * //   total: 100,
 * //   page: 1,
 * //   limit: 20,
 * //   totalPages: 5,
 * //   hasNext: true,
 * //   hasPrevious: false
 * // }
 * ```
 */
export function calculateOffsetPagination(
  total: number,
  page: number,
  limit: number
): PaginationInfo {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(page, totalPages);

  return {
    total,
    page: currentPage,
    limit,
    totalPages,
    hasNext: currentPage < totalPages,
    hasPrevious: currentPage > 1,
  };
}

/**
 * Alias for calculateOffsetPagination for semantic clarity
 */
export const calculatePagination = calculateOffsetPagination;

/**
 * Calculates pagination metadata for cursor-based pagination
 *
 * @param total - Total count (optional for cursor pagination)
 * @param limit - Items per page
 * @param hasMore - Whether there are more items
 * @param nextCursor - Cursor for the next page
 * @param prevCursor - Cursor for the previous page
 */
export function calculateCursorPagination(
  total: number | undefined,
  limit: number,
  hasMore: boolean,
  nextCursor?: string,
  prevCursor?: string
): Omit<PaginationInfo, 'page' | 'totalPages'> & {
  page?: number;
  totalPages?: number;
} {
  return {
    total: total ?? 0,
    limit,
    hasNext: hasMore,
    hasPrevious: !!prevCursor,
    nextCursor,
    prevCursor,
  };
}

// ============================================================================
// CURSOR ENCODING/DECODING
// ============================================================================

/**
 * Encodes pagination cursor data to a base64 string
 *
 * @example
 * ```typescript
 * const cursor = encodeCursor({
 *   field: 'createdAt',
 *   value: '2024-01-01T00:00:00Z',
 *   lastId: 'device_050'
 * });
 * // "eyJmaWVsZCI6ImNyZWF0ZWRBdCIsInZhbHVlIjoiMjAyNC0wMS0wMVQwMDowMDowMFoiLCJsYXN0SWQiOiJkZXZpY2VfMDUwIn0"
 * ```
 */
export function encodeCursor(data: DecodedCursor): string {
  const serialized = {
    field: data.field,
    value: data.value instanceof Date ? data.value.toISOString() : data.value,
    lastId: data.lastId,
  };
  return Buffer.from(JSON.stringify(serialized)).toString('base64url');
}

/**
 * Decodes a base64 cursor string to pagination data
 *
 * @throws ApiError if cursor is invalid
 */
export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded);

    if (!parsed.field || parsed.value === undefined || !parsed.lastId)
      throw new Error('Missing cursor fields');

    return {
      field: String(parsed.field),
      value: parsed.value,
      lastId: String(parsed.lastId),
    };
  } catch {
    throw new ApiError(ErrorCodes.INVALID_PAGINATION, 400, 'Invalid pagination cursor', { cursor });
  }
}

/**
 * Creates a cursor from the last item in a result set
 *
 * @example
 * ```typescript
 * const devices = await Device.find().sort({ createdAt: -1 }).limit(21);
 * const hasMore = devices.length > 20;
 * const pageDevices = devices.slice(0, 20);
 * const nextCursor = hasMore
 *   ? createCursorFromItem(pageDevices.at(-1), 'createdAt')
 *   : undefined;
 * ```
 */
export function createCursorFromItem<T extends { _id?: string | unknown }>(
  item: T | undefined,
  sortField: keyof T
): string | undefined {
  if (!item) return undefined;

  const value = item[sortField];
  const id = typeof item._id === 'string' ? item._id : String(item._id);

  return encodeCursor({
    field: String(sortField),
    value: value instanceof Date ? value.toISOString() : String(value),
    lastId: id,
  });
}

// ============================================================================
// MONGOOSE HELPERS
// ============================================================================

/**
 * Applies offset pagination to a Mongoose query
 *
 * @example
 * ```typescript
 * const params = getOffsetPaginationParams({ page: '2', limit: '10' });
 * const devices = await applyOffsetPagination(Device.find(), params);
 * ```
 */
export function applyOffsetPagination<
  Q extends { skip: (n: number) => Q; limit: (n: number) => Q },
>(query: Q, params: OffsetPaginationParams): Q {
  return query.skip(params.skip).limit(params.limit);
}

/**
 * Builds a cursor-based query condition for Mongoose
 *
 * @example
 * ```typescript
 * const params = getCursorPaginationParams({ cursor: 'abc123', limit: '10' });
 * const cursorQuery = buildCursorQuery(params, 'desc');
 * const devices = await Device.find(cursorQuery).limit(params.limit + 1);
 * ```
 */
export function buildCursorQuery(
  params: CursorPaginationParams,
  sortDirection: 'asc' | 'desc' = 'desc'
): Record<string, unknown> {
  if (!params.decodedCursor) return {};

  const { field, value, lastId } = params.decodedCursor;
  const operator = sortDirection === 'desc' ? '$lt' : '$gt';

  return {
    $or: [
      { [field]: { [operator]: value } },
      {
        [field]: value,
        _id: { [operator]: lastId },
      },
    ],
  };
}

const paginationUtils = {
  getPaginationParams,
  getOffsetPaginationParams,
  getCursorPaginationParams,
  getPaginationFromSearchParams,
  calculateOffsetPagination,
  calculatePagination,
  calculateCursorPagination,
  encodeCursor,
  decodeCursor,
  createCursorFromItem,
  applyOffsetPagination,
  buildCursorQuery,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
};

export default paginationUtils;
