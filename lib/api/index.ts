/**
 * API Utilities Module
 *
 * Centralized exports for API utilities including response formatting,
 * pagination, and query building.
 *
 * @example
 * ```typescript
 * import {
 *   jsonSuccess,
 *   jsonPaginated,
 *   getPaginationParams,
 *   buildDeviceFilter
 * } from '@/lib/api';
 *
 * // Return a success response
 * return jsonSuccess(device, 'Device created');
 *
 * // Build paginated response
 * const pagination = calculatePagination(total, page, limit);
 * return jsonPaginated(devices, pagination);
 * ```
 */

// Response formatters
export {
  successResponse,
  errorResponse,
  simpleErrorResponse,
  paginatedResponse,
  listResponse,
  jsonSuccess,
  jsonError,
  jsonSimpleError,
  jsonPaginated,
  jsonList,
  createdResponse,
  noContentResponse,
  acceptedResponse,
  isSuccessResponse,
  isErrorResponse,
  isPaginatedResponse,
  type PaginationInfo,
  type SuccessResponse,
  type PaginatedResponse,
  type ListResponse,
  type ErrorResponse,
  type ApiResponse,
} from './response';

// Pagination utilities
export {
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
  offsetPaginationSchema,
  cursorPaginationSchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  type OffsetPaginationParams,
  type CursorPaginationParams,
  type DecodedCursor,
  type PaginationParams,
  type RawPaginationInput,
} from './pagination';

// Query builder utilities
export {
  validateSortParam,
  validateSortOrder,
  parseSortFromSearchParams,
  buildDeviceFilter,
  buildReadingFilter,
  selectFields,
  parseFieldsFromSearchParams,
  extractQueryParams,
  combineFilters,
  sortParamSchema,
  DEVICE_SORT_FIELDS,
  READING_SORT_FIELDS,
  DEVICE_PROJECTION_FIELDS,
  READING_PROJECTION_FIELDS,
  type SortDirection,
  type MongoSortOrder,
  type SortConfig,
  type DeviceFilterOptions,
  type ReadingFilterOptions,
  type MongoFilter,
} from './queryBuilder';
