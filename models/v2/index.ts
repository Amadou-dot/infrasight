/**
 * V2 Models - Production-Ready MongoDB Models
 *
 * This module exports enhanced V2 models for the Expand-Contract migration pattern.
 * These models use separate collections (devices_v2, readings_v2) from V1 models.
 *
 * Collections:
 * - devices_v2: Enhanced device model with audit trails, health monitoring, compliance
 * - readings_v2: Timeseries collection with quality metrics and context
 */

// DeviceV2 Model and Types
export {
  default as DeviceV2,
  type IDeviceV2,
  type IDeviceV2Model,
  type IDeviceConfiguration,
  type IDeviceLocation,
  type IDeviceCoordinates,
  type IDeviceMetadata,
  type IDeviceAudit,
  type IDeviceHealth,
  type IDeviceLastError,
  type IDeviceCompliance,
  type DeviceStatus,
  type DeviceType,
} from './DeviceV2';

// ReadingV2 Model and Types
export {
  default as ReadingV2,
  type IReadingV2,
  type IReadingV2Model,
  type IReadingMetadata,
  type IReadingQuality,
  type IReadingContext,
  type IReadingProcessing,
  type ReadingType,
  type ReadingUnit,
  type ReadingSource,
} from './ReadingV2';
