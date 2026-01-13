import mongoose, { Schema, type Document, type Model } from 'mongoose';

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

/**
 * Device configuration interface
 */
export interface IDeviceConfiguration {
  threshold_warning: number;
  threshold_critical: number;
  sampling_interval: number; // in seconds
  calibration_date: Date | null;
  calibration_offset: number;
}

/**
 * Device coordinates interface
 */
export interface IDeviceCoordinates {
  x: number;
  y: number;
  z?: number;
}

/**
 * Device location interface
 */
export interface IDeviceLocation {
  building_id: string;
  floor: number;
  room_name: string;
  coordinates?: IDeviceCoordinates;
  zone?: string;
}

/**
 * Device operational metadata interface
 */
export interface IDeviceMetadata {
  tags: string[];
  department: string;
  cost_center?: string;
  warranty_expiry?: Date;
  last_maintenance?: Date;
  next_maintenance?: Date;
}

/**
 * Device audit trail interface
 */
export interface IDeviceAudit {
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at?: Date;
  deleted_by?: string;
}

/**
 * Device last error interface
 */
export interface IDeviceLastError {
  timestamp: Date;
  message: string;
  code: string;
}

/**
 * Device health interface
 */
export interface IDeviceHealth {
  last_seen: Date;
  uptime_percentage: number;
  error_count: number;
  last_error?: IDeviceLastError;
  battery_level?: number;
  signal_strength?: number;
}

/**
 * Device compliance interface
 */
export interface IDeviceCompliance {
  requires_encryption: boolean;
  data_classification: 'public' | 'internal' | 'confidential' | 'restricted';
  retention_days: number;
}

/**
 * Device status type
 */
export type DeviceStatus = 'active' | 'maintenance' | 'offline' | 'decommissioned' | 'error';

/**
 * Device type (sensor types)
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
  | 'vibration'
  | 'voltage'
  | 'current'
  | 'energy';

/**
 * Main DeviceV2 interface
 * Note: Uses 'device_model' instead of 'model' to avoid conflict with Mongoose Document
 */
export interface IDeviceV2 {
  _id: string; // Custom ID like "device_001"
  serial_number: string;
  manufacturer: string;
  device_model: string; // Renamed from 'model' to avoid Mongoose conflict
  firmware_version: string;
  type: DeviceType;
  configuration: IDeviceConfiguration;
  location: IDeviceLocation;
  metadata: IDeviceMetadata;
  audit: IDeviceAudit;
  health: IDeviceHealth;
  status: DeviceStatus;
  status_reason?: string;
  compliance: IDeviceCompliance;
}

// ============================================================================
// MONGOOSE SCHEMA
// ============================================================================

/**
 * Coordinates sub-schema
 */
const CoordinatesSchema = new Schema<IDeviceCoordinates>(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    z: { type: Number },
  },
  { _id: false }
);

/**
 * Configuration sub-schema
 */
const ConfigurationSchema = new Schema<IDeviceConfiguration>(
  {
    threshold_warning: { type: Number, required: true },
    threshold_critical: { type: Number, required: true },
    sampling_interval: { type: Number, default: 60 }, // Default 60 seconds
    calibration_date: { type: Date, default: null },
    calibration_offset: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Location sub-schema
 */
const LocationSchema = new Schema<IDeviceLocation>(
  {
    building_id: { type: String, required: true },
    floor: { type: Number, required: true },
    room_name: { type: String, required: true },
    coordinates: { type: CoordinatesSchema },
    zone: { type: String },
  },
  { _id: false }
);

/**
 * Metadata sub-schema
 */
const MetadataSchema = new Schema<IDeviceMetadata>(
  {
    tags: { type: [String], default: [] },
    department: { type: String, default: 'unknown' },
    cost_center: { type: String },
    warranty_expiry: { type: Date },
    last_maintenance: { type: Date },
    next_maintenance: { type: Date },
  },
  { _id: false }
);

/**
 * Audit trail sub-schema
 */
const AuditSchema = new Schema<IDeviceAudit>(
  {
    created_at: { type: Date, default: () => new Date() },
    created_by: { type: String, default: 'sys-migration-agent' },
    updated_at: { type: Date, default: () => new Date() },
    updated_by: { type: String, default: 'sys-migration-agent' },
    deleted_at: { type: Date },
    deleted_by: { type: String },
  },
  { _id: false }
);

/**
 * Last error sub-schema
 */
const LastErrorSchema = new Schema<IDeviceLastError>(
  {
    timestamp: { type: Date, required: true },
    message: { type: String, required: true },
    code: { type: String, required: true },
  },
  { _id: false }
);

/**
 * Health sub-schema
 */
const HealthSchema = new Schema<IDeviceHealth>(
  {
    last_seen: { type: Date, default: () => new Date() },
    uptime_percentage: { type: Number, default: 100, min: 0, max: 100 },
    error_count: { type: Number, default: 0, min: 0 },
    last_error: { type: LastErrorSchema },
    battery_level: { type: Number, min: 0, max: 100 },
    signal_strength: { type: Number },
  },
  { _id: false }
);

/**
 * Compliance sub-schema
 */
const ComplianceSchema = new Schema<IDeviceCompliance>(
  {
    requires_encryption: { type: Boolean, default: false },
    data_classification: {
      type: String,
      enum: ['public', 'internal', 'confidential', 'restricted'],
      default: 'internal',
    },
    retention_days: { type: Number, default: 90, min: 1 },
  },
  { _id: false }
);

/**
 * Main DeviceV2 Schema
 */
const DeviceV2Schema = new Schema<IDeviceV2>(
  {
    _id: { type: String, required: true },
    serial_number: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    manufacturer: { type: String, required: true },
    device_model: { type: String, required: true }, // Renamed from 'model'
    firmware_version: { type: String, required: true },
    type: {
      type: String,
      enum: [
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
      ],
      required: true,
    },
    configuration: {
      type: ConfigurationSchema,
      required: true,
    },
    location: {
      type: LocationSchema,
      required: true,
    },
    metadata: {
      type: MetadataSchema,
      default: () => ({ tags: [], department: 'unknown' }),
    },
    audit: {
      type: AuditSchema,
      default: () => ({}),
    },
    health: {
      type: HealthSchema,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: ['active', 'maintenance', 'offline', 'decommissioned', 'error'],
      default: 'active',
    },
    status_reason: { type: String },
    compliance: {
      type: ComplianceSchema,
      default: () => ({}),
    },
  },
  {
    collection: 'devices_v2',
    // Disable Mongoose timestamps since we manage them via audit fields
    timestamps: false,
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// Compound index for location-based queries
DeviceV2Schema.index({ 'location.building_id': 1, 'location.floor': 1 });

// Index for status filtering
DeviceV2Schema.index({ status: 1 });

// Index for health monitoring (last_seen for offline detection)
DeviceV2Schema.index({ 'health.last_seen': 1 });

// Index for soft delete queries
DeviceV2Schema.index({ 'audit.deleted_at': 1 });

// Index for department filtering
DeviceV2Schema.index({ 'metadata.department': 1 });

// Index for manufacturer filtering
DeviceV2Schema.index({ manufacturer: 1 });

// Compound index for common queries: status + type
DeviceV2Schema.index({ status: 1, type: 1 });

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Pre-save middleware to update audit.updated_at
 * Mongoose 9+ uses async middleware without next callback
 */
DeviceV2Schema.pre('save', function () {
  if (!this.isNew) this.audit.updated_at = new Date();
});

/**
 * Pre-findOneAndUpdate middleware to update audit.updated_at
 */
DeviceV2Schema.pre('findOneAndUpdate', function () {
  this.set({ 'audit.updated_at': new Date() });
});

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Find all non-deleted devices
 */
DeviceV2Schema.statics.findActive = function (filter = {}) {
  return this.find({ ...filter, 'audit.deleted_at': { $exists: false } });
};

/**
 * Find only soft-deleted devices
 */
DeviceV2Schema.statics.findDeleted = function (filter = {}) {
  return this.find({ ...filter, 'audit.deleted_at': { $exists: true } });
};

/**
 * Soft delete a device
 */
DeviceV2Schema.statics.softDelete = async function (
  id: string,
  deletedBy: string = 'sys-migration-agent'
) {
  return this.findByIdAndUpdate(
    id,
    {
      $set: {
        'audit.deleted_at': new Date(),
        'audit.deleted_by': deletedBy,
        status: 'decommissioned',
      },
    },
    { new: true }
  );
};

/**
 * Restore a soft-deleted device
 */
DeviceV2Schema.statics.restore = async function (id: string) {
  return this.findByIdAndUpdate(
    id,
    {
      $unset: {
        'audit.deleted_at': 1,
        'audit.deleted_by': 1,
      },
      $set: {
        status: 'offline', // Set to offline after restore, needs manual activation
      },
    },
    { new: true }
  );
};

// ============================================================================
// INTERFACE FOR STATIC METHODS
// ============================================================================

export interface IDeviceV2Model extends Model<IDeviceV2> {
  findActive(filter?: Record<string, unknown>): ReturnType<Model<IDeviceV2>['find']>;
  findDeleted(filter?: Record<string, unknown>): ReturnType<Model<IDeviceV2>['find']>;
  softDelete(id: string, deletedBy?: string): Promise<(IDeviceV2 & Document) | null>;
  restore(id: string): Promise<(IDeviceV2 & Document) | null>;
}

// ============================================================================
// MODEL EXPORT
// ============================================================================

/**
 * DeviceV2 Model
 * Collection: devices_v2
 */
const DeviceV2 =
  (mongoose.models.DeviceV2 as unknown as IDeviceV2Model) ||
  mongoose.model<IDeviceV2, IDeviceV2Model>('DeviceV2', DeviceV2Schema);

export default DeviceV2;
