/**
 * Query Builder Utilities
 *
 * Safe query construction for MongoDB/Mongoose.
 * Provides validated filtering, sorting, and field selection
 * with protection against NoSQL injection.
 */

import { z } from 'zod';
import { ApiError } from '../errors/ApiError';
import { ErrorCodes } from '../errors/errorCodes';
import { sanitizeForRegex, sanitizeString } from '../validations/sanitizer';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort order for MongoDB (-1 for desc, 1 for asc)
 */
export type MongoSortOrder = 1 | -1;

/**
 * Sort configuration
 */
export interface SortConfig {
  field: string;
  direction: SortDirection;
  mongoOrder: MongoSortOrder;
}

/**
 * Device filter options
 */
export interface DeviceFilterOptions {
  type?: string | string[];
  status?: string | string[];
  floor?: number | string;
  building_id?: string;
  room_name?: string;
  search?: string;
  tags?: string | string[];
  minBattery?: number;
  maxBattery?: number;
  department?: string;
}

/**
 * Reading filter options
 */
export interface ReadingFilterOptions {
  device_id?: string | string[];
  type?: string | string[];
  startDate?: string | Date;
  endDate?: string | Date;
  minValue?: number;
  maxValue?: number;
  source?: string;
}

/**
 * MongoDB filter object
 */
export type MongoFilter = Record<string, unknown>;

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Sort parameter schema
 */
export const sortParamSchema = z
  .string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_.]*:(asc|desc)$/,
    "Sort must be in format 'field:asc' or 'field:desc'"
  )
  .optional();

// ============================================================================
// SORT UTILITIES
// ============================================================================

/**
 * Allowed sort fields for devices
 */
export const DEVICE_SORT_FIELDS = [
  '_id',
  'name',
  'type',
  'status',
  'floor',
  'room_name',
  'created_at',
  'updated_at',
  'last_reading_at',
  'battery_level',
  'serial_number',
] as const;

/**
 * Allowed sort fields for readings
 */
export const READING_SORT_FIELDS = [
  '_id',
  'timestamp',
  'value',
  'type',
  'device_id',
  'created_at',
] as const;

/**
 * Validates and parses a sort parameter
 *
 * @example
 * ```typescript
 * const sort = validateSortParam('created_at:desc', DEVICE_SORT_FIELDS);
 * // { field: 'created_at', direction: 'desc', mongoOrder: -1 }
 * ```
 */
export function validateSortParam<T extends readonly string[]>(
  sortParam: string | undefined,
  allowedFields: T,
  defaultField: T[number] = allowedFields[0],
  defaultDirection: SortDirection = 'desc'
): SortConfig {
  if (!sortParam) {
    return {
      field: defaultField,
      direction: defaultDirection,
      mongoOrder: defaultDirection === 'desc' ? -1 : 1,
    };
  }

  const result = sortParamSchema.safeParse(sortParam);
  if (!result.success) {
    throw new ApiError(
      ErrorCodes.INVALID_SORT,
      400,
      "Invalid sort format. Use 'field:asc' or 'field:desc'",
      { received: sortParam }
    );
  }

  const [field, direction] = sortParam.split(':') as [string, SortDirection];

  if (!allowedFields.includes(field as T[number])) {
    throw new ApiError(
      ErrorCodes.INVALID_SORT,
      400,
      `Invalid sort field '${field}'. Allowed fields: ${allowedFields.join(', ')}`,
      { field, allowedFields: [...allowedFields] }
    );
  }

  return {
    field,
    direction,
    mongoOrder: direction === 'desc' ? -1 : 1,
  };
}

/**
 * Validates sort order string
 */
export function validateSortOrder(
  field: string,
  order: string | undefined,
  allowedFields: readonly string[]
): { [key: string]: MongoSortOrder } {
  const validOrder = order === 'asc' ? 1 : -1;

  if (!allowedFields.includes(field)) {
    throw new ApiError(
      ErrorCodes.INVALID_SORT,
      400,
      `Invalid sort field '${field}'`,
      { field, allowedFields: [...allowedFields] }
    );
  }

  return { [field]: validOrder };
}

/**
 * Parses sort parameter from URL searchParams
 */
export function parseSortFromSearchParams(
  searchParams: URLSearchParams,
  allowedFields: readonly string[],
  defaultField?: string,
  defaultDirection?: SortDirection
): SortConfig {
  const sort = searchParams.get('sort') ?? undefined;
  return validateSortParam(
    sort,
    allowedFields,
    defaultField ?? allowedFields[0],
    defaultDirection ?? 'desc'
  );
}

// ============================================================================
// DEVICE FILTER BUILDER
// ============================================================================

/**
 * Builds a safe MongoDB filter for device queries
 *
 * @example
 * ```typescript
 * const filter = buildDeviceFilter({
 *   type: 'temperature',
 *   status: 'active',
 *   floor: 3,
 *   search: 'sensor'
 * });
 * // { type: 'temperature', status: 'active', floor: 3, $or: [...] }
 * ```
 */
export function buildDeviceFilter(options: DeviceFilterOptions): MongoFilter {
  const filter: MongoFilter = {};

  // Type filter (single or array)
  if (options.type) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    const sanitizedTypes = types.map((t) => sanitizeString(t));
    filter.type = types.length === 1 ? sanitizedTypes[0] : { $in: sanitizedTypes };
  }

  // Status filter (single or array)
  if (options.status) {
    const statuses = Array.isArray(options.status)
      ? options.status
      : [options.status];
    const sanitizedStatuses = statuses.map((s) => sanitizeString(s));
    filter.status =
      statuses.length === 1 ? sanitizedStatuses[0] : { $in: sanitizedStatuses };
  }

  // Floor filter
  if (options.floor !== undefined) {
    const floor =
      typeof options.floor === 'string'
        ? parseInt(options.floor, 10)
        : options.floor;

    if (!isNaN(floor)) {
      filter['location.floor'] = floor;
    }
  }

  // Building ID filter
  if (options.building_id) {
    filter['location.building_id'] = sanitizeString(options.building_id);
  }

  // Room name filter (partial match)
  if (options.room_name) {
    filter['location.room_name'] = {
      $regex: sanitizeForRegex(options.room_name),
      $options: 'i',
    };
  }

  // Search filter (searches multiple fields)
  if (options.search) {
    const searchRegex = sanitizeForRegex(options.search);
    filter.$or = [
      { _id: { $regex: searchRegex, $options: 'i' } },
      { name: { $regex: searchRegex, $options: 'i' } },
      { 'location.room_name': { $regex: searchRegex, $options: 'i' } },
      { serial_number: { $regex: searchRegex, $options: 'i' } },
    ];
  }

  // Tags filter
  if (options.tags) {
    const tags = Array.isArray(options.tags)
      ? options.tags
      : options.tags.split(',').map((t) => t.trim());
    const sanitizedTags = tags.map((t) => sanitizeString(t));
    filter.tags = { $all: sanitizedTags };
  }

  // Battery level range
  if (options.minBattery !== undefined || options.maxBattery !== undefined) {
    const batteryFilter: Record<string, number> = {};
    if (options.minBattery !== undefined) {
      batteryFilter.$gte = Number(options.minBattery);
    }
    if (options.maxBattery !== undefined) {
      batteryFilter.$lte = Number(options.maxBattery);
    }
    filter['health.battery_level'] = batteryFilter;
  }

  // Department filter
  if (options.department) {
    filter['ownership.department'] = sanitizeString(options.department);
  }

  return filter;
}

// ============================================================================
// READING FILTER BUILDER
// ============================================================================

/**
 * Builds a safe MongoDB filter for reading queries
 *
 * @example
 * ```typescript
 * const filter = buildReadingFilter({
 *   device_id: 'device_001',
 *   type: 'temperature',
 *   startDate: '2024-01-01',
 *   endDate: '2024-01-31'
 * });
 * ```
 */
export function buildReadingFilter(options: ReadingFilterOptions): MongoFilter {
  const filter: MongoFilter = {};

  // Device ID filter (single or array)
  if (options.device_id) {
    const deviceIds = Array.isArray(options.device_id)
      ? options.device_id
      : [options.device_id];
    const sanitizedIds = deviceIds.map((id) => sanitizeString(id));
    filter['metadata.device_id'] =
      deviceIds.length === 1 ? sanitizedIds[0] : { $in: sanitizedIds };
  }

  // Type filter (single or array)
  if (options.type) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    const sanitizedTypes = types.map((t) => sanitizeString(t));
    filter['metadata.type'] =
      types.length === 1 ? sanitizedTypes[0] : { $in: sanitizedTypes };
  }

  // Date range filter
  if (options.startDate || options.endDate) {
    const timestampFilter: Record<string, Date> = {};

    if (options.startDate) {
      const startDate =
        options.startDate instanceof Date
          ? options.startDate
          : new Date(options.startDate);
      if (!isNaN(startDate.getTime())) {
        timestampFilter.$gte = startDate;
      }
    }

    if (options.endDate) {
      const endDate =
        options.endDate instanceof Date
          ? options.endDate
          : new Date(options.endDate);
      if (!isNaN(endDate.getTime())) {
        timestampFilter.$lte = endDate;
      }
    }

    if (Object.keys(timestampFilter).length > 0) {
      filter.timestamp = timestampFilter;
    }
  }

  // Value range filter
  if (options.minValue !== undefined || options.maxValue !== undefined) {
    const valueFilter: Record<string, number> = {};
    if (options.minValue !== undefined) {
      valueFilter.$gte = Number(options.minValue);
    }
    if (options.maxValue !== undefined) {
      valueFilter.$lte = Number(options.maxValue);
    }
    filter.value = valueFilter;
  }

  // Source filter
  if (options.source) {
    filter['metadata.source'] = sanitizeString(options.source);
  }

  return filter;
}

// ============================================================================
// FIELD SELECTION
// ============================================================================

/**
 * Allowed fields for device projection
 */
export const DEVICE_PROJECTION_FIELDS = [
  '_id',
  'name',
  'type',
  'status',
  'location',
  'configuration',
  'hardware',
  'health',
  'ownership',
  'compliance',
  'audit',
  'created_at',
  'updated_at',
  'last_reading_at',
  'tags',
  'serial_number',
] as const;

/**
 * Allowed fields for reading projection
 */
export const READING_PROJECTION_FIELDS = [
  '_id',
  'timestamp',
  'value',
  'metadata',
  'unit',
  'quality',
  'analytics',
] as const;

/**
 * Validates and builds a field selection projection
 *
 * @example
 * ```typescript
 * const projection = selectFields('_id,name,status', DEVICE_PROJECTION_FIELDS);
 * // { _id: 1, name: 1, status: 1 }
 * ```
 */
export function selectFields(
  fieldsParam: string | string[] | undefined,
  allowedFields: readonly string[]
): Record<string, 1> | undefined {
  if (!fieldsParam) {
    return undefined;
  }

  const requestedFields = Array.isArray(fieldsParam)
    ? fieldsParam
    : fieldsParam.split(',').map((f) => f.trim());

  const projection: Record<string, 1> = {};
  const invalidFields: string[] = [];

  for (const field of requestedFields) {
    if (!field) {continue;}

    const sanitizedField = sanitizeString(field);

    // Check if field or parent field is allowed
    const isAllowed = allowedFields.some(
      (allowed) =>
        sanitizedField === allowed || sanitizedField.startsWith(`${allowed}.`)
    );

    if (isAllowed) {
      projection[sanitizedField] = 1;
    } else {
      invalidFields.push(field);
    }
  }

  if (invalidFields.length > 0) {
    throw new ApiError(
      ErrorCodes.INVALID_INPUT,
      400,
      `Invalid field(s) requested: ${invalidFields.join(', ')}`,
      { invalidFields, allowedFields: [...allowedFields] }
    );
  }

  return Object.keys(projection).length > 0 ? projection : undefined;
}

/**
 * Parses fields parameter from URL searchParams
 */
export function parseFieldsFromSearchParams(
  searchParams: URLSearchParams,
  allowedFields: readonly string[]
): Record<string, 1> | undefined {
  const fields = searchParams.get('fields') ?? undefined;
  return selectFields(fields, allowedFields);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extracts query parameters from URLSearchParams into a typed object
 */
export function extractQueryParams<T extends Record<string, unknown>>(
  searchParams: URLSearchParams,
  paramNames: (keyof T)[]
): Partial<T> {
  const params: Partial<T> = {};

  for (const name of paramNames) {
    const value = searchParams.get(String(name));
    if (value !== null) {
      // Handle comma-separated values as arrays
      if (value.includes(',')) {
        (params as Record<string, unknown>)[String(name)] = value
          .split(',')
          .map((v) => v.trim());
      } else {
        (params as Record<string, unknown>)[String(name)] = value;
      }
    }
  }

  return params;
}

/**
 * Combines multiple filters with $and
 */
export function combineFilters(...filters: MongoFilter[]): MongoFilter {
  const nonEmptyFilters = filters.filter(
    (f) => f && Object.keys(f).length > 0
  );

  if (nonEmptyFilters.length === 0) {return {};}
  if (nonEmptyFilters.length === 1) {return nonEmptyFilters[0];}

  return { $and: nonEmptyFilters };
}

const queryBuilderUtils = {
  validateSortParam,
  validateSortOrder,
  parseSortFromSearchParams,
  buildDeviceFilter,
  buildReadingFilter,
  selectFields,
  parseFieldsFromSearchParams,
  extractQueryParams,
  combineFilters,
  DEVICE_SORT_FIELDS,
  READING_SORT_FIELDS,
  DEVICE_PROJECTION_FIELDS,
  READING_PROJECTION_FIELDS,
};

export default queryBuilderUtils;
