/**
 * TypeScript Type Definitions for ReadingV2 Model
 *
 * These types provide type-safe access to ReadingV2 documents and API interactions.
 * Types align with:
 * - Mongoose model: /models/v2/ReadingV2.ts
 * - Zod schemas: /lib/validations/v2/reading.validation.ts
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Reading/measurement type
 */
export type ReadingType =
  | 'temperature'
  | 'humidity'
  | 'occupancy'
  | 'power'
  | 'co2'
  | 'pressure'
  | 'light'
  | 'motion'
  | 'air_quality'
  | 'water_flow'
  | 'gas'
  | 'vibration'
  | 'voltage'
  | 'current'
  | 'energy';

/**
 * Measurement units
 */
export type ReadingUnit =
  // Temperature
  | 'celsius'
  | 'fahrenheit'
  | 'kelvin'
  // Humidity/percentage
  | 'percent'
  // CO2 / Gas / Air quality
  | 'ppm'
  | 'ppb'
  | 'ug_m3'
  // Pressure
  | 'pascal'
  | 'hpa'
  | 'bar'
  | 'psi'
  // Power/Energy
  | 'watts'
  | 'kilowatts'
  | 'watt_hours'
  | 'kilowatt_hours'
  // Electrical
  | 'volts'
  | 'millivolts'
  | 'amperes'
  | 'milliamperes'
  // Light
  | 'lux'
  | 'lumens'
  // Flow
  | 'liters_per_minute'
  | 'gallons_per_minute'
  | 'cubic_meters_per_hour'
  // Occupancy/Count
  | 'count'
  | 'boolean'
  // Generic
  | 'raw'
  | 'unknown';

/**
 * Reading data source
 */
export type ReadingSource = 'sensor' | 'simulation' | 'manual' | 'calibration';

// ============================================================================
// NESTED INTERFACES
// ============================================================================

/**
 * Reading metadata (bucketing key for time series)
 */
export interface ReadingMetadata {
  /** Device ID the reading belongs to */
  device_id: string;
  /** Type of measurement */
  type: ReadingType;
  /** Unit of measurement */
  unit: ReadingUnit;
  /** Data source */
  source: ReadingSource;
}

/**
 * Reading quality and trust metrics
 */
export interface ReadingQuality {
  /** Whether the reading passed validation */
  is_valid: boolean;
  /** Confidence in reading accuracy (0-1) */
  confidence_score?: number;
  /** Validation flags/issues found */
  validation_flags?: string[];
  /** Whether reading is flagged as anomalous */
  is_anomaly: boolean;
  /** Anomaly score (0-1, higher = more anomalous) */
  anomaly_score?: number;
}

/**
 * Environmental context at time of reading
 */
export interface ReadingContext {
  /** Device battery level at reading time (0-100) */
  battery_level?: number;
  /** Signal strength at reading time (0-100) */
  signal_strength?: number;
  /** Ambient temperature for calibration context */
  ambient_temp?: number;
}

/**
 * Reading processing/audit information
 */
export interface ReadingProcessing {
  /** Original uncalibrated value */
  raw_value?: number;
  /** Calibration offset applied */
  calibration_offset?: number;
  /** Server ingestion timestamp */
  ingested_at: Date;
}

// ============================================================================
// MAIN DOCUMENT INTERFACE
// ============================================================================

/**
 * Full ReadingV2 document interface (as stored in MongoDB)
 */
export interface ReadingV2Document {
  /** MongoDB ObjectId */
  _id: string;
  /** Metadata for bucketing */
  metadata: ReadingMetadata;
  /** Timestamp of the reading */
  timestamp: Date;
  /** The measurement value */
  value: number;
  /** Quality and trust metrics */
  quality: ReadingQuality;
  /** Environmental context */
  context?: ReadingContext;
  /** Processing/audit information */
  processing: ReadingProcessing;
}

// ============================================================================
// INPUT/REQUEST TYPES
// ============================================================================

/**
 * Input for creating a single reading
 */
export interface CreateReadingInput {
  metadata: {
    device_id: string;
    type: ReadingType;
    unit: ReadingUnit;
    source?: ReadingSource;
  };
  /** Timestamp (cannot be in future) */
  timestamp: Date | string | number;
  /** Measurement value */
  value: number;
  /** Optional quality metrics */
  quality?: {
    is_valid?: boolean;
    confidence_score?: number;
    validation_flags?: string[];
    is_anomaly?: boolean;
    anomaly_score?: number;
  };
  /** Optional environmental context */
  context?: {
    battery_level?: number;
    signal_strength?: number;
    ambient_temp?: number;
  };
  /** Optional processing information */
  processing?: {
    raw_value?: number;
    calibration_offset?: number;
  };
}

/**
 * Single reading in a bulk ingest operation
 */
export interface BulkReadingItem {
  /** Device ID */
  device_id: string;
  /** Measurement type */
  type: ReadingType;
  /** Measurement unit */
  unit: ReadingUnit;
  /** Data source (default: 'sensor') */
  source?: ReadingSource;
  /** Timestamp (ISO string, Date, or Unix timestamp) */
  timestamp: Date | string | number;
  /** Measurement value */
  value: number;
  /** Optional confidence score */
  confidence_score?: number;
  /** Optional battery level */
  battery_level?: number;
  /** Optional signal strength */
  signal_strength?: number;
  /** Optional raw value before calibration */
  raw_value?: number;
  /** Optional calibration offset */
  calibration_offset?: number;
}

/**
 * Bulk reading ingest request (POST /api/v2/readings/ingest)
 */
export interface BulkIngestReadingsInput {
  /** Array of readings to ingest (max 10,000) */
  readings: BulkReadingItem[];
  /** Idempotency key to prevent duplicate ingests */
  idempotency_key?: string;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for listing readings (GET /api/v2/readings)
 */
export interface ListReadingsQuery {
  /** Filter by device ID */
  device_id?: string;
  /** Filter by multiple device IDs (comma-separated) */
  device_ids?: string;
  /** Filter by reading type */
  type?: ReadingType;
  /** Start date for range query */
  start_date?: string;
  /** End date for range query */
  end_date?: string;
  /** Filter by data source */
  source?: ReadingSource;
  /** Filter by anomaly flag */
  is_anomaly?: boolean;
  /** Filter by validity flag */
  is_valid?: boolean;
  /** Minimum confidence score */
  min_confidence?: number;
  /** Page number */
  page?: number;
  /** Items per page (max 100) */
  limit?: number;
  /** Sort field and direction (e.g., "timestamp:desc") */
  sort?: string;
}

/**
 * Query parameters for latest readings (GET /api/v2/readings/latest)
 */
export interface LatestReadingsQuery {
  /** Filter by device ID */
  device_id?: string;
  /** Filter by multiple device IDs (comma-separated) */
  device_ids?: string;
  /** Filter by reading type */
  type?: ReadingType;
  /** Filter by building ID (requires join with devices) */
  building_id?: string;
  /** Filter by floor (requires join with devices) */
  floor?: number;
  /** Include quality metrics in response */
  include_quality?: boolean;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Reading response (API output format)
 */
export interface ReadingV2Response {
  _id: string;
  metadata: ReadingMetadata;
  timestamp: string; // ISO string in API responses
  value: number;
  quality: ReadingQuality;
  context?: ReadingContext;
  processing: {
    raw_value?: number;
    calibration_offset?: number;
    ingested_at: string; // ISO string
  };
}

/**
 * Paginated reading list response
 */
export interface ReadingListResponse {
  readings: ReadingV2Response[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

/**
 * Latest reading for a device
 */
export interface LatestReadingResponse {
  device_id: string;
  type: ReadingType;
  value: number;
  unit: ReadingUnit;
  timestamp: string;
  quality?: ReadingQuality;
}

/**
 * Latest readings response
 */
export interface LatestReadingsResponse {
  readings: LatestReadingResponse[];
  /** Timestamp of when the query was executed */
  queried_at: string;
}

/**
 * Bulk ingest response
 */
export interface BulkIngestResponse {
  /** Number of readings successfully inserted */
  inserted: number;
  /** Number of readings rejected */
  rejected: number;
  /** Number of duplicate readings skipped */
  duplicates: number;
  /** Errors for rejected readings */
  errors: {
    index: number;
    error: string;
    reading?: Partial<BulkReadingItem>;
  }[];
}

// ============================================================================
// AGGREGATION TYPES
// ============================================================================

/**
 * Aggregation granularity options
 */
export type AggregationGranularity = 'minute' | 'hour' | 'day' | 'week' | 'month';

/**
 * Aggregation type options
 */
export type AggregationType = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'percentile';

/**
 * MongoDB aggregation pipeline stage types for reading analytics
 */
export interface ReadingMatchStage {
  $match: Record<string, unknown>;
}

export interface ReadingSortStage {
  $sort: Record<string, 1 | -1>;
}

export interface ReadingGroupStage {
  $group: {
    _id: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface ReadingProjectStage {
  $project: Record<string, unknown>;
}

export type ReadingAggregationStage =
  | ReadingMatchStage
  | ReadingSortStage
  | ReadingGroupStage
  | ReadingProjectStage;

/**
 * Aggregated reading data point
 */
export interface AggregatedReading {
  /** Start of the time bucket */
  timestamp: string;
  /** Aggregated value */
  value: number;
  /** Number of readings in bucket */
  count: number;
  /** Device ID (if grouped by device) */
  device_id?: string;
  /** Reading type (if grouped by type) */
  type?: ReadingType;
  /** Floor number (if grouped by floor) */
  floor?: number;
  /** Unit of the aggregated value */
  unit?: ReadingUnit;
}

/**
 * Aggregation query response
 */
export interface AggregationResponse {
  results: AggregatedReading[];
  metadata: {
    granularity: AggregationGranularity;
    aggregation_type: AggregationType;
    total_points: number;
    excluded_invalid: number;
    start_date: string;
    end_date: string;
  };
}
