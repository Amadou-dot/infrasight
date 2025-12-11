/**
 * V1 to V2 Data Mapper
 *
 * Provides mapping functions to convert v1 data structures to v2 format.
 * Used during migration and dual-write operations.
 *
 * Default Values Strategy:
 * - Numbers: null (when unknown/missing)
 * - Strings: "unknown" (when unknown/missing)
 * - Audit created_by: "sys-migration-agent"
 */

import type { IDevice } from '../../models/Device';
import type { IReading } from '../../models/Reading';

// ============================================================================
// TYPES
// ============================================================================

/**
 * V1 Device type (from IDevice)
 */
export type DeviceV1 = IDevice;

/**
 * V1 Reading type (from IReading)
 */
export type ReadingV1 = IReading;

/**
 * V2 Device configuration
 */
interface DeviceV2Configuration {
  threshold_warning: number;
  threshold_critical: number;
  sampling_interval: number;
  calibration_date: Date | null;
  calibration_offset: number;
}

/**
 * V2 Device location
 */
interface DeviceV2Location {
  building_id: string;
  floor: number;
  room_name: string;
  coordinates?: { x: number; y: number; z?: number };
  zone?: string;
}

/**
 * V2 Device metadata
 */
interface DeviceV2Metadata {
  tags: string[];
  department: string;
  cost_center?: string;
  warranty_expiry?: Date;
  last_maintenance?: Date;
  next_maintenance?: Date;
}

/**
 * V2 Device audit
 */
interface DeviceV2Audit {
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at?: Date;
  deleted_by?: string;
}

/**
 * V2 Device health
 */
interface DeviceV2Health {
  last_seen: Date;
  uptime_percentage: number;
  error_count: number;
  last_error?: { timestamp: Date; message: string; code: string };
  battery_level?: number;
  signal_strength?: number;
}

/**
 * V2 Device compliance
 */
interface DeviceV2Compliance {
  requires_encryption: boolean;
  data_classification: 'public' | 'internal' | 'confidential' | 'restricted';
  retention_days: number;
}

/**
 * Mapped V2 Device (plain object for insertion)
 */
export interface MappedDeviceV2 {
  _id: string;
  serial_number: string;
  manufacturer: string;
  device_model: string;
  firmware_version: string;
  type:
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
  configuration: DeviceV2Configuration;
  location: DeviceV2Location;
  metadata: DeviceV2Metadata;
  audit: DeviceV2Audit;
  health: DeviceV2Health;
  status: 'active' | 'maintenance' | 'offline' | 'decommissioned' | 'error';
  status_reason?: string;
  compliance: DeviceV2Compliance;
}

/**
 * V2 Reading metadata
 */
interface ReadingV2Metadata {
  device_id: string;
  type:
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
  unit: string;
  source: 'sensor' | 'simulation' | 'manual' | 'calibration';
}

/**
 * V2 Reading quality
 */
interface ReadingV2Quality {
  is_valid: boolean;
  confidence_score?: number;
  validation_flags?: string[];
  is_anomaly: boolean;
  anomaly_score?: number;
}

/**
 * V2 Reading context
 */
interface ReadingV2Context {
  battery_level?: number;
  signal_strength?: number;
  ambient_temp?: number;
}

/**
 * V2 Reading processing
 */
interface ReadingV2Processing {
  raw_value?: number;
  calibration_offset?: number;
  ingested_at: Date;
}

/**
 * Mapped V2 Reading (plain object for insertion)
 */
export interface MappedReadingV2 {
  metadata: ReadingV2Metadata;
  timestamp: Date;
  value: number;
  quality: ReadingV2Quality;
  context?: ReadingV2Context;
  processing: ReadingV2Processing;
}

// ============================================================================
// UNIT MAPPING
// ============================================================================

/**
 * Map reading type to appropriate unit
 */
export function getUnitForType(
  type: string
): 'celsius' | 'percent' | 'count' | 'watts' | 'unknown' {
  switch (type) {
    case 'temperature':
      return 'celsius';
    case 'humidity':
      return 'percent';
    case 'occupancy':
      return 'count';
    case 'power':
      return 'watts';
    default:
      return 'unknown';
  }
}

// ============================================================================
// DEVICE MAPPER
// ============================================================================

/**
 * Map a V1 Device to V2 Device structure
 *
 * V1 Device has:
 * - _id, building_id, floor, room_name, type, status, install_date, configuration
 *
 * V2 Device adds:
 * - serial_number, manufacturer, device_model, firmware_version
 * - location (nested), metadata (tags, department), audit, health, compliance
 *
 * @param v1Device - The v1 device document
 * @param options - Optional overrides for migration
 * @returns V2 device structure ready for insertion
 */
export function mapDeviceV1toV2(
  v1Device: DeviceV1,
  options: {
    created_by?: string;
    serial_number?: string;
    manufacturer?: string;
  } = {}
): MappedDeviceV2 {
  const now = new Date();
  const createdBy = options.created_by || 'sys-migration-agent';

  return {
    // Identification
    _id: v1Device._id,
    serial_number: options.serial_number || `SN-${v1Device._id}`,
    manufacturer: options.manufacturer || 'unknown',
    device_model: 'unknown',
    firmware_version: 'unknown',
    type: v1Device.type as MappedDeviceV2['type'],

    // Configuration (map existing fields)
    configuration: {
      threshold_warning: v1Device.configuration.threshold_warning,
      threshold_critical: v1Device.configuration.threshold_critical,
      sampling_interval: 60, // Default: 1 minute
      calibration_date: null,
      calibration_offset: 0,
    },

    // Location (restructure from flat to nested)
    location: {
      building_id: v1Device.building_id,
      floor: v1Device.floor,
      room_name: v1Device.room_name,
      coordinates: undefined,
      zone: undefined,
    },

    // Metadata (new fields with defaults)
    metadata: {
      tags: [],
      department: 'unknown',
      cost_center: undefined,
      warranty_expiry: undefined,
      last_maintenance: undefined,
      next_maintenance: undefined,
    },

    // Audit (new section)
    audit: {
      created_at: v1Device.install_date || now,
      created_by: createdBy,
      updated_at: now,
      updated_by: createdBy,
      deleted_at: undefined,
      deleted_by: undefined,
    },

    // Health (new section with defaults)
    health: {
      last_seen: now,
      uptime_percentage: 100,
      error_count: 0,
      last_error: undefined,
      battery_level: undefined,
      signal_strength: undefined,
    },

    // Status (map directly, add 'decommissioned' and 'error' as new options)
    status: v1Device.status as MappedDeviceV2['status'],
    status_reason: undefined,

    // Compliance (new section with defaults)
    compliance: {
      requires_encryption: false,
      data_classification: 'internal',
      retention_days: 90,
    },
  };
}

// ============================================================================
// READING MAPPER
// ============================================================================

/**
 * Map a V1 Reading to V2 Reading structure
 *
 * V1 Reading has:
 * - metadata: { device_id, type }
 * - timestamp, value
 *
 * V2 Reading adds:
 * - metadata: { unit, source }
 * - quality: { is_valid, confidence_score, validation_flags, is_anomaly, anomaly_score }
 * - context: { battery_level, signal_strength, ambient_temp }
 * - processing: { raw_value, calibration_offset, ingested_at }
 *
 * @param v1Reading - The v1 reading document
 * @param options - Optional overrides for migration
 * @returns V2 reading structure ready for insertion
 */
export function mapReadingV1toV2(
  v1Reading: ReadingV1,
  options: {
    source?: 'sensor' | 'simulation' | 'manual' | 'calibration';
    confidence_score?: number;
  } = {}
): Omit<MappedReadingV2, '_id'> {
  const now = new Date();
  const unit = getUnitForType(v1Reading.metadata.type);
  const source = options.source || 'sensor';

  return {
    // Metadata (enhanced with unit and source)
    metadata: {
      device_id: v1Reading.metadata.device_id,
      type: v1Reading.metadata.type as ReadingV2Metadata['type'],
      unit,
      source,
    },

    // Core data (unchanged)
    timestamp: v1Reading.timestamp,
    value: v1Reading.value,

    // Quality (new section with defaults for migrated data)
    quality: {
      is_valid: true, // Assume v1 readings are valid
      confidence_score: options.confidence_score ?? 0.95, // High confidence for migrated data
      validation_flags: [],
      is_anomaly: false,
      anomaly_score: undefined,
    },

    // Context (new section, unknown for migrated data)
    context: {
      battery_level: undefined,
      signal_strength: undefined,
      ambient_temp: undefined,
    },

    // Processing (new section)
    processing: {
      raw_value: v1Reading.value, // Original value is the raw value
      calibration_offset: 0, // No calibration applied
      ingested_at: now,
    },
  };
}

// ============================================================================
// BATCH MAPPERS
// ============================================================================

/**
 * Map an array of V1 devices to V2 format
 *
 * @param v1Devices - Array of v1 device documents
 * @param options - Optional overrides for migration
 * @returns Array of V2 device structures
 */
export function mapDevicesV1toV2(
  v1Devices: DeviceV1[],
  options: {
    created_by?: string;
  } = {}
): MappedDeviceV2[] {
  return v1Devices.map(device => mapDeviceV1toV2(device, options));
}

/**
 * Map an array of V1 readings to V2 format
 *
 * @param v1Readings - Array of v1 reading documents
 * @param options - Optional overrides for migration
 * @returns Array of V2 reading structures
 */
export function mapReadingsV1toV2(
  v1Readings: ReadingV1[],
  options: {
    source?: 'sensor' | 'simulation' | 'manual' | 'calibration';
  } = {}
): Omit<MappedReadingV2, '_id'>[] {
  return v1Readings.map(reading => mapReadingV1toV2(reading, options));
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate that a V1 device has all required fields for migration
 */
export function validateDeviceV1ForMigration(device: Partial<DeviceV1>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!device._id) errors.push('Missing _id');
  if (!device.building_id) errors.push('Missing building_id');
  if (device.floor === undefined) errors.push('Missing floor');
  if (!device.room_name) errors.push('Missing room_name');
  if (!device.type) errors.push('Missing type');
  if (!device.configuration) errors.push('Missing configuration');
  else {
    if (device.configuration.threshold_warning === undefined)
      errors.push('Missing configuration.threshold_warning');

    if (device.configuration.threshold_critical === undefined)
      errors.push('Missing configuration.threshold_critical');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a V1 reading has all required fields for migration
 */
export function validateReadingV1ForMigration(reading: Partial<ReadingV1>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!reading.metadata) errors.push('Missing metadata');
  else {
    if (!reading.metadata.device_id) errors.push('Missing metadata.device_id');

    if (!reading.metadata.type) errors.push('Missing metadata.type');
  }
  if (!reading.timestamp) errors.push('Missing timestamp');

  if (reading.value === undefined) errors.push('Missing value');

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// EXPORT
// ============================================================================

const V1toV2Mapper = {
  mapDeviceV1toV2,
  mapReadingV1toV2,
  mapDevicesV1toV2,
  mapReadingsV1toV2,
  validateDeviceV1ForMigration,
  validateReadingV1ForMigration,
  getUnitForType,
};

export default V1toV2Mapper;
