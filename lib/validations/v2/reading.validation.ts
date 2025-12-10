import { z } from 'zod';
import {
  nonEmptyStringSchema,
  timestampSchema,
  dateRangeSchema,
  cursorPaginationSchema,
  sortSchema,
} from '../common.validation';

/**
 * Reading value schema
 * Allows any number including negatives (for temperatures, etc.)
 */
export const readingValueSchema = z.number().finite('Value must be a finite number');

/**
 * Helper function to add mutual exclusivity validation for device_id and device_ids
 */
const addDeviceIdMutualExclusivity = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (data) => {
      const typedData = data as { device_id?: string; device_ids?: string[] };
      return !(typedData.device_id && typedData.device_ids);
    },
    {
      message: 'Cannot specify both device_id and device_ids',
      path: ['device_id'],
    }
  );

/**
 * Base schema for device ID parameters
 * Used in queries that accept either device_id or device_ids
 */
const deviceIdParamsSchema = z.object({
  device_id: nonEmptyStringSchema.optional(),
  device_ids: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((id) => id.trim()) : undefined))
    .describe('Comma-separated list of device IDs'),
});

/**
 * Reading creation schema (POST /api/v2/readings)
 * Used for ingesting a single reading
 */
export const createReadingSchema = z.object({
  device_id: nonEmptyStringSchema.describe('ID of the device'),
  value: readingValueSchema.describe('Reading value'),
  timestamp: timestampSchema.describe('Reading timestamp (cannot be in future)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional metadata'),
});

/**
 * Bulk reading insert schema (POST /api/v2/readings/bulk)
 * Used for ingesting multiple readings at once
 */
export const bulkInsertReadingsSchema = z.object({
  readings: z
    .array(createReadingSchema)
    .min(1, 'At least one reading is required')
    .max(1000, 'Cannot insert more than 1000 readings at once'),
});

/**
 * Reading query parameters schema (GET /api/v2/readings)
 * Used for filtering and pagination
 */
export const readingQuerySchema = addDeviceIdMutualExclusivity(
  deviceIdParamsSchema
    .extend({
      min_value: z.coerce.number().optional(),
      max_value: z.coerce.number().optional(),
    })
    .merge(dateRangeSchema)
    .merge(cursorPaginationSchema)
    .merge(sortSchema)
).refine(
  (data) => {
    if (data.min_value !== undefined && data.max_value !== undefined) {
      return data.min_value <= data.max_value;
    }
    return true;
  },
  {
    message: 'min_value must be less than or equal to max_value',
    path: ['min_value'],
  }
);

/**
 * Latest readings query schema (GET /api/v2/readings/latest)
 * Used to get the latest reading for each device
 */
export const latestReadingsQuerySchema = addDeviceIdMutualExclusivity(
  deviceIdParamsSchema
);

/**
 * Aggregated readings query schema (GET /api/v2/readings/aggregate)
 * Used for getting aggregated data (avg, min, max, sum, count)
 * Note: Only supports single device_id (not device_ids) because aggregation
 * across multiple devices could mix different sensor types and units.
 * For multiple devices, make separate requests.
 */
export const aggregateReadingsQuerySchema = z
  .object({
    device_id: nonEmptyStringSchema,
    aggregation: z.enum(['avg', 'min', 'max', 'sum', 'count']),
    interval: z
      .enum(['minute', 'hour', 'day', 'week', 'month'])
      .optional()
      .default('hour'),
  })
  .merge(dateRangeSchema);

// Export types
export type ReadingValue = z.infer<typeof readingValueSchema>;
export type CreateReading = z.infer<typeof createReadingSchema>;
export type BulkInsertReadings = z.infer<typeof bulkInsertReadingsSchema>;
export type ReadingQuery = z.infer<typeof readingQuerySchema>;
export type LatestReadingsQuery = z.infer<typeof latestReadingsQuerySchema>;
export type AggregateReadingsQuery = z.infer<typeof aggregateReadingsQuerySchema>;
