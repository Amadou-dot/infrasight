/**
 * V2 Type Definitions Index
 *
 * Central export point for all V2 TypeScript types.
 *
 * Usage:
 * import { DeviceV2Document, ReadingV2Response, ApiSuccessResponse } from '@/types/v2';
 */

// ============================================================================
// DEVICE TYPES
// ============================================================================

export type {
  // Enums
  DeviceStatus,
  DeviceType,
  DataClassification,
  // Nested interfaces
  DeviceConfiguration,
  DeviceCoordinates,
  DeviceLocation,
  DeviceMetadata,
  DeviceAudit,
  DeviceLastError,
  DeviceHealth,
  DeviceCompliance,
  // Document types
  DeviceV2Document,
  // Input types
  CreateDeviceInput,
  UpdateDeviceInput,
  // Query types
  ListDevicesQuery,
  DeviceHistoryQuery,
  // Response types
  DeviceV2Response,
  DeviceListResponse,
  DeviceHistoryEntry,
  DeviceHistoryResponse,
} from './device.types';

// ============================================================================
// READING TYPES
// ============================================================================

export type {
  // Enums
  ReadingType,
  ReadingUnit,
  ReadingSource,
  // Nested interfaces
  ReadingMetadata,
  ReadingQuality,
  ReadingContext,
  ReadingProcessing,
  // Document types
  ReadingV2Document,
  // Input types
  CreateReadingInput,
  BulkReadingItem,
  BulkIngestReadingsInput,
  // Query types
  ListReadingsQuery,
  LatestReadingsQuery,
  // Response types
  ReadingV2Response,
  ReadingListResponse,
  LatestReadingResponse,
  LatestReadingsResponse,
  BulkIngestResponse,
  // Aggregation types
  AggregationGranularity,
  AggregationType,
  AggregatedReading,
  AggregationResponse,
} from './reading.types';

// ============================================================================
// API TYPES
// ============================================================================

export type {
  // Error types
  ErrorCode,
  HttpStatusCode,
  // Response types
  ApiSuccessResponse,
  ApiErrorResponse,
  ApiResponse,
  PaginatedResponse,
  CursorPaginatedResponse,
  // Rate limiting
  RateLimitInfo,
  RateLimitExceededResponse,
  // Analytics
  EnergyAnalyticsQuery,
  DeviceHealthSummary,
  HealthAnalyticsQuery,
  AnomalySummary,
  AnomalyAnalyticsQuery,
  MaintenanceForecastQuery,
  MaintenanceForecastResponse,
  TemperatureCorrelationQuery,
  TemperatureCorrelationResponse,
  TemperatureDiagnosis,
  TemperatureDataPoint,
  ThresholdBreach,
  // Metadata
  MetadataResponse,
  // Audit
  AuditLogEntry,
  AuditLogQuery,
  AuditLogResponse,
  // Reports
  ReportGenerateQuery,
  // Helpers
  ExtractData,
  BaseListQuery,
  DateRangeQuery,
} from './api.types';

// ============================================================================
// SCHEDULE TYPES
// ============================================================================

export type {
  // Enums
  ServiceType,
  ScheduleStatus,
  // Nested interfaces
  ScheduleAudit,
  // Document types
  ScheduleV2Document,
  // Input types
  CreateScheduleInput,
  UpdateScheduleInput,
  // Query types
  ListSchedulesQuery,
  // Response types
  ScheduleV2Response,
  BulkCreateScheduleResponse,
  ScheduleListResponse,
} from './schedule.types';

// Export type guards as values
export { isSuccessResponse, isErrorResponse } from './api.types';
