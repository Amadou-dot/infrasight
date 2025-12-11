import { z } from 'zod';
import {
  deviceIdSchema,
  confidenceScoreSchema,
  anomalyScoreSchema,
  batteryLevelSchema,
  signalStrengthSchema,
  pastDateSchema,
  paginationSchema,
  dateRangeSchema,
  createSortSchema,
} from '../common.validation';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Reading type enum - the type of measurement
 */
export const readingTypeSchema = z.enum([
  'temperature',
  'humidity',
  'occupancy',
  'power',
  'co2',
  'pressure',
  'light',
  'motion',
  'air_quality',
  'water_flow',
  'gas',
  'vibration',
  'voltage',
  'current',
  'energy',
]);

/**
 * Reading unit enum - measurement units
 */
export const readingUnitSchema = z.enum([
  // Temperature
  'celsius',
  'fahrenheit',
  'kelvin',
  // Humidity/percentage
  'percent',
  // CO2 / Gas / Air quality
  'ppm',
  'ppb',
  'ug_m3', // micrograms per cubic meter
  // Pressure
  'pascal',
  'hpa',
  'bar',
  'psi',
  // Power/Energy
  'watts',
  'kilowatts',
  'watt_hours',
  'kilowatt_hours',
  // Electrical
  'volts',
  'millivolts',
  'amperes',
  'milliamperes',
  // Light
  'lux',
  'lumens',
  // Flow
  'liters_per_minute',
  'gallons_per_minute',
  'cubic_meters_per_hour',
  // Occupancy/Count
  'count',
  'boolean', // for presence/motion
  // Generic
  'raw',
  'unknown',
]);

/**
 * Reading source enum - where the reading originated
 */
export const readingSourceSchema = z.enum([
  'sensor',
  'simulation',
  'manual',
  'calibration',
]);

// ============================================================================
// NESTED SCHEMAS
// ============================================================================

/**
 * Reading metadata schema (bucketing key for time series)
 */
export const readingMetadataSchema = z.object({
  device_id: deviceIdSchema,
  type: readingTypeSchema,
  unit: readingUnitSchema,
  source: readingSourceSchema.default('sensor'),
});

/**
 * Reading quality schema
 */
export const readingQualitySchema = z.object({
  is_valid: z.boolean().default(true).describe('Whether the reading passed validation'),
  confidence_score: confidenceScoreSchema.optional().describe('Confidence in reading accuracy (0-1)'),
  validation_flags: z
    .array(z.string().max(50))
    .optional()
    .describe('Validation flags/issues found'),
  is_anomaly: z.boolean().default(false).describe('Whether reading is flagged as anomalous'),
  anomaly_score: anomalyScoreSchema.optional().describe('Anomaly score (0-1, higher = more anomalous)'),
});

/**
 * Reading context schema (environmental context)
 */
export const readingContextSchema = z.object({
  battery_level: batteryLevelSchema.optional().describe('Device battery level at reading time'),
  signal_strength: signalStrengthSchema.optional().describe('Signal strength at reading time'),
  ambient_temp: z.number().optional().describe('Ambient temperature for calibration context'),
});

/**
 * Reading processing/audit schema
 */
export const readingProcessingSchema = z.object({
  raw_value: z.number().optional().describe('Original uncalibrated value'),
  calibration_offset: z.number().optional().describe('Calibration offset applied'),
  ingested_at: z.date().default(() => new Date()).describe('Server ingestion timestamp'),
});

// ============================================================================
// READING CREATION SCHEMA (POST - Single Reading)
// ============================================================================

/**
 * Schema for creating a single reading
 */
export const createReadingSchema = z.object({
  metadata: readingMetadataSchema,
  timestamp: pastDateSchema.describe('Timestamp of the reading (cannot be in future)'),
  value: z.number().describe('The measurement value'),
  quality: readingQualitySchema.optional().default({
    is_valid: true,
    is_anomaly: false,
  }),
  context: readingContextSchema.optional(),
  processing: readingProcessingSchema.optional(),
});

// ============================================================================
// BULK READING INGEST SCHEMA (POST - Multiple Readings)
// ============================================================================

/**
 * Single reading in a bulk ingest operation (lighter validation)
 */
export const bulkReadingItemSchema = z.object({
  device_id: deviceIdSchema,
  type: readingTypeSchema,
  unit: readingUnitSchema,
  source: readingSourceSchema.optional().default('sensor'),
  timestamp: z
    .date()
    .or(z.string().datetime())
    .or(z.number()) // Unix timestamp support
    .transform((val) => {
      if (typeof val === 'number') 
        return new Date(val > 1e12 ? val : val * 1000); // Handle ms vs seconds
      
      return typeof val === 'string' ? new Date(val) : val;
    })
    .refine((date) => date <= new Date(), 'Timestamp cannot be in the future'),
  value: z.number(),
  // Optional quality fields for ingest
  confidence_score: confidenceScoreSchema.optional(),
  battery_level: batteryLevelSchema.optional(),
  signal_strength: signalStrengthSchema.optional(),
  raw_value: z.number().optional(),
  calibration_offset: z.number().optional(),
});

/**
 * Schema for bulk reading ingest (POST /api/v2/readings/ingest)
 */
export const bulkIngestReadingsSchema = z.object({
  readings: z
    .array(bulkReadingItemSchema)
    .min(1, 'At least one reading is required')
    .max(10000, 'Cannot ingest more than 10,000 readings at once'),
  // Idempotency key to prevent duplicate ingests
  idempotency_key: z
    .string()
    .uuid()
    .optional()
    .describe('UUID to prevent duplicate ingests'),
  // Source identifier for batch
  batch_source: z.string().max(100).optional().describe('Identifier for the batch source'),
});

// ============================================================================
// READING QUERY SCHEMAS (GET)
// ============================================================================

/**
 * Reading sort fields
 */
const readingSortFields = [
  'timestamp',
  'value',
  'anomaly_score',
  'confidence_score',
] as const;

/**
 * Aggregation types for readings
 */
export const aggregationTypeSchema = z.enum([
  'raw',    // No aggregation, return individual readings
  'avg',
  'sum',
  'min',
  'max',
  'count',
  'first',
  'last',
]);

/**
 * Time granularity for aggregations
 */
export const timeGranularitySchema = z.enum([
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
]);

/**
 * Schema for reading list query parameters (GET /api/v2/readings)
 */
export const listReadingsQuerySchema = z.object({
  // Pagination
  ...paginationSchema.shape,
  
  // Sorting
  ...createSortSchema(readingSortFields).shape,
  
  // Required: Device filter (at least one device required for efficiency)
  device_id: z
    .union([
      deviceIdSchema,
      z.array(deviceIdSchema),
      z.string().transform((val) => val.split(',')),
    ])
    .optional(),
  
  // Type filter
  type: z
    .union([
      readingTypeSchema,
      z.array(readingTypeSchema),
      z.string().transform((val) => val.split(',') as z.infer<typeof readingTypeSchema>[]),
    ])
    .optional(),
  
  // Source filter
  source: z
    .union([
      readingSourceSchema,
      z.array(readingSourceSchema),
      z.string().transform((val) => val.split(',') as z.infer<typeof readingSourceSchema>[]),
    ])
    .optional(),
  
  // Time range (required for efficiency with time series)
  ...dateRangeSchema.shape,
  
  // Quality filters
  is_valid: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .optional(),
  is_anomaly: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .optional(),
  min_confidence: z
    .union([z.number(), z.string().transform((v) => parseFloat(v))])
    .optional(),
  min_anomaly_score: z
    .union([z.number(), z.string().transform((v) => parseFloat(v))])
    .optional(),
  
  // Value range filter
  min_value: z.union([z.number(), z.string().transform((v) => parseFloat(v))]).optional(),
  max_value: z.union([z.number(), z.string().transform((v) => parseFloat(v))]).optional(),
  
  // Field projection
  fields: z
    .string()
    .transform((val) => val.split(','))
    .optional(),
});

/**
 * Schema for latest readings query (GET /api/v2/readings/latest)
 */
export const latestReadingsQuerySchema = z.object({
  // Required: Device IDs
  device_ids: z
    .union([
      z.array(deviceIdSchema),
      z.string().transform((val) => val.split(',')),
    ])
    .describe('Device IDs to get latest readings for'),
  
  // Optional: Type filter
  type: z
    .union([
      readingTypeSchema,
      z.array(readingTypeSchema),
      z.string().transform((val) => val.split(',') as z.infer<typeof readingTypeSchema>[]),
    ])
    .optional(),
  
  // Include invalid readings
  include_invalid: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .default(false),
  
  // Include quality metrics aggregation
  include_quality_metrics: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .default(false),
});

/**
 * Schema for reading aggregation/analytics query (GET /api/v2/analytics/energy)
 */
export const readingAnalyticsQuerySchema = z.object({
  // Required: Device filter
  device_id: z
    .union([
      deviceIdSchema,
      z.array(deviceIdSchema),
      z.string().transform((val) => val.split(',')),
    ])
    .optional(),
  
  // Required: Time range
  ...dateRangeSchema.shape,
  
  // Aggregation settings
  aggregation: aggregationTypeSchema.default('avg'),
  granularity: timeGranularitySchema.default('hour'),
  
  // Type filter
  type: z
    .union([
      readingTypeSchema,
      z.array(readingTypeSchema),
      z.string().transform((val) => val.split(',') as z.infer<typeof readingTypeSchema>[]),
    ])
    .optional(),
  
  // Quality filter (exclude invalid by default)
  include_invalid: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .default(false),
  
  // Group by options
  group_by: z
    .enum(['device', 'type', 'floor', 'room', 'building', 'department'])
    .optional(),
  
  // Comparison period
  // Comparison period for trend analysis
  compare_with: z.enum(['previous_period', 'same_period_last_week', 'same_period_last_month']).optional(),
  
  // Pagination for grouped results
  ...paginationSchema.shape,
});

/**
 * Schema for anomaly analytics query (GET /api/v2/analytics/anomalies)
 */
export const anomalyAnalyticsQuerySchema = z.object({
  // Pagination
  ...paginationSchema.shape,
  
  // Time range
  ...dateRangeSchema.shape,
  
  // Device filter
  device_id: z
    .union([
      deviceIdSchema,
      z.array(deviceIdSchema),
      z.string().transform((val) => val.split(',')),
    ])
    .optional(),
  
  // Type filter
  type: z
    .union([
      readingTypeSchema,
      z.array(readingTypeSchema),
      z.string().transform((val) => val.split(',') as z.infer<typeof readingTypeSchema>[]),
    ])
    .optional(),
  
  // Minimum anomaly score threshold
  min_score: z
    .union([z.number(), z.string().transform((v) => parseFloat(v))])
    .default(0.5),
  
  // Time bucket for trends
  bucket_granularity: timeGranularitySchema.optional(),
  
  // Sorting
  ...createSortSchema(['timestamp', 'anomaly_score', 'value'] as const).shape,
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type ReadingType = z.infer<typeof readingTypeSchema>;
export type ReadingUnit = z.infer<typeof readingUnitSchema>;
export type ReadingSource = z.infer<typeof readingSourceSchema>;
export type ReadingMetadata = z.infer<typeof readingMetadataSchema>;
export type ReadingQuality = z.infer<typeof readingQualitySchema>;
export type ReadingContext = z.infer<typeof readingContextSchema>;
export type ReadingProcessing = z.infer<typeof readingProcessingSchema>;
export type CreateReadingInput = z.infer<typeof createReadingSchema>;
export type BulkReadingItem = z.infer<typeof bulkReadingItemSchema>;
export type BulkIngestReadingsInput = z.infer<typeof bulkIngestReadingsSchema>;
export type ListReadingsQuery = z.infer<typeof listReadingsQuerySchema>;
export type LatestReadingsQuery = z.infer<typeof latestReadingsQuerySchema>;
export type ReadingAnalyticsQuery = z.infer<typeof readingAnalyticsQuerySchema>;
export type AnomalyAnalyticsQuery = z.infer<typeof anomalyAnalyticsQuerySchema>;
export type AggregationType = z.infer<typeof aggregationTypeSchema>;
export type TimeGranularity = z.infer<typeof timeGranularitySchema>;
