/**
 * Reading Validation Schema Tests
 *
 * Tests for Zod validation schemas in reading.validation.ts
 */

import {
  readingTypeSchema,
  readingUnitSchema,
  readingSourceSchema,
  readingMetadataSchema,
  readingQualitySchema,
  readingContextSchema,
  readingProcessingSchema,
  createReadingSchema,
  bulkReadingItemSchema,
  bulkIngestReadingsSchema,
  listReadingsQuerySchema,
  latestReadingsQuerySchema,
  readingAnalyticsQuerySchema,
  anomalyAnalyticsQuerySchema,
  aggregationTypeSchema,
  timeGranularitySchema,
} from '@/lib/validations/v2/reading.validation';

describe('Reading Validation Schemas', () => {
  // ==========================================================================
  // READING TYPE SCHEMA TESTS
  // ==========================================================================

  describe('readingTypeSchema', () => {
    const validTypes = [
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

    it('should accept all valid reading types', () => {
      for (const type of validTypes) {
        const result = readingTypeSchema.safeParse(type);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(type);
        }
      }
    });

    it('should reject invalid reading types', () => {
      const invalidTypes = ['invalid', 'Temperature', 'POWER', 'door', 'window', ''];

      for (const type of invalidTypes) {
        const result = readingTypeSchema.safeParse(type);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // READING UNIT SCHEMA TESTS
  // ==========================================================================

  describe('readingUnitSchema', () => {
    const validUnits = [
      // Temperature
      'celsius', 'fahrenheit', 'kelvin',
      // Humidity/percentage
      'percent',
      // CO2 / Gas / Air quality
      'ppm', 'ppb', 'ug_m3',
      // Pressure
      'pascal', 'hpa', 'bar', 'psi',
      // Power/Energy
      'watts', 'kilowatts', 'watt_hours', 'kilowatt_hours',
      // Electrical
      'volts', 'millivolts', 'amperes', 'milliamperes',
      // Light
      'lux', 'lumens',
      // Flow
      'liters_per_minute', 'gallons_per_minute', 'cubic_meters_per_hour',
      // Occupancy/Count
      'count', 'boolean',
      // Generic
      'raw', 'unknown',
    ];

    it('should accept all valid reading units', () => {
      for (const unit of validUnits) {
        const result = readingUnitSchema.safeParse(unit);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid reading units', () => {
      const invalidUnits = ['invalid', 'Celsius', 'WATTS', 'meters', 'kg'];

      for (const unit of invalidUnits) {
        const result = readingUnitSchema.safeParse(unit);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // READING SOURCE SCHEMA TESTS
  // ==========================================================================

  describe('readingSourceSchema', () => {
    it('should accept valid source values', () => {
      const validSources = ['sensor', 'simulation', 'manual', 'calibration'];

      for (const source of validSources) {
        const result = readingSourceSchema.safeParse(source);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(source);
        }
      }
    });

    it('should reject invalid source values', () => {
      const invalidSources = ['invalid', 'Sensor', 'MANUAL', 'api', ''];

      for (const source of invalidSources) {
        const result = readingSourceSchema.safeParse(source);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // READING METADATA SCHEMA TESTS
  // ==========================================================================

  describe('readingMetadataSchema', () => {
    it('should accept valid metadata', () => {
      const validMetadata = {
        device_id: 'device_001',
        type: 'temperature',
        unit: 'celsius',
        source: 'sensor',
      };

      const result = readingMetadataSchema.safeParse(validMetadata);
      expect(result.success).toBe(true);
    });

    it('should use default source when not provided', () => {
      const metadataWithoutSource = {
        device_id: 'device_001',
        type: 'temperature',
        unit: 'celsius',
      };

      const result = readingMetadataSchema.safeParse(metadataWithoutSource);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('sensor');
      }
    });

    it('should reject missing device_id', () => {
      const invalidMetadata = {
        type: 'temperature',
        unit: 'celsius',
      };

      const result = readingMetadataSchema.safeParse(invalidMetadata);
      expect(result.success).toBe(false);
    });

    it('should reject missing type', () => {
      const invalidMetadata = {
        device_id: 'device_001',
        unit: 'celsius',
      };

      const result = readingMetadataSchema.safeParse(invalidMetadata);
      expect(result.success).toBe(false);
    });

    it('should reject missing unit', () => {
      const invalidMetadata = {
        device_id: 'device_001',
        type: 'temperature',
      };

      const result = readingMetadataSchema.safeParse(invalidMetadata);
      expect(result.success).toBe(false);
    });

    it('should reject invalid device_id format', () => {
      const invalidMetadata = {
        device_id: 'has spaces',
        type: 'temperature',
        unit: 'celsius',
      };

      const result = readingMetadataSchema.safeParse(invalidMetadata);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // READING QUALITY SCHEMA TESTS
  // ==========================================================================

  describe('readingQualitySchema', () => {
    it('should accept valid quality data', () => {
      const validQuality = {
        is_valid: true,
        confidence_score: 0.95,
        is_anomaly: false,
        anomaly_score: 0.1,
      };

      const result = readingQualitySchema.safeParse(validQuality);
      expect(result.success).toBe(true);
    });

    it('should use default values', () => {
      const minimalQuality = {};

      const result = readingQualitySchema.safeParse(minimalQuality);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_valid).toBe(true);
        expect(result.data.is_anomaly).toBe(false);
      }
    });

    it('should accept validation flags array', () => {
      const qualityWithFlags = {
        is_valid: false,
        validation_flags: ['out_of_range', 'sensor_drift'],
        is_anomaly: true,
      };

      const result = readingQualitySchema.safeParse(qualityWithFlags);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.validation_flags).toContain('out_of_range');
      }
    });

    it('should reject confidence_score over 1', () => {
      const invalidQuality = {
        is_valid: true,
        confidence_score: 1.5,
        is_anomaly: false,
      };

      const result = readingQualitySchema.safeParse(invalidQuality);
      expect(result.success).toBe(false);
    });

    it('should reject negative confidence_score', () => {
      const invalidQuality = {
        is_valid: true,
        confidence_score: -0.5,
        is_anomaly: false,
      };

      const result = readingQualitySchema.safeParse(invalidQuality);
      expect(result.success).toBe(false);
    });

    it('should reject anomaly_score over 1', () => {
      const invalidQuality = {
        is_valid: true,
        is_anomaly: true,
        anomaly_score: 1.5,
      };

      const result = readingQualitySchema.safeParse(invalidQuality);
      expect(result.success).toBe(false);
    });

    it('should reject negative anomaly_score', () => {
      const invalidQuality = {
        is_valid: true,
        is_anomaly: true,
        anomaly_score: -0.1,
      };

      const result = readingQualitySchema.safeParse(invalidQuality);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // READING CONTEXT SCHEMA TESTS
  // ==========================================================================

  describe('readingContextSchema', () => {
    it('should accept valid context data', () => {
      const validContext = {
        battery_level: 75,
        signal_strength: -45,
        ambient_temp: 21.5,
      };

      const result = readingContextSchema.safeParse(validContext);
      expect(result.success).toBe(true);
    });

    it('should accept partial context', () => {
      const partialContext = {
        battery_level: 50,
      };

      const result = readingContextSchema.safeParse(partialContext);
      expect(result.success).toBe(true);
    });

    it('should accept empty context', () => {
      const result = readingContextSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should reject battery_level over 100', () => {
      const invalidContext = {
        battery_level: 150,
      };

      const result = readingContextSchema.safeParse(invalidContext);
      expect(result.success).toBe(false);
    });

    it('should reject negative battery_level', () => {
      const invalidContext = {
        battery_level: -10,
      };

      const result = readingContextSchema.safeParse(invalidContext);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // READING PROCESSING SCHEMA TESTS
  // ==========================================================================

  describe('readingProcessingSchema', () => {
    it('should accept valid processing data', () => {
      const validProcessing = {
        raw_value: 23.0,
        calibration_offset: -0.5,
        ingested_at: new Date(),
      };

      const result = readingProcessingSchema.safeParse(validProcessing);
      expect(result.success).toBe(true);
    });

    it('should set default ingested_at', () => {
      const processingWithoutIngestedAt = {
        raw_value: 23.0,
      };

      const result = readingProcessingSchema.safeParse(processingWithoutIngestedAt);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ingested_at).toBeInstanceOf(Date);
      }
    });

    it('should accept empty processing', () => {
      const result = readingProcessingSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // CREATE READING SCHEMA TESTS
  // ==========================================================================

  describe('createReadingSchema', () => {
    const validReading = {
      metadata: {
        device_id: 'device_001',
        type: 'temperature',
        unit: 'celsius',
      },
      timestamp: new Date().toISOString(),
      value: 22.5,
    };

    it('should accept valid reading data', () => {
      const result = createReadingSchema.safeParse(validReading);
      expect(result.success).toBe(true);
    });

    it('should apply default quality values', () => {
      const result = createReadingSchema.safeParse(validReading);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quality).toBeDefined();
        expect(result.data.quality?.is_valid).toBe(true);
        expect(result.data.quality?.is_anomaly).toBe(false);
      }
    });

    it('should reject missing metadata', () => {
      const invalidReading = {
        timestamp: new Date().toISOString(),
        value: 22.5,
      };

      const result = createReadingSchema.safeParse(invalidReading);
      expect(result.success).toBe(false);
    });

    it('should reject missing timestamp', () => {
      const invalidReading = {
        metadata: {
          device_id: 'device_001',
          type: 'temperature',
          unit: 'celsius',
        },
        value: 22.5,
      };

      const result = createReadingSchema.safeParse(invalidReading);
      expect(result.success).toBe(false);
    });

    it('should reject missing value', () => {
      const invalidReading = {
        metadata: {
          device_id: 'device_001',
          type: 'temperature',
          unit: 'celsius',
        },
        timestamp: new Date().toISOString(),
      };

      const result = createReadingSchema.safeParse(invalidReading);
      expect(result.success).toBe(false);
    });

    it('should reject future timestamp', () => {
      const futureReading = {
        ...validReading,
        timestamp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      const result = createReadingSchema.safeParse(futureReading);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // BULK READING ITEM SCHEMA TESTS
  // ==========================================================================

  describe('bulkReadingItemSchema', () => {
    const validItem = {
      device_id: 'device_001',
      type: 'temperature',
      unit: 'celsius',
      timestamp: new Date().toISOString(),
      value: 22.5,
    };

    it('should accept valid bulk reading item', () => {
      const result = bulkReadingItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it('should accept timestamp as Date object', () => {
      const itemWithDate = {
        ...validItem,
        timestamp: new Date(),
      };

      const result = bulkReadingItemSchema.safeParse(itemWithDate);
      expect(result.success).toBe(true);
    });

    it('should accept timestamp as Unix seconds', () => {
      const itemWithUnixSeconds = {
        ...validItem,
        timestamp: Math.floor(Date.now() / 1000),
      };

      const result = bulkReadingItemSchema.safeParse(itemWithUnixSeconds);
      expect(result.success).toBe(true);
    });

    it('should accept timestamp as Unix milliseconds', () => {
      const itemWithUnixMs = {
        ...validItem,
        timestamp: Date.now(),
      };

      const result = bulkReadingItemSchema.safeParse(itemWithUnixMs);
      expect(result.success).toBe(true);
    });

    it('should apply default source', () => {
      const result = bulkReadingItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('sensor');
      }
    });

    it('should accept optional quality fields', () => {
      const itemWithQuality = {
        ...validItem,
        confidence_score: 0.95,
        battery_level: 80,
        signal_strength: -45,
        raw_value: 22.8,
        calibration_offset: -0.3,
      };

      const result = bulkReadingItemSchema.safeParse(itemWithQuality);
      expect(result.success).toBe(true);
    });

    it('should reject future timestamp', () => {
      const futureItem = {
        ...validItem,
        timestamp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      const result = bulkReadingItemSchema.safeParse(futureItem);
      expect(result.success).toBe(false);
    });

    it('should reject invalid confidence_score', () => {
      const invalidItem = {
        ...validItem,
        confidence_score: 1.5,
      };

      const result = bulkReadingItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // BULK INGEST READINGS SCHEMA TESTS
  // ==========================================================================

  describe('bulkIngestReadingsSchema', () => {
    const validReading = {
      device_id: 'device_001',
      type: 'temperature',
      unit: 'celsius',
      timestamp: new Date().toISOString(),
      value: 22.5,
    };

    it('should accept valid bulk ingest payload', () => {
      const payload = {
        readings: [validReading],
      };

      const result = bulkIngestReadingsSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should accept multiple readings', () => {
      const payload = {
        readings: [
          validReading,
          { ...validReading, device_id: 'device_002', value: 23.5 },
          { ...validReading, device_id: 'device_003', value: 24.5 },
        ],
      };

      const result = bulkIngestReadingsSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.readings.length).toBe(3);
      }
    });

    it('should accept idempotency_key', () => {
      const payload = {
        readings: [validReading],
        idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = bulkIngestReadingsSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should accept batch_source', () => {
      const payload = {
        readings: [validReading],
        batch_source: 'sensor-gateway-01',
      };

      const result = bulkIngestReadingsSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject empty readings array', () => {
      const payload = {
        readings: [],
      };

      const result = bulkIngestReadingsSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject more than 10,000 readings', () => {
      const readings = Array.from({ length: 10001 }, (_, i) => ({
        ...validReading,
        device_id: `device_${i}`,
      }));

      const payload = { readings };

      const result = bulkIngestReadingsSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should accept exactly 10,000 readings', () => {
      const readings = Array.from({ length: 10000 }, (_, i) => ({
        ...validReading,
        device_id: `device_${i}`,
      }));

      const payload = { readings };

      const result = bulkIngestReadingsSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid idempotency_key format', () => {
      const payload = {
        readings: [validReading],
        idempotency_key: 'not-a-uuid',
      };

      const result = bulkIngestReadingsSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // LIST READINGS QUERY SCHEMA TESTS
  // ==========================================================================

  describe('listReadingsQuerySchema', () => {
    it('should accept valid query with device_id', () => {
      const query = {
        device_id: 'device_001',
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept valid query with startDate', () => {
      const query = {
        startDate: new Date().toISOString(),
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should reject query without device_id or startDate', () => {
      const query = {
        limit: 20,
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(false);
    });

    it('should accept pagination parameters', () => {
      const query = {
        device_id: 'device_001',
        page: 2,
        limit: 50,
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    it('should transform string pagination to numbers', () => {
      const query = {
        device_id: 'device_001',
        page: '3',
        limit: '25',
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.limit).toBe(25);
      }
    });

    it('should accept device_id as array', () => {
      const query = {
        device_id: ['device_001', 'device_002'],
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept device_id as comma-separated string', () => {
      const query = {
        device_id: 'device_001,device_002',
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept type filter', () => {
      const query = {
        device_id: 'device_001',
        type: 'temperature',
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept source filter', () => {
      const query = {
        device_id: 'device_001',
        source: 'sensor',
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept quality filters', () => {
      const query = {
        device_id: 'device_001',
        is_valid: true,
        is_anomaly: false,
        min_confidence: 0.9,
        min_anomaly_score: 0.5,
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should transform string booleans', () => {
      const query = {
        device_id: 'device_001',
        is_valid: 'true',
        is_anomaly: 'false',
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_valid).toBe(true);
        expect(result.data.is_anomaly).toBe(false);
      }
    });

    it('should accept value range filters', () => {
      const query = {
        device_id: 'device_001',
        min_value: 20,
        max_value: 30,
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept sorting parameters', () => {
      const query = {
        device_id: 'device_001',
        sortBy: 'timestamp',
        sortDirection: 'desc',
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept fields projection', () => {
      const query = {
        device_id: 'device_001',
        fields: 'timestamp,value,metadata',
      };

      const result = listReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fields).toEqual(['timestamp', 'value', 'metadata']);
      }
    });
  });

  // ==========================================================================
  // LATEST READINGS QUERY SCHEMA TESTS
  // ==========================================================================

  describe('latestReadingsQuerySchema', () => {
    it('should accept valid query', () => {
      const query = {
        device_ids: 'device_001,device_002',
      };

      const result = latestReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept device_ids as array', () => {
      const query = {
        device_ids: ['device_001', 'device_002'],
      };

      const result = latestReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept type filter', () => {
      const query = {
        device_ids: 'device_001',
        type: 'temperature',
      };

      const result = latestReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should use default include_invalid as false', () => {
      const query = {
        device_ids: 'device_001',
      };

      const result = latestReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.include_invalid).toBe(false);
      }
    });

    it('should accept include_quality_metrics', () => {
      const query = {
        device_ids: 'device_001',
        include_quality_metrics: true,
      };

      const result = latestReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should transform string booleans', () => {
      const query = {
        device_ids: 'device_001',
        include_invalid: 'true',
        include_quality_metrics: 'true',
      };

      const result = latestReadingsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.include_invalid).toBe(true);
        expect(result.data.include_quality_metrics).toBe(true);
      }
    });
  });

  // ==========================================================================
  // READING ANALYTICS QUERY SCHEMA TESTS
  // ==========================================================================

  describe('readingAnalyticsQuerySchema', () => {
    it('should accept valid analytics query', () => {
      const query = {
        device_id: 'device_001',
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
      };

      const result = readingAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should use default aggregation and granularity', () => {
      const query = {
        device_id: 'device_001',
      };

      const result = readingAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.aggregation).toBe('avg');
        expect(result.data.granularity).toBe('hour');
      }
    });

    it('should accept all aggregation types', () => {
      const aggregations = ['raw', 'avg', 'sum', 'min', 'max', 'count', 'first', 'last'];

      for (const aggregation of aggregations) {
        const query = {
          device_id: 'device_001',
          aggregation,
        };

        const result = readingAnalyticsQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
      }
    });

    it('should accept all granularity values', () => {
      const granularities = ['second', 'minute', 'hour', 'day', 'week', 'month'];

      for (const granularity of granularities) {
        const query = {
          device_id: 'device_001',
          granularity,
        };

        const result = readingAnalyticsQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
      }
    });

    it('should accept group_by options', () => {
      const groupByOptions = ['device', 'type', 'floor', 'room', 'building', 'department'];

      for (const group_by of groupByOptions) {
        const query = {
          device_id: 'device_001',
          group_by,
        };

        const result = readingAnalyticsQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
      }
    });

    it('should accept compare_with options', () => {
      const compareOptions = ['previous_period', 'same_period_last_week', 'same_period_last_month'];

      for (const compare_with of compareOptions) {
        const query = {
          device_id: 'device_001',
          compare_with,
        };

        const result = readingAnalyticsQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
      }
    });

    it('should use default include_invalid as false', () => {
      const query = {
        device_id: 'device_001',
      };

      const result = readingAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.include_invalid).toBe(false);
      }
    });
  });

  // ==========================================================================
  // ANOMALY ANALYTICS QUERY SCHEMA TESTS
  // ==========================================================================

  describe('anomalyAnalyticsQuerySchema', () => {
    it('should accept valid anomaly query', () => {
      const query = {
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
      };

      const result = anomalyAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept device_id filter', () => {
      const query = {
        device_id: 'device_001',
      };

      const result = anomalyAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept type filter', () => {
      const query = {
        type: 'temperature',
      };

      const result = anomalyAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept min_score filter', () => {
      const query = {
        min_score: 0.8,
      };

      const result = anomalyAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept bucket_granularity', () => {
      const query = {
        bucket_granularity: 'hour',
      };

      const result = anomalyAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept sorting parameters', () => {
      const query = {
        sortBy: 'anomaly_score',
        sortDirection: 'desc',
      };

      const result = anomalyAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should use analytics pagination with higher limit', () => {
      const query = {
        limit: 500,
      };

      const result = anomalyAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });

    it('should accept limit up to 1000', () => {
      const query = {
        limit: 1000,
      };

      const result = anomalyAnalyticsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // AGGREGATION TYPE SCHEMA TESTS
  // ==========================================================================

  describe('aggregationTypeSchema', () => {
    it('should accept all valid aggregation types', () => {
      const validTypes = ['raw', 'avg', 'sum', 'min', 'max', 'count', 'first', 'last'];

      for (const type of validTypes) {
        const result = aggregationTypeSchema.safeParse(type);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid aggregation types', () => {
      const invalidTypes = ['invalid', 'AVG', 'Mean', 'total'];

      for (const type of invalidTypes) {
        const result = aggregationTypeSchema.safeParse(type);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // TIME GRANULARITY SCHEMA TESTS
  // ==========================================================================

  describe('timeGranularitySchema', () => {
    it('should accept all valid granularity values', () => {
      const validGranularities = ['second', 'minute', 'hour', 'day', 'week', 'month'];

      for (const granularity of validGranularities) {
        const result = timeGranularitySchema.safeParse(granularity);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid granularity values', () => {
      const invalidGranularities = ['invalid', 'HOUR', 'Year', 'quarter'];

      for (const granularity of invalidGranularities) {
        const result = timeGranularitySchema.safeParse(granularity);
        expect(result.success).toBe(false);
      }
    });
  });
});
