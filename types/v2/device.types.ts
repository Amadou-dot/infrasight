/**
 * TypeScript Type Definitions for DeviceV2 Model
 *
 * These types provide type-safe access to DeviceV2 documents and API interactions.
 * Types align with:
 * - Mongoose model: /models/v2/DeviceV2.ts
 * - Zod schemas: /lib/validations/v2/device.validation.ts
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Device operational status
 */
export type DeviceStatus =
  | 'active'
  | 'maintenance'
  | 'offline'
  | 'decommissioned'
  | 'error';

/**
 * Device/sensor type
 */
export type DeviceType =
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
  | 'vibration';

/**
 * Data classification for compliance
 */
export type DataClassification =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted';

// ============================================================================
// NESTED INTERFACES
// ============================================================================

/**
 * Device configuration settings
 */
export interface DeviceConfiguration {
  /** Warning threshold value */
  threshold_warning: number;
  /** Critical threshold value */
  threshold_critical: number;
  /** Sampling interval in seconds (default: 60) */
  sampling_interval: number;
  /** Last calibration date */
  calibration_date: Date | null;
  /** Calibration offset value */
  calibration_offset: number;
}

/**
 * Device physical coordinates
 */
export interface DeviceCoordinates {
  x: number;
  y: number;
  z?: number;
}

/**
 * Device location information
 */
export interface DeviceLocation {
  /** Building identifier */
  building_id: string;
  /** Floor number (1-indexed) */
  floor: number;
  /** Room name/identifier */
  room_name: string;
  /** Optional coordinates within the room */
  coordinates?: DeviceCoordinates;
  /** Optional zone designation */
  zone?: string;
}

/**
 * Device operational metadata
 */
export interface DeviceMetadata {
  /** Categorization tags */
  tags: string[];
  /** Department responsible for device */
  department: string;
  /** Cost center for billing */
  cost_center?: string;
  /** Warranty expiration date */
  warranty_expiry?: Date;
  /** Last maintenance date */
  last_maintenance?: Date;
  /** Next scheduled maintenance date */
  next_maintenance?: Date;
}

/**
 * Device audit trail information
 */
export interface DeviceAudit {
  /** Creation timestamp */
  created_at: Date;
  /** User/system that created the device */
  created_by: string;
  /** Last update timestamp */
  updated_at: Date;
  /** User/system that last updated the device */
  updated_by: string;
  /** Soft delete timestamp (if deleted) */
  deleted_at?: Date;
  /** User/system that deleted the device */
  deleted_by?: string;
}

/**
 * Last error information for health monitoring
 */
export interface DeviceLastError {
  /** Error timestamp */
  timestamp: Date;
  /** Error message */
  message: string;
  /** Error code */
  code: string;
}

/**
 * Device health monitoring data
 */
export interface DeviceHealth {
  /** Last communication timestamp */
  last_seen: Date;
  /** Calculated uptime percentage (0-100) */
  uptime_percentage: number;
  /** Total error count */
  error_count: number;
  /** Most recent error details */
  last_error?: DeviceLastError;
  /** Battery level percentage (0-100), for battery-powered devices */
  battery_level?: number;
  /** Signal strength (0-100) */
  signal_strength?: number;
}

/**
 * Device compliance configuration
 */
export interface DeviceCompliance {
  /** Whether device data requires encryption */
  requires_encryption: boolean;
  /** Data classification level */
  data_classification: DataClassification;
  /** Data retention period in days (default: 90) */
  retention_days: number;
}

// ============================================================================
// MAIN DOCUMENT INTERFACE
// ============================================================================

/**
 * Full DeviceV2 document interface (as stored in MongoDB)
 */
export interface DeviceV2Document {
  /** Custom device ID (e.g., "device_001") */
  _id: string;
  /** Unique serial number */
  serial_number: string;
  /** Device manufacturer */
  manufacturer: string;
  /** Device model name */
  device_model: string;
  /** Firmware version string */
  firmware_version: string;
  /** Sensor type */
  type: DeviceType;
  /** Configuration settings */
  configuration: DeviceConfiguration;
  /** Location information */
  location: DeviceLocation;
  /** Operational metadata */
  metadata: DeviceMetadata;
  /** Audit trail */
  audit: DeviceAudit;
  /** Health monitoring data */
  health: DeviceHealth;
  /** Operational status */
  status: DeviceStatus;
  /** Reason for current status */
  status_reason?: string;
  /** Compliance configuration */
  compliance: DeviceCompliance;
}

// ============================================================================
// INPUT/REQUEST TYPES
// ============================================================================

/**
 * Input for creating a new device (POST /api/v2/devices)
 *
 * Note: audit and health fields are auto-populated on creation
 */
export interface CreateDeviceInput {
  _id: string;
  serial_number: string;
  manufacturer: string;
  /** Maps to 'device_model' in database */
  model: string;
  firmware_version: string;
  type: DeviceType;
  configuration: {
    threshold_warning: number;
    threshold_critical: number;
    sampling_interval?: number;
    calibration_date?: Date | string;
    calibration_offset?: number;
  };
  location: {
    building_id: string;
    floor: number;
    room_name: string;
    coordinates?: DeviceCoordinates;
    zone?: string;
  };
  metadata?: {
    tags?: string[];
    department?: string;
    cost_center?: string;
    warranty_expiry?: Date | string;
    last_maintenance?: Date | string;
    next_maintenance?: Date | string;
  };
  status?: DeviceStatus;
  status_reason?: string;
  compliance?: {
    requires_encryption?: boolean;
    data_classification?: DataClassification;
    retention_days?: number;
  };
}

/**
 * Input for updating an existing device (PATCH /api/v2/devices/:id)
 *
 * All fields are optional - only provided fields will be updated
 */
export interface UpdateDeviceInput {
  serial_number?: string;
  manufacturer?: string;
  model?: string;
  firmware_version?: string;
  type?: DeviceType;
  configuration?: Partial<{
    threshold_warning: number;
    threshold_critical: number;
    sampling_interval: number;
    calibration_date: Date | string | null;
    calibration_offset: number;
  }>;
  location?: Partial<{
    building_id: string;
    floor: number;
    room_name: string;
    coordinates: DeviceCoordinates | null;
    zone: string | null;
  }>;
  metadata?: Partial<{
    tags: string[];
    department: string;
    cost_center: string | null;
    warranty_expiry: Date | string | null;
    last_maintenance: Date | string | null;
    next_maintenance: Date | string | null;
  }>;
  health?: Partial<{
    last_seen: Date | string;
    uptime_percentage: number;
    error_count: number;
    last_error: DeviceLastError | null;
    battery_level: number | null;
    signal_strength: number | null;
  }>;
  status?: DeviceStatus;
  status_reason?: string;
  compliance?: Partial<{
    requires_encryption: boolean;
    data_classification: DataClassification;
    retention_days: number;
  }>;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for listing devices (GET /api/v2/devices)
 */
export interface ListDevicesQuery {
  /** Page number (1-indexed) */
  page?: number;
  /** Items per page (max 100) */
  limit?: number;
  /** Filter by manufacturer */
  manufacturer?: string;
  /** Filter by status */
  status?: DeviceStatus;
  /** Filter by department */
  department?: string;
  /** Filter by tags (comma-separated) */
  tags?: string;
  /** Filter by building ID */
  building_id?: string;
  /** Filter by floor number */
  floor?: number;
  /** Filter by device type */
  type?: DeviceType;
  /** Comma-separated fields to include in response */
  fields?: string;
  /** Sort field and direction (e.g., "serial_number:asc") */
  sort?: string;
}

/**
 * Query parameters for device history (GET /api/v2/devices/:id/history)
 */
export interface DeviceHistoryQuery {
  /** Page number */
  page?: number;
  /** Items per page */
  limit?: number;
  /** Start date for history range */
  start_date?: string;
  /** End date for history range */
  end_date?: string;
  /** Filter by action type */
  action?: 'create' | 'update' | 'delete';
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Device response (API output format)
 * Converts internal field names to API-friendly names
 */
export interface DeviceV2Response {
  _id: string;
  serial_number: string;
  manufacturer: string;
  /** API returns 'model' instead of 'device_model' */
  model: string;
  firmware_version: string;
  type: DeviceType;
  configuration: DeviceConfiguration;
  location: DeviceLocation;
  metadata: DeviceMetadata;
  audit: DeviceAudit;
  health: DeviceHealth;
  status: DeviceStatus;
  status_reason?: string;
  compliance: DeviceCompliance;
}

/**
 * Paginated device list response
 */
export interface DeviceListResponse {
  devices: DeviceV2Response[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Device history entry
 */
export interface DeviceHistoryEntry {
  timestamp: Date;
  action: 'create' | 'update' | 'delete';
  user: string;
  changes: {
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[];
}

/**
 * Device history response
 */
export interface DeviceHistoryResponse {
  device_id: string;
  history: DeviceHistoryEntry[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
