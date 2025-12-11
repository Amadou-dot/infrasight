import mongoose, { Schema, type Document, type Model } from 'mongoose';

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

/**
 * Reading type (measurement types)
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
 * Reading unit (measurement units)
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
 * Reading source enum
 */
export type ReadingSource = 'sensor' | 'simulation' | 'manual' | 'calibration';

/**
 * Reading metadata interface (bucketing key for timeseries)
 */
export interface IReadingMetadata {
  device_id: string;
  type: ReadingType;
  unit: ReadingUnit;
  source: ReadingSource;
}

/**
 * Reading quality interface
 */
export interface IReadingQuality {
  is_valid: boolean;
  confidence_score?: number;
  validation_flags?: string[];
  is_anomaly: boolean;
  anomaly_score?: number;
}

/**
 * Reading context interface
 */
export interface IReadingContext {
  battery_level?: number;
  signal_strength?: number;
  ambient_temp?: number;
}

/**
 * Reading processing/audit interface
 */
export interface IReadingProcessing {
  raw_value?: number;
  calibration_offset?: number;
  ingested_at: Date;
}

/**
 * Main ReadingV2 interface
 */
export interface IReadingV2 extends Document {
  metadata: IReadingMetadata;
  timestamp: Date;
  value: number;
  quality: IReadingQuality;
  context?: IReadingContext;
  processing: IReadingProcessing;
}

// ============================================================================
// MONGOOSE SCHEMA
// ============================================================================

/**
 * Metadata sub-schema (timeseries bucketing key)
 * Keep LOW CARDINALITY for efficient bucketing
 */
const MetadataSchema = new Schema<IReadingMetadata>(
  {
    device_id: { type: String, required: true },
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
    unit: {
      type: String,
      enum: [
        // Temperature
        'celsius',
        'fahrenheit',
        'kelvin',
        // Humidity/percentage
        'percent',
        // CO2 / Gas / Air quality
        'ppm',
        'ppb',
        'ug_m3',
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
        'boolean',
        // Generic
        'raw',
        'unknown',
      ],
      required: true,
    },
    source: {
      type: String,
      enum: ['sensor', 'simulation', 'manual', 'calibration'],
      default: 'sensor',
    },
  },
  { _id: false }
);

/**
 * Quality sub-schema
 */
const QualitySchema = new Schema<IReadingQuality>(
  {
    is_valid: { type: Boolean, default: true },
    confidence_score: { type: Number, min: 0, max: 1 },
    validation_flags: { type: [String] },
    is_anomaly: { type: Boolean, default: false },
    anomaly_score: { type: Number, min: 0, max: 1 },
  },
  { _id: false }
);

/**
 * Context sub-schema
 */
const ContextSchema = new Schema<IReadingContext>(
  {
    battery_level: { type: Number, min: 0, max: 100 },
    signal_strength: { type: Number },
    ambient_temp: { type: Number },
  },
  { _id: false }
);

/**
 * Processing sub-schema
 */
const ProcessingSchema = new Schema<IReadingProcessing>(
  {
    raw_value: { type: Number },
    calibration_offset: { type: Number },
    ingested_at: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

/**
 * Main ReadingV2 Schema
 * Uses MongoDB Timeseries collection features
 */
const ReadingV2Schema = new Schema<IReadingV2>(
  {
    // 1. METADATA (Bucketing key for timeseries)
    metadata: {
      type: MetadataSchema,
      required: true,
    },

    // 2. MEASUREMENT DATA
    timestamp: { type: Date, required: true },
    value: { type: Number, required: true },

    // 3. QUALITY & TRUST
    quality: {
      type: QualitySchema,
      default: () => ({ is_valid: true, is_anomaly: false }),
    },

    // 4. CONTEXT (optional)
    context: {
      type: ContextSchema,
    },

    // 5. PROCESSING/AUDIT
    processing: {
      type: ProcessingSchema,
      default: () => ({ ingested_at: new Date() }),
    },
  },
  {
    collection: 'readings_v2',
    // MongoDB Timeseries collection options
    timeseries: {
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'seconds',
    },
    // TTL: 90 days (7,776,000 seconds)
    expireAfterSeconds: 7776000,
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// Note: MongoDB automatically creates indexes for timeseries collections
// on timeField and metaField. Additional indexes can be added for specific query patterns.

// Compound index for device + timestamp queries (most common pattern)
// This is especially useful for fetching readings for a specific device in a time range
ReadingV2Schema.index({ 'metadata.device_id': 1, timestamp: -1 });

// Index for anomaly queries
ReadingV2Schema.index({ 'quality.is_anomaly': 1, timestamp: -1 });

// Index for source filtering (useful for distinguishing simulation vs real data)
ReadingV2Schema.index({ 'metadata.source': 1 });

// Index for type-based queries
ReadingV2Schema.index({ 'metadata.type': 1, timestamp: -1 });

// Compound index for validity filtering with device
ReadingV2Schema.index({ 'quality.is_valid': 1, 'metadata.device_id': 1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get latest reading for a device
 */
ReadingV2Schema.statics.getLatestForDevice = function (
  deviceId: string,
  type?: ReadingType
) {
  const query: Record<string, unknown> = { 'metadata.device_id': deviceId };
  if (type) {
    query['metadata.type'] = type;
  }
  return this.findOne(query).sort({ timestamp: -1 });
};

/**
 * Get readings for a device within a time range
 */
ReadingV2Schema.statics.getForDeviceInRange = function (
  deviceId: string,
  startTime: Date,
  endTime: Date,
  options: { type?: ReadingType; limit?: number; includeInvalid?: boolean } = {}
) {
  const query: Record<string, unknown> = {
    'metadata.device_id': deviceId,
    timestamp: { $gte: startTime, $lte: endTime },
  };

  if (options.type) {
    query['metadata.type'] = options.type;
  }

  if (!options.includeInvalid) {
    query['quality.is_valid'] = true;
  }

  let cursor = this.find(query).sort({ timestamp: -1 });

  if (options.limit) {
    cursor = cursor.limit(options.limit);
  }

  return cursor;
};

/**
 * Get anomalous readings for a device
 */
ReadingV2Schema.statics.getAnomalies = function (
  deviceId?: string,
  options: { startTime?: Date; endTime?: Date; minScore?: number; limit?: number } = {}
) {
  const query: Record<string, unknown> = {
    'quality.is_anomaly': true,
  };

  if (deviceId) {
    query['metadata.device_id'] = deviceId;
  }

  if (options.startTime || options.endTime) {
    query.timestamp = {};
    if (options.startTime) {
      (query.timestamp as Record<string, Date>).$gte = options.startTime;
    }
    if (options.endTime) {
      (query.timestamp as Record<string, Date>).$lte = options.endTime;
    }
  }

  if (options.minScore !== undefined) {
    query['quality.anomaly_score'] = { $gte: options.minScore };
  }

  let cursor = this.find(query).sort({ timestamp: -1 });

  if (options.limit) {
    cursor = cursor.limit(options.limit);
  }

  return cursor;
};

/**
 * Bulk insert readings with validation
 */
ReadingV2Schema.statics.bulkInsertReadings = async function (
  readings: Array<Partial<IReadingV2>>
) {
  // Add ingested_at timestamp to all readings
  const readingsWithTimestamp = readings.map((reading) => ({
    ...reading,
    processing: {
      ...reading.processing,
      ingested_at: new Date(),
    },
  }));

  return this.insertMany(readingsWithTimestamp, { ordered: false });
};

// ============================================================================
// INTERFACE FOR STATIC METHODS
// ============================================================================

export interface IReadingV2Model extends Model<IReadingV2> {
  getLatestForDevice(deviceId: string, type?: ReadingType): ReturnType<Model<IReadingV2>['findOne']>;
  getForDeviceInRange(
    deviceId: string,
    startTime: Date,
    endTime: Date,
    options?: { type?: ReadingType; limit?: number; includeInvalid?: boolean }
  ): ReturnType<Model<IReadingV2>['find']>;
  getAnomalies(
    deviceId?: string,
    options?: { startTime?: Date; endTime?: Date; minScore?: number; limit?: number }
  ): ReturnType<Model<IReadingV2>['find']>;
  bulkInsertReadings(readings: Array<Partial<IReadingV2>>): Promise<IReadingV2[]>;
}

// ============================================================================
// MODEL EXPORT
// ============================================================================

/**
 * ReadingV2 Model
 * Collection: readings_v2 (MongoDB Timeseries)
 * TTL: 90 days
 */
const ReadingV2: IReadingV2Model =
  (mongoose.models.ReadingV2 as IReadingV2Model) ||
  mongoose.model<IReadingV2, IReadingV2Model>('ReadingV2', ReadingV2Schema);

export default ReadingV2;
