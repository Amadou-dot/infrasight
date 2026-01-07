/**
 * Test Data Factories
 *
 * Provides functions for creating valid test data for models and API tests.
 */

import type { IDeviceV2, DeviceType, DeviceStatus } from '@/models/v2/DeviceV2';

// ============================================================================
// DEVICE FACTORIES
// ============================================================================

/**
 * Counter for unique IDs
 */
let deviceCounter = 0;
let _readingCounter = 0;
let readingV2Counter = 0;

/**
 * Reset counters (for test isolation)
 */
export function resetCounters(): void {
  deviceCounter = 0;
  _readingCounter = 0;
  readingV2Counter = 0;
}

/**
 * Valid device types for testing (matches DeviceV2 model)
 */
export const VALID_DEVICE_TYPES: DeviceType[] = [
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
];

/**
 * Valid device statuses for testing (matches DeviceV2 model)
 */
export const VALID_DEVICE_STATUSES: DeviceStatus[] = [
  'active',
  'maintenance',
  'offline',
  'decommissioned',
  'error',
];

/**
 * Valid reading types for testing
 */
export const VALID_READING_TYPES = [
  'temperature',
  'humidity',
  'co2',
  'power',
  'occupancy',
  'light',
  'air_quality',
  'water_flow',
  'pressure',
  'motion',
  'door_state',
  'window_state',
  'battery',
  'signal_strength',
  'device_temp',
  'ambient_temp',
] as const;

export type ReadingType = (typeof VALID_READING_TYPES)[number];

/**
 * Valid reading sources for testing
 */
export const VALID_READING_SOURCES = [
  'sensor',
  'manual',
  'calculated',
  'imported',
  'simulated',
] as const;

export type ReadingSource = (typeof VALID_READING_SOURCES)[number];

/**
 * Device input type matching the model
 */
export interface DeviceInput extends Omit<IDeviceV2, 'audit' | 'health'> {
  audit?: Partial<IDeviceV2['audit']>;
  health?: Partial<IDeviceV2['health']>;
}

/**
 * Create a valid device input for testing (matches DeviceV2 model structure)
 */
export function createDeviceInput(
  overrides: Partial<DeviceInput> = {}
): DeviceInput {
  deviceCounter += 1;
  const id = `device_test_${Date.now()}_${deviceCounter}`;

  return {
    _id: id,
    serial_number: `SN-TEST-${deviceCounter.toString().padStart(5, '0')}`,
    manufacturer: 'Test Manufacturer',
    device_model: 'Test Model v1.0',
    firmware_version: '1.0.0',
    type: 'temperature',
    status: 'active',
    configuration: {
      threshold_warning: 25,
      threshold_critical: 30,
      sampling_interval: 60,
      calibration_date: null,
      calibration_offset: 0,
    },
    location: {
      building_id: 'building_001',
      floor: 1,
      room_name: 'Room 101',
      zone: 'Zone A',
      coordinates: {
        x: 100,
        y: 200,
      },
    },
    metadata: {
      tags: ['test', 'automated'],
      department: 'Engineering',
      cost_center: 'CC-001',
    },
    compliance: {
      requires_encryption: false,
      data_classification: 'internal',
      retention_days: 90,
    },
    ...overrides,
  };
}

/**
 * Create multiple valid device inputs
 */
export function createDeviceInputs(
  count: number,
  overrides: Partial<DeviceInput> = {}
): DeviceInput[] {
  return Array.from({ length: count }, () => createDeviceInput(overrides));
}

/**
 * Create a device input with specific type
 */
export function createDeviceOfType(
  type: DeviceType,
  overrides: Partial<DeviceInput> = {}
): DeviceInput {
  return createDeviceInput({ ...overrides, type });
}

/**
 * Create a device input with specific status
 */
export function createDeviceWithStatus(
  status: DeviceStatus,
  overrides: Partial<DeviceInput> = {}
): DeviceInput {
  return createDeviceInput({ ...overrides, status });
}

/**
 * Create a device input with specific location
 */
export function createDeviceAtLocation(
  floor: number,
  room_name: string,
  overrides: Partial<DeviceInput> = {}
): DeviceInput {
  return createDeviceInput({
    ...overrides,
    location: {
      building_id: 'building_001',
      floor,
      room_name,
      zone: 'Zone A',
    },
  });
}

// ============================================================================
// READING FACTORIES
// ============================================================================

/**
 * Reading input interface for testing
 */
export interface ReadingInput {
  device_id: string;
  type: ReadingType;
  value: number;
  unit: string;
  timestamp: string;
  source: ReadingSource;
  quality?: {
    accuracy?: number;
    confidence?: number;
    is_valid?: boolean;
  };
  context?: {
    ambient_temp?: number;
    humidity?: number;
  };
  anomaly?: {
    is_anomaly: boolean;
    anomaly_score: number;
    expected_range: { min: number; max: number };
    detection_method: string;
  };
}

/**
 * Create a valid reading input for testing
 */
export function createReadingInput(
  deviceId: string,
  overrides: Partial<ReadingInput> = {}
): ReadingInput {
  _readingCounter += 1;

  return {
    device_id: deviceId,
    type: 'temperature',
    value: 22.5 + Math.random() * 5, // 22.5-27.5
    unit: 'celsius',
    timestamp: new Date().toISOString(),
    source: 'sensor',
    quality: {
      accuracy: 0.98,
      confidence: 0.95,
      is_valid: true,
    },
    context: {
      ambient_temp: 21.0,
      humidity: 45,
    },
    ...overrides,
  };
}

/**
 * Create multiple reading inputs for a device
 */
export function createReadingInputs(
  deviceId: string,
  count: number,
  overrides: Partial<ReadingInput> = {}
): ReadingInput[] {
  const readings: ReadingInput[] = [];
  const baseTime = Date.now();

  for (let i = 0; i < count; i++) 
    readings.push(
      createReadingInput(deviceId, {
        ...overrides,
        timestamp: new Date(baseTime - i * 60000).toISOString(), // 1 minute apart
      })
    );
  

  return readings;
}

/**
 * Create a reading with anomaly
 */
export function createAnomalyReading(
  deviceId: string,
  anomalyScore: number = 0.85,
  overrides: Partial<ReadingInput> = {}
): ReadingInput {
  return createReadingInput(deviceId, {
    ...overrides,
    value: 50, // Abnormally high for temperature
    anomaly: {
      is_anomaly: true,
      anomaly_score: anomalyScore,
      expected_range: { min: 18, max: 28 },
      detection_method: 'statistical',
    },
  });
}

/**
 * Create readings for time series testing
 */
export function createTimeSeriesReadings(
  deviceId: string,
  hoursBack: number = 24,
  intervalMinutes: number = 5
): ReadingInput[] {
  const readings: ReadingInput[] = [];
  const endTime = Date.now();
  const startTime = endTime - hoursBack * 60 * 60 * 1000;
  const intervalMs = intervalMinutes * 60 * 1000;

  for (let time = startTime; time <= endTime; time += intervalMs) {
    // Generate realistic temperature pattern (cooler at night)
    const hour = new Date(time).getHours();
    const baseTemp = hour >= 6 && hour <= 18 ? 23 : 20;
    const variation = Math.random() * 2 - 1; // -1 to +1

    readings.push(
      createReadingInput(deviceId, {
        timestamp: new Date(time).toISOString(),
        value: baseTemp + variation,
      })
    );
  }

  return readings;
}

// ============================================================================
// BULK INGEST FACTORIES
// ============================================================================

/**
 * Create bulk ingest payload
 */
export function createBulkIngestPayload(
  readings: ReadingInput[]
): { readings: ReadingInput[] } {
  return { readings };
}

/**
 * Create readings for multiple devices
 */
export function createMultiDeviceReadings(
  deviceIds: string[],
  readingsPerDevice: number = 10
): ReadingInput[] {
  const allReadings: ReadingInput[] = [];

  for (const deviceId of deviceIds) 
    allReadings.push(...createReadingInputs(deviceId, readingsPerDevice));
  

  return allReadings;
}

// ============================================================================
// VALIDATION TEST DATA
// ============================================================================

/**
 * Create invalid device inputs for validation testing
 */
export const INVALID_DEVICE_INPUTS = {
  missingSerialNumber: (): Partial<DeviceInput> => {
    const input = createDeviceInput();
    const { serial_number: _removed, ...rest } = input;
    return rest;
  },

  emptySerialNumber: (): DeviceInput =>
    createDeviceInput({ serial_number: '' }),

  invalidType: (): DeviceInput =>
    createDeviceInput({ type: 'invalid_type' as DeviceType }),

  missingLocation: (): Partial<DeviceInput> => {
    const input = createDeviceInput();
    const { location: _removed, ...rest } = input;
    return rest;
  },

  negativeFloor: (): DeviceInput =>
    createDeviceInput({
      location: {
        building_id: 'building_001',
        floor: -1,
        room_name: 'Room 101',
      },
    }),

  invalidBuildingId: (): DeviceInput =>
    createDeviceInput({
      location: {
        building_id: '',
        floor: 1,
        room_name: 'Room 101',
      },
    }),
};

/**
 * Create invalid reading inputs for validation testing
 */
export const INVALID_READING_INPUTS = {
  missingDeviceId: (): Partial<ReadingInput> => {
    const input = createReadingInput('device_001');
    const { device_id: _removed, ...rest } = input;
    return rest;
  },

  invalidType: (): ReadingInput =>
    createReadingInput('device_001', { type: 'invalid' as ReadingType }),

  futureTimestamp: (): ReadingInput =>
    createReadingInput('device_001', {
      timestamp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),

  invalidValue: (): ReadingInput =>
    createReadingInput('device_001', { value: NaN }),

  invalidSource: (): ReadingInput =>
    createReadingInput('device_001', { source: 'invalid' as ReadingSource }),
};

// ============================================================================
// READING V2 FACTORIES (Matches ReadingV2 Model)
// ============================================================================

import type {
  IReadingV2,
  ReadingType as ReadingTypeV2,
  ReadingUnit,
  ReadingSource as ReadingSourceV2,
  IReadingMetadata,
  IReadingQuality,
  IReadingContext,
  IReadingProcessing,
} from '@/models/v2/ReadingV2';

/**
 * Valid reading types for V2 testing (matches ReadingV2 model)
 */
export const VALID_READING_TYPES_V2: ReadingTypeV2[] = [
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
];

/**
 * Valid reading units for V2 testing
 */
export const VALID_READING_UNITS: ReadingUnit[] = [
  'celsius',
  'fahrenheit',
  'kelvin',
  'percent',
  'ppm',
  'ppb',
  'ug_m3',
  'pascal',
  'hpa',
  'bar',
  'psi',
  'watts',
  'kilowatts',
  'watt_hours',
  'kilowatt_hours',
  'volts',
  'millivolts',
  'amperes',
  'milliamperes',
  'lux',
  'lumens',
  'liters_per_minute',
  'gallons_per_minute',
  'cubic_meters_per_hour',
  'count',
  'boolean',
  'raw',
  'unknown',
];

/**
 * Valid reading sources for V2 testing
 */
export const VALID_READING_SOURCES_V2: ReadingSourceV2[] = [
  'sensor',
  'simulation',
  'manual',
  'calibration',
];

/**
 * ReadingV2 input type for factories
 */
export interface ReadingV2Input {
  metadata: IReadingMetadata;
  timestamp: Date;
  value: number;
  quality?: IReadingQuality;
  context?: IReadingContext;
  processing?: IReadingProcessing;
}

/**
 * Create a valid ReadingV2 input for testing
 */
export function createReadingV2Input(
  deviceId: string,
  overrides: Partial<ReadingV2Input> = {}
): ReadingV2Input {
  readingV2Counter += 1;

  return {
    metadata: {
      device_id: deviceId,
      type: 'temperature',
      unit: 'celsius',
      source: 'sensor',
      ...overrides.metadata,
    },
    timestamp: overrides.timestamp || new Date(),
    value: overrides.value ?? 22.5 + Math.random() * 5,
    quality: {
      is_valid: true,
      confidence_score: 0.95,
      is_anomaly: false,
      ...overrides.quality,
    },
    context: overrides.context,
    processing: {
      ingested_at: new Date(),
      ...overrides.processing,
    },
  };
}

/**
 * Create multiple ReadingV2 inputs for a device
 */
export function createReadingV2Inputs(
  deviceId: string,
  count: number,
  overrides: Partial<ReadingV2Input> = {}
): ReadingV2Input[] {
  const readings: ReadingV2Input[] = [];
  const baseTime = Date.now();

  for (let i = 0; i < count; i++) {
    readings.push(
      createReadingV2Input(deviceId, {
        ...overrides,
        timestamp: new Date(baseTime - i * 60000), // 1 minute apart
        value: overrides.value ?? 22 + i * 0.5,
      })
    );
  }

  return readings;
}

/**
 * Create a ReadingV2 of a specific type
 */
export function createReadingV2OfType(
  type: ReadingTypeV2,
  deviceId: string,
  overrides: Partial<ReadingV2Input> = {}
): ReadingV2Input {
  const unitMap: Record<ReadingTypeV2, ReadingUnit> = {
    temperature: 'celsius',
    humidity: 'percent',
    occupancy: 'count',
    power: 'watts',
    co2: 'ppm',
    pressure: 'hpa',
    light: 'lux',
    motion: 'boolean',
    air_quality: 'ppm',
    water_flow: 'liters_per_minute',
    gas: 'ppm',
    vibration: 'raw',
    voltage: 'volts',
    current: 'amperes',
    energy: 'kilowatt_hours',
  };

  return createReadingV2Input(deviceId, {
    ...overrides,
    metadata: {
      device_id: deviceId,
      type,
      unit: unitMap[type],
      source: 'sensor',
      ...overrides.metadata,
    },
  });
}

/**
 * Create an anomaly ReadingV2
 */
export function createAnomalyReadingV2(
  deviceId: string,
  anomalyScore: number = 0.85,
  overrides: Partial<ReadingV2Input> = {}
): ReadingV2Input {
  return createReadingV2Input(deviceId, {
    ...overrides,
    value: 50, // Abnormally high for temperature
    quality: {
      is_valid: true,
      is_anomaly: true,
      anomaly_score: anomalyScore,
      validation_flags: ['out_of_range'],
      ...overrides.quality,
    },
  });
}

/**
 * Create readings for time series testing
 */
export function createTimeSeriesReadingsV2(
  deviceId: string,
  hoursBack: number = 24,
  intervalMinutes: number = 5
): ReadingV2Input[] {
  const readings: ReadingV2Input[] = [];
  const endTime = Date.now();
  const startTime = endTime - hoursBack * 60 * 60 * 1000;
  const intervalMs = intervalMinutes * 60 * 1000;

  for (let time = startTime; time <= endTime; time += intervalMs) {
    // Generate realistic temperature pattern (cooler at night)
    const hour = new Date(time).getHours();
    const baseTemp = hour >= 6 && hour <= 18 ? 23 : 20;
    const variation = Math.random() * 2 - 1;

    readings.push(
      createReadingV2Input(deviceId, {
        timestamp: new Date(time),
        value: baseTemp + variation,
      })
    );
  }

  return readings;
}

/**
 * Create bulk ingest payload for V2
 */
export function createBulkIngestPayloadV2(deviceId: string, count: number = 10) {
  const readings = [];
  const baseTime = Date.now();

  for (let i = 0; i < count; i++) {
    readings.push({
      device_id: deviceId,
      type: 'temperature' as const,
      unit: 'celsius' as const,
      source: 'sensor' as const,
      timestamp: new Date(baseTime - i * 60000),
      value: 22 + Math.random() * 5,
    });
  }

  return { readings };
}

