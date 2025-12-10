import { z } from 'zod';
import {
  serialNumberSchema,
  manufacturerSchema,
  modelNameSchema,
  firmwareVersionSchema,
  thresholdSchema,
  samplingIntervalSchema,
  futureDateSchema,
  pastDateSchema,
  buildingIdSchema,
  floorSchema,
  roomNameSchema,
  coordinatesSchema,
  zoneSchema,
  tagsSchema,
  departmentSchema,
  costCenterSchema,
  userIdentifierSchema,
  batteryLevelSchema,
  signalStrengthSchema,
  errorCodeSchema,
  errorMessageSchema,
  retentionDaysSchema,
  paginationSchema,
  dateRangeSchema,
  createSortSchema,
  deviceIdSchema,
} from '../common.validation';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Device status enum
 */
export const deviceStatusSchema = z.enum([
  'active',
  'maintenance',
  'offline',
  'decommissioned',
  'error',
]);

/**
 * Device type enum (for sensors)
 */
export const deviceTypeSchema = z.enum([
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
]);

/**
 * Data classification enum for compliance
 */
export const dataClassificationSchema = z.enum([
  'public',
  'internal',
  'confidential',
  'restricted',
]);

// ============================================================================
// NESTED SCHEMAS
// ============================================================================

/**
 * Device configuration schema
 */
export const deviceConfigurationSchema = z.object({
  threshold_warning: thresholdSchema.describe('Warning threshold value'),
  threshold_critical: thresholdSchema.describe('Critical threshold value'),
  sampling_interval: samplingIntervalSchema.default(60).describe('Sampling interval in seconds'),
  calibration_date: futureDateSchema.optional().describe('Last calibration date'),
  calibration_offset: z.number().default(0).describe('Calibration offset value'),
});

/**
 * Device location schema
 */
export const deviceLocationSchema = z.object({
  building_id: buildingIdSchema,
  floor: floorSchema,
  room_name: roomNameSchema,
  coordinates: coordinatesSchema,
  zone: zoneSchema,
});

/**
 * Device metadata schema (operational)
 */
export const deviceMetadataSchema = z.object({
  tags: tagsSchema,
  department: departmentSchema,
  cost_center: costCenterSchema,
  warranty_expiry: futureDateSchema.optional().describe('Warranty expiration date'),
  last_maintenance: pastDateSchema.optional().describe('Last maintenance date'),
  next_maintenance: futureDateSchema.optional().describe('Next scheduled maintenance date'),
});

/**
 * Device audit trail schema
 */
export const deviceAuditSchema = z.object({
  created_at: z.date().default(() => new Date()),
  created_by: userIdentifierSchema.default('sys-migration-agent'),
  updated_at: z.date().default(() => new Date()),
  updated_by: userIdentifierSchema.default('sys-migration-agent'),
  deleted_at: z.date().optional().describe('Soft delete timestamp'),
  deleted_by: userIdentifierSchema.optional().describe('User who deleted the device'),
});

/**
 * Last error schema for health monitoring
 */
export const lastErrorSchema = z.object({
  timestamp: z.date(),
  message: errorMessageSchema,
  code: errorCodeSchema,
});

/**
 * Device health schema
 */
export const deviceHealthSchema = z.object({
  last_seen: z.date().default(() => new Date()).describe('Last communication timestamp'),
  uptime_percentage: z.number().min(0).max(100).default(100).describe('Calculated uptime percentage'),
  error_count: z.number().int().min(0).default(0).describe('Total error count'),
  last_error: lastErrorSchema.optional().describe('Most recent error details'),
  battery_level: batteryLevelSchema.optional().describe('Battery level (for battery-powered devices)'),
  signal_strength: signalStrengthSchema.optional().describe('Signal strength'),
});

/**
 * Device compliance schema
 */
export const deviceComplianceSchema = z.object({
  requires_encryption: z.boolean().default(false).describe('Whether device data requires encryption'),
  data_classification: dataClassificationSchema.default('internal').describe('Data classification level'),
  retention_days: retentionDaysSchema.default(90).describe('Data retention period in days'),
});

// ============================================================================
// DEVICE CREATION SCHEMA (POST)
// ============================================================================

/**
 * Schema for creating a new device (POST /api/v2/devices)
 */
export const createDeviceSchema = z.object({
  // Required identification fields
  _id: deviceIdSchema.describe('Custom device ID (e.g., "device_001")'),
  serial_number: serialNumberSchema,
  manufacturer: manufacturerSchema,
  model: modelNameSchema,
  firmware_version: firmwareVersionSchema,
  type: deviceTypeSchema,
  
  // Required configuration
  configuration: deviceConfigurationSchema,
  
  // Required location
  location: deviceLocationSchema,
  
  // Optional metadata with defaults
  metadata: deviceMetadataSchema.optional().default({
    tags: [],
    department: 'unknown',
  }),
  
  // Status (defaults to active)
  status: deviceStatusSchema.default('active'),
  status_reason: z.string().max(200, 'Status reason must be 200 characters or less').optional(),
  
  // Optional compliance (with defaults)
  compliance: deviceComplianceSchema.optional().default({
    requires_encryption: false,
    data_classification: 'internal',
    retention_days: 90,
  }),
  
  // Health will be auto-initialized on creation
  health: deviceHealthSchema.optional(),
  
  // Audit will be auto-populated
  audit: deviceAuditSchema.optional(),
});

// ============================================================================
// DEVICE UPDATE SCHEMA (PATCH)
// ============================================================================

/**
 * Schema for updating a device (PATCH /api/v2/devices/:id)
 * All fields are optional
 */
export const updateDeviceSchema = z
  .object({
    // Identification fields (some may be updatable)
    serial_number: serialNumberSchema.optional(),
    manufacturer: manufacturerSchema.optional(),
    model: modelNameSchema.optional(),
    firmware_version: firmwareVersionSchema.optional(),
    
    // Configuration updates
    configuration: deviceConfigurationSchema.partial().optional(),
    
    // Location updates
    location: deviceLocationSchema.partial().optional(),
    
    // Metadata updates
    metadata: deviceMetadataSchema.partial().optional(),
    
    // Status transition
    status: deviceStatusSchema.optional(),
    status_reason: z.string().max(200).optional(),
    
    // Compliance updates
    compliance: deviceComplianceSchema.partial().optional(),
    
    // Health updates (usually system-managed, but can be manually set)
    health: deviceHealthSchema.partial().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    'At least one field must be provided for update'
  );

// ============================================================================
// DEVICE QUERY SCHEMAS (GET)
// ============================================================================

/**
 * Device sort fields
 */
const deviceSortFields = [
  'created_at',
  'updated_at',
  'last_seen',
  'serial_number',
  'status',
  'floor',
  'building_id',
  'manufacturer',
  'uptime_percentage',
  'battery_level',
] as const;

/**
 * Schema for device list query parameters (GET /api/v2/devices)
 */
export const listDevicesQuerySchema = z
  .object({
    // Pagination
    ...paginationSchema.shape,
    
    // Sorting
    ...createSortSchema(deviceSortFields).shape,
    
    // Filtering by status
    status: z
      .union([
        deviceStatusSchema,
        z.array(deviceStatusSchema),
        z.string().transform((val) => val.split(',') as z.infer<typeof deviceStatusSchema>[]),
      ])
      .optional(),
    
    // Filtering by type
    type: z
      .union([
        deviceTypeSchema,
        z.array(deviceTypeSchema),
        z.string().transform((val) => val.split(',') as z.infer<typeof deviceTypeSchema>[]),
      ])
      .optional(),
    
    // Location filters
    building_id: buildingIdSchema.optional(),
    floor: z.union([floorSchema, z.string().transform((v) => parseInt(v, 10))]).optional(),
    zone: zoneSchema,
    
    // Metadata filters
    department: departmentSchema.optional(),
    tags: z
      .union([
        z.array(z.string()),
        z.string().transform((val) => val.split(',')),
      ])
      .optional(),
    manufacturer: manufacturerSchema.optional(),
    
    // Health filters
    min_battery: z.union([z.number(), z.string().transform((v) => parseInt(v, 10))]).optional(),
    max_battery: z.union([z.number(), z.string().transform((v) => parseInt(v, 10))]).optional(),
    offline_threshold_minutes: z
      .union([z.number(), z.string().transform((v) => parseInt(v, 10))])
      .default(5)
      .describe('Consider device offline if last_seen is older than this many minutes'),
    
    // Soft delete filter
    include_deleted: z
      .union([z.boolean(), z.string().transform((v) => v === 'true')])
      .default(false),
    only_deleted: z
      .union([z.boolean(), z.string().transform((v) => v === 'true')])
      .default(false),
    
    // Date range for created_at or updated_at
    ...dateRangeSchema.shape,
    date_filter_field: z.enum(['created_at', 'updated_at', 'last_seen']).optional(),
    
    // Field projection
    fields: z
      .string()
      .transform((val) => val.split(','))
      .optional()
      .describe('Comma-separated list of fields to include'),
    
    // Search
    search: z.string().max(100).optional().describe('Search in serial_number, room_name, or tags'),
  })
  .refine(
    (data) => !(data.include_deleted && data.only_deleted),
    'Cannot use both include_deleted and only_deleted'
  );

/**
 * Schema for single device query (GET /api/v2/devices/:id)
 */
export const getDeviceQuerySchema = z.object({
  // Field projection
  fields: z
    .string()
    .transform((val) => val.split(','))
    .optional(),
  
  // Include related data
  include_recent_readings: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .default(false),
  readings_limit: z
    .union([z.number(), z.string().transform((v) => parseInt(v, 10))])
    .default(10),
});

/**
 * Schema for device history query (GET /api/v2/devices/:id/history)
 */
export const deviceHistoryQuerySchema = z.object({
  // Pagination
  ...paginationSchema.shape,
  
  // Date range
  ...dateRangeSchema.shape,
  
  // Filter by action type
  action: z.enum(['created', 'updated', 'deleted']).optional(),
  
  // Filter by user
  user: userIdentifierSchema.optional(),
});

// ============================================================================
// DEVICE ID PARAM SCHEMA
// ============================================================================

/**
 * Schema for device ID path parameter
 */
export const deviceIdParamSchema = z.object({
  id: deviceIdSchema,
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type DeviceType = z.infer<typeof deviceTypeSchema>;
export type DataClassification = z.infer<typeof dataClassificationSchema>;
export type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>;
export type DeviceLocation = z.infer<typeof deviceLocationSchema>;
export type DeviceMetadata = z.infer<typeof deviceMetadataSchema>;
export type DeviceAudit = z.infer<typeof deviceAuditSchema>;
export type DeviceHealth = z.infer<typeof deviceHealthSchema>;
export type DeviceCompliance = z.infer<typeof deviceComplianceSchema>;
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;
export type GetDeviceQuery = z.infer<typeof getDeviceQuerySchema>;
export type DeviceHistoryQuery = z.infer<typeof deviceHistoryQuerySchema>;
