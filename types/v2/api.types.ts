/**
 * TypeScript Type Definitions for V2 API Types
 *
 * These types provide standardized API request/response formats
 * for consistent error handling, pagination, and responses.
 */

import type {
  DeviceV2Response,
  DeviceListResponse,
  DeviceHistoryResponse,
  CreateDeviceInput,
  UpdateDeviceInput,
  ListDevicesQuery,
  DeviceHistoryQuery,
  DeviceStatus,
  DeviceType,
} from './device.types';

import type {
  ReadingV2Response,
  ReadingListResponse,
  LatestReadingsResponse,
  BulkIngestResponse,
  AggregationResponse,
  CreateReadingInput,
  BulkIngestReadingsInput,
  ListReadingsQuery,
  LatestReadingsQuery,
  ReadingType,
  ReadingSource,
  AggregationGranularity,
  AggregationType,
} from './reading.types';

// Re-export report validation types
export type { ReportGenerateQuery } from '@/lib/validations/v2/report.validation';

// ============================================================================
// RE-EXPORT COMMON TYPES
// ============================================================================

export type {
  // Device types
  DeviceV2Response,
  DeviceListResponse,
  DeviceHistoryResponse,
  CreateDeviceInput,
  UpdateDeviceInput,
  ListDevicesQuery,
  DeviceHistoryQuery,
  DeviceStatus,
  DeviceType,
  // Reading types
  ReadingV2Response,
  ReadingListResponse,
  LatestReadingsResponse,
  BulkIngestResponse,
  AggregationResponse,
  CreateReadingInput,
  BulkIngestReadingsInput,
  ListReadingsQuery,
  LatestReadingsQuery,
  ReadingType,
  ReadingSource,
  AggregationGranularity,
  AggregationType,
};

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * Application error codes
 */
export type ErrorCode =
  // Device errors
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_ALREADY_EXISTS'
  | 'SERIAL_NUMBER_EXISTS'
  | 'INVALID_DEVICE_ID'
  // Reading errors
  | 'INVALID_READING'
  | 'READING_NOT_FOUND'
  | 'DUPLICATE_READING'
  | 'FUTURE_TIMESTAMP'
  // Validation errors
  | 'INVALID_INPUT'
  | 'VALIDATION_ERROR'
  | 'MISSING_REQUIRED_FIELD'
  // Auth errors
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_API_KEY'
  // Rate limiting
  | 'RATE_LIMIT_EXCEEDED'
  | 'DEVICE_RATE_LIMIT_EXCEEDED'
  // Server errors
  | 'INTERNAL_ERROR'
  | 'DATABASE_ERROR'
  | 'CONNECTION_ERROR'
  // Generic
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'CONFLICT';

/**
 * HTTP status codes used in the API
 */
export type HttpStatusCode =
  | 200 // OK
  | 201 // Created
  | 204 // No Content
  | 400 // Bad Request
  | 401 // Unauthorized
  | 403 // Forbidden
  | 404 // Not Found
  | 409 // Conflict
  | 422 // Unprocessable Entity
  | 429 // Too Many Requests
  | 500 // Internal Server Error
  | 503; // Service Unavailable

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Standard success response wrapper
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
  /** Optional message */
  message?: string;
}

/**
 * Standard error response
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    statusCode: HttpStatusCode;
    /** Additional error context */
    details?: Record<string, unknown>;
    /** Validation errors for specific fields */
    fieldErrors?: {
      field: string;
      message: string;
    }[];
  };
  timestamp: string;
}

/**
 * Union type for API responses
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  timestamp: string;
}

/**
 * Cursor-based paginated response
 */
export interface CursorPaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    cursor: string | null;
    hasMore: boolean;
    limit: number;
  };
  timestamp: string;
}

// ============================================================================
// RATE LIMITING TYPES
// ============================================================================

/**
 * Rate limit information returned in response headers
 */
export interface RateLimitInfo {
  /** Maximum requests allowed in window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** Timestamp when the rate limit resets (ISO 8601) */
  reset_at: string;
  /** Whether the request was allowed */
  allowed: boolean;
}

/**
 * Rate limit exceeded response
 */
export interface RateLimitExceededResponse {
  success: false;
  error: {
    code: 'RATE_LIMIT_EXCEEDED' | 'DEVICE_RATE_LIMIT_EXCEEDED';
    message: string;
    statusCode: 429;
    details: {
      limit: number;
      remaining: 0;
      reset_at: string;
      retry_after_seconds: number;
    };
  };
  timestamp: string;
}

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

/**
 * Query parameters for energy analytics
 */
export interface EnergyAnalyticsQuery {
  /** Comma-separated device IDs */
  device_ids?: string;
  /** Start date (required, ISO 8601) */
  start_date: string;
  /** End date (required, ISO 8601) */
  end_date: string;
  /** Time granularity */
  granularity: AggregationGranularity;
  /** Aggregation type */
  aggregation_type: AggregationType;
  /** Percentile value (for percentile aggregation) */
  percentile?: 50 | 75 | 90 | 95 | 99;
  /** Group results by */
  group_by?: 'device' | 'floor' | 'room' | 'department' | 'type';
  /** Filter by reading type */
  reading_type?: ReadingType;
  /** Exclude invalid readings (default: true) */
  exclude_invalid?: boolean;
}

/**
 * Device health summary for analytics
 */
export interface DeviceHealthSummary {
  /** Total number of devices */
  total_devices: number;
  /** Number of devices by status */
  by_status: Record<DeviceStatus, number>;
  /** Number of devices by type */
  by_type: Record<DeviceType, number>;
  /** Overall health score (0-100) */
  health_score: number;
  /** Devices with critical issues */
  critical_devices: {
    device_id: string;
    serial_number: string;
    issue: string;
    severity: 'warning' | 'critical';
  }[];
  /** Devices with low battery */
  low_battery_devices: {
    device_id: string;
    serial_number: string;
    battery_level: number;
  }[];
  /** Offline devices */
  offline_devices: {
    device_id: string;
    serial_number: string;
    last_seen: string;
    offline_duration_minutes: number;
  }[];
  /** Devices due for maintenance */
  maintenance_due: {
    device_id: string;
    serial_number: string;
    next_maintenance: string;
    days_overdue: number;
  }[];
}

/**
 * Query parameters for health analytics
 */
export interface HealthAnalyticsQuery {
  /** Filter by building ID */
  building_id?: string;
  /** Filter by floor */
  floor?: number;
  /** Filter by department */
  department?: string;
  /** Include detailed device lists */
  include_details?: boolean;
}

/**
 * Anomaly summary for analytics
 */
export interface AnomalySummary {
  /** Total anomalies in period */
  total_anomalies: number;
  /** Anomalies by reading type */
  by_type: Record<ReadingType, number>;
  /** Anomalies by device */
  by_device: {
    device_id: string;
    serial_number: string;
    anomaly_count: number;
    avg_anomaly_score: number;
  }[];
  /** Recent anomalies */
  recent_anomalies: {
    device_id: string;
    reading_type: ReadingType;
    value: number;
    expected_range: { min: number; max: number };
    anomaly_score: number;
    timestamp: string;
  }[];
  /** Anomaly trend (hourly counts) */
  trend: {
    timestamp: string;
    count: number;
  }[];
}

/**
 * Query parameters for anomaly analytics
 */
export interface AnomalyAnalyticsQuery {
  /** Start date (ISO 8601) */
  start_date?: string;
  /** End date (ISO 8601) */
  end_date?: string;
  /** Filter by device ID */
  device_id?: string;
  /** Filter by reading type */
  type?: ReadingType;
  /** Minimum anomaly score (0-1) */
  min_score?: number;
  /** Limit number of results */
  limit?: number;
}

// ============================================================================
// METADATA TYPES
// ============================================================================

/**
 * Aggregated metadata response
 */
export interface MetadataResponse {
  /** List of all manufacturers */
  manufacturers: string[];
  /** List of all departments */
  departments: string[];
  /** List of all building IDs */
  building_ids: string[];
  /** Floors per building */
  floors_by_building: Record<string, number[]>;
  /** All tags in use */
  tags: string[];
  /** Device type counts */
  device_types: Record<DeviceType, number>;
  /** Total device count */
  total_devices: number;
  /** Total reading count (approximate) */
  total_readings: number;
  /** Metadata freshness timestamp */
  updated_at: string;
}

// ============================================================================
// AUDIT TYPES
// ============================================================================

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  /** Entry ID */
  _id: string;
  /** Target entity type */
  entity_type: 'device' | 'reading' | 'system';
  /** Target entity ID */
  entity_id: string;
  /** Action performed */
  action: 'create' | 'update' | 'delete' | 'ingest' | 'config_change';
  /** User/system that performed action */
  actor: string;
  /** Timestamp of action */
  timestamp: string;
  /** Changes made (for updates) */
  changes?: {
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[];
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Query parameters for audit log
 */
export interface AuditLogQuery {
  /** Filter by entity type */
  entity_type?: 'device' | 'reading' | 'system';
  /** Filter by entity ID */
  entity_id?: string;
  /** Filter by action */
  action?: string;
  /** Filter by actor */
  actor?: string;
  /** Start date */
  start_date?: string;
  /** End date */
  end_date?: string;
  /** Page number */
  page?: number;
  /** Items per page */
  limit?: number;
}

/**
 * Audit log response
 */
export interface AuditLogResponse {
  entries: AuditLogEntry[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Type guard for success responses
 */
export function isSuccessResponse<T>(response: ApiResponse<T>): response is ApiSuccessResponse<T> {
  return response.success === true;
}

/**
 * Type guard for error responses
 */
export function isErrorResponse<T>(response: ApiResponse<T>): response is ApiErrorResponse {
  return response.success === false;
}

/**
 * Extract data type from success response
 */
export type ExtractData<T> = T extends ApiSuccessResponse<infer D> ? D : never;

/**
 * Generic list query parameters
 */
export interface BaseListQuery {
  page?: number;
  limit?: number;
  sort?: string;
}

/**
 * Generic date range query parameters
 */
export interface DateRangeQuery {
  start_date?: string;
  end_date?: string;
}

// ============================================================================
// MAINTENANCE FORECAST TYPES
// ============================================================================

/**
 * Query parameters for maintenance forecast
 */
export interface MaintenanceForecastQuery {
  /** Number of days to look ahead (default: 7) */
  days_ahead?: number;
  /** Severity threshold filter */
  severity_threshold?: 'critical' | 'warning' | 'all';
  /** Filter by building */
  building_id?: string;
  /** Filter by floor */
  floor?: number;
}

/**
 * Maintenance forecast response
 */
export interface MaintenanceForecastResponse {
  /** Critical devices requiring immediate attention */
  critical: DeviceV2Response[];
  /** Warning devices requiring attention soon */
  warning: DeviceV2Response[];
  /** Watch devices to monitor */
  watch: DeviceV2Response[];
  /** Summary statistics */
  summary: {
    total_at_risk: number;
    critical_count: number;
    warning_count: number;
    watch_count: number;
    avg_battery_all: number | null;
    maintenance_overdue: DeviceV2Response[];
  };
  /** Applied filters */
  filters_applied: {
    days_ahead: number;
    building_id: string | null;
    floor: number | null;
  };
}

// ============================================================================
// TEMPERATURE CORRELATION TYPES
// ============================================================================

/**
 * Query parameters for temperature correlation
 */
export interface TemperatureCorrelationQuery {
  /** Device ID to analyze */
  device_id: string;
  /** Number of hours to look back (default: 24, max: 168) */
  hours?: number;
  /** Device temperature threshold in Celsius (default: 80) */
  device_temp_threshold?: number;
  /** Ambient temperature threshold in Celsius (default: 30) */
  ambient_temp_threshold?: number;
}

/**
 * Temperature diagnosis type
 */
export type TemperatureDiagnosis = 'device_failure' | 'environmental' | 'normal';

/**
 * Temperature data point
 */
export interface TemperatureDataPoint {
  timestamp: string;
  value: number;
}

/**
 * Threshold breach record
 */
export interface ThresholdBreach {
  timestamp: string;
  device_temp: number;
  ambient_temp: number;
}

/**
 * Temperature correlation response
 */
export interface TemperatureCorrelationResponse {
  /** Device ID analyzed */
  device_id: string;
  /** Device temperature time series */
  device_temp_series: TemperatureDataPoint[];
  /** Ambient temperature time series */
  ambient_temp_series: TemperatureDataPoint[];
  /** Pearson correlation coefficient (-1 to 1) */
  correlation_score: number | null;
  /** Diagnosis result */
  diagnosis: TemperatureDiagnosis;
  /** Human-readable diagnosis explanation */
  diagnosis_explanation: string;
  /** Temperature threshold breaches */
  threshold_breaches: ThresholdBreach[];
  /** Number of data points in device series */
  data_points: number;
  /** Number of data points with ambient temperature */
  ambient_data_points: number;
  /** Time range analyzed */
  time_range: {
    start: string;
    end: string;
  };
  /** Current readings */
  current_readings: {
    device_temp: number;
    ambient_temp: number | null;
    timestamp: string;
  };
}
