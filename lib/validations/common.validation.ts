import { z } from 'zod';

// ============================================================================
// PAGINATION SCHEMAS
// ============================================================================

/**
 * Cursor-based pagination schema
 * Used for efficient pagination with large datasets
 */
export const cursorPaginationSchema = z.object({
  cursor: z.string().optional().describe('Cursor for the next page'),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20)
    .describe('Number of items per page'),
});

/**
 * Offset-based pagination schema
 * Used for traditional page-based pagination
 */
export const offsetPaginationSchema = z.object({
  page: z.number().int().min(1, 'Page must be at least 1').default(1).describe('Page number'),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20)
    .describe('Number of items per page'),
});

/**
 * Combined pagination schema supporting both cursor and offset
 * Handles string to number conversion for query parameters
 */
export const paginationSchema = z
  .object({
    cursor: z.string().optional(),
    page: z
      .union([z.number(), z.string().transform(v => parseInt(v, 10))])
      .pipe(z.number().int().min(1))
      .optional(),
    limit: z
      .union([z.number(), z.string().transform(v => parseInt(v, 10))])
      .pipe(z.number().int().min(1).max(100))
      .default(20),
  })
  .refine(
    data => !(data.cursor && data.page),
    'Cannot use both cursor and page pagination simultaneously'
  );

/**
 * Analytics pagination schema with higher limit
 * Used for analytics endpoints that aggregate data
 */
export const analyticsPaginationSchema = z.object({
  page: z
    .union([z.number(), z.string().transform(v => parseInt(v, 10))])
    .pipe(z.number().int().min(1))
    .optional(),
  limit: z
    .union([z.number(), z.string().transform(v => parseInt(v, 10))])
    .pipe(z.number().int().min(1).max(1000))
    .default(100),
});

// ============================================================================
// DATE RANGE SCHEMAS
// ============================================================================

/**
 * Single date validation - ensures date is valid and not in the future
 */
export const pastDateSchema = z
  .date()
  .or(z.string().datetime())
  .transform(val => (typeof val === 'string' ? new Date(val) : val))
  .refine(date => date <= new Date(), 'Date cannot be in the future');

/**
 * Date that can be in the future (for maintenance scheduling, warranty, etc.)
 */
export const futureDateSchema = z
  .date()
  .or(z.string().datetime())
  .transform(val => (typeof val === 'string' ? new Date(val) : val));

/**
 * Date range schema with start and end dates
 */
export const dateRangeSchema = z
  .object({
    startDate: z
      .date()
      .or(z.string().datetime())
      .transform(val => (typeof val === 'string' ? new Date(val) : val))
      .optional(),
    endDate: z
      .date()
      .or(z.string().datetime())
      .transform(val => (typeof val === 'string' ? new Date(val) : val))
      .optional(),
  })
  .refine(
    data => {
      if (data.startDate && data.endDate) return data.startDate <= data.endDate;

      return true;
    },
    { message: 'Start date must be before or equal to end date' }
  );

/**
 * Time range presets for quick date filtering
 */
export const timeRangePresetSchema = z.enum([
  'last_hour',
  'last_24h',
  'last_7d',
  'last_30d',
  'last_90d',
  'custom',
]);

// ============================================================================
// SORT SCHEMAS
// ============================================================================

/**
 * Sort direction schema
 */
export const sortDirectionSchema = z.enum(['asc', 'desc']).default('desc');

/**
 * Generic sort schema factory
 */
export const createSortSchema = <T extends readonly string[]>(fields: T) =>
  z.object({
    sortBy: z.enum(fields as unknown as [string, ...string[]]).optional(),
    sortDirection: sortDirectionSchema.optional(),
  });

// ============================================================================
// COMMON FIELD VALIDATIONS
// ============================================================================

/**
 * MongoDB ObjectId validation
 */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

/**
 * Device ID validation (custom format like "device_001")
 */
export const deviceIdSchema = z
  .string()
  .min(1, 'Device ID is required')
  .max(100, 'Device ID must be 100 characters or less')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Device ID can only contain alphanumeric characters, underscores, and hyphens'
  );

/**
 * Serial number validation
 */
export const serialNumberSchema = z
  .string()
  .min(1, 'Serial number is required')
  .max(50, 'Serial number must be 50 characters or less')
  .regex(/^[A-Za-z0-9-]+$/, 'Serial number can only contain alphanumeric characters and hyphens');

/**
 * Building ID validation
 */
export const buildingIdSchema = z
  .string()
  .min(1, 'Building ID is required')
  .max(50, 'Building ID must be 50 characters or less')
  .regex(/^[a-zA-Z0-9_-]+$/, { message: 'Building ID contains invalid characters' });

/**
 * Floor number validation
 */
export const floorSchema = z
  .number()
  .int('Floor must be an integer')
  .min(-10, 'Floor cannot be below -10 (basement limit)')
  .max(200, 'Floor cannot exceed 200');

/**
 * Room name validation
 */
export const roomNameSchema = z
  .string()
  .min(1, 'Room name is required')
  .max(100, 'Room name must be 100 characters or less');

/**
 * Percentage validation (0-100)
 */
export const percentageSchema = z
  .number()
  .min(0, 'Percentage cannot be negative')
  .max(100, 'Percentage cannot exceed 100');

/**
 * Battery level validation (0-100)
 */
export const batteryLevelSchema = percentageSchema.describe(
  'Battery level as a percentage (0-100)'
);

/**
 * Signal strength validation (typically -100 to 0 dBm, or 0-100 as percentage)
 */
export const signalStrengthSchema = z
  .number()
  .min(-150, 'Signal strength cannot be below -150 dBm')
  .max(0, 'Signal strength cannot exceed 0 dBm')
  .or(percentageSchema)
  .describe('Signal strength in dBm or as percentage');

/**
 * Confidence score validation (0-1)
 */
export const confidenceScoreSchema = z
  .number()
  .min(0, 'Confidence score cannot be negative')
  .max(1, 'Confidence score cannot exceed 1');

/**
 * Anomaly score validation (0-1, where 1 is definitely an anomaly)
 */
export const anomalyScoreSchema = z
  .number()
  .min(0, 'Anomaly score cannot be negative')
  .max(1, 'Anomaly score cannot exceed 1');

/**
 * Threshold validation (positive number)
 */
export const thresholdSchema = z.number().min(0, 'Threshold must be non-negative').describe('Threshold value');

/**
 * Sampling interval validation (in seconds)
 */
export const samplingIntervalSchema = z
  .number()
  .int('Sampling interval must be an integer')
  .min(1, 'Sampling interval must be at least 1 second')
  .max(86400, 'Sampling interval cannot exceed 24 hours (86400 seconds)');

/**
 * Retention days validation
 */
export const retentionDaysSchema = z
  .number()
  .int('Retention days must be an integer')
  .min(1, 'Retention must be at least 1 day')
  .max(3650, 'Retention cannot exceed 10 years (3650 days)');

/**
 * Tags array validation
 */
export const tagsSchema = z
  .array(
    z
      .string()
      .min(1, 'Tag cannot be empty')
      .max(50, 'Tag must be 50 characters or less')
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        'Tags can only contain alphanumeric characters, underscores, and hyphens'
      )
  )
  .max(20, 'Cannot have more than 20 tags')
  .default([]);

/**
 * Department validation
 */
export const departmentSchema = z
  .string()
  .min(1, 'Department is required')
  .max(100, 'Department must be 100 characters or less');

/**
 * Cost center validation (optional)
 */
export const costCenterSchema = z
  .string()
  .max(50, 'Cost center must be 50 characters or less')
  .optional();

/**
 * Manufacturer name validation
 */
export const manufacturerSchema = z
  .string()
  .min(1, 'Manufacturer is required')
  .max(100, 'Manufacturer must be 100 characters or less');

/**
 * Model name validation
 */
export const modelNameSchema = z
  .string()
  .min(1, 'Model is required')
  .max(100, 'Model must be 100 characters or less');

/**
 * Firmware version validation (semver-like)
 */
export const firmwareVersionSchema = z
  .string()
  .min(1, 'Firmware version is required')
  .max(50, 'Firmware version must be 50 characters or less')
  .regex(
    /^[0-9]+(\.[0-9]+)*(-[a-zA-Z0-9]+)?$/,
    'Invalid firmware version format (expected: X.Y.Z or X.Y.Z-tag)'
  );

/**
 * Zone validation (optional)
 */
export const zoneSchema = z.string().max(50, 'Zone must be 50 characters or less').optional();

/**
 * Coordinates schema for device positioning
 */
export const coordinatesSchema = z
  .object({
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
    z: z.number().optional().describe('Z coordinate (height/elevation)'),
  })
  .strict()
  .optional();

/**
 * User identifier for audit trails
 */
export const userIdentifierSchema = z
  .string()
  .min(1, 'User identifier is required')
  .max(100, 'User identifier must be 100 characters or less');

/**
 * Error code validation
 */
export const errorCodeSchema = z
  .string()
  .min(1, 'Error code is required')
  .max(50, 'Error code must be 50 characters or less');

/**
 * Error message validation
 */
export const errorMessageSchema = z
  .string()
  .max(500, 'Error message must be 500 characters or less');

// ============================================================================
// QUERY PARAMETER HELPERS
// ============================================================================

/**
 * Convert string query parameter to number
 */
export const stringToNumberSchema = z
  .string()
  .transform(val => parseInt(val, 10))
  .pipe(z.number());

/**
 * Convert string query parameter to boolean
 */
export const stringToBooleanSchema = z.string().transform(val => val === 'true' || val === '1');

/**
 * Convert comma-separated string to array
 */
export const commaSeparatedToArraySchema = z.string().transform(val =>
  val
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;
export type OffsetPagination = z.infer<typeof offsetPaginationSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type TimeRangePreset = z.infer<typeof timeRangePresetSchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
export type Coordinates = z.infer<typeof coordinatesSchema>;
