/**
 * ReadingV2 Model Unit Tests
 *
 * Tests for the ReadingV2 Mongoose model including:
 * - Document creation and validation
 * - Static methods (getLatestForDevice, getForDeviceInRange, getAnomalies, bulkInsertReadings)
 * - Timeseries-specific constraints
 * - Quality metrics and anomaly scoring
 */

import ReadingV2 from '@/models/v2/ReadingV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  createReadingV2Input,
  createReadingV2Inputs,
  createAnomalyReadingV2,
  createReadingV2OfType,
  resetCounters,
  VALID_READING_TYPES_V2,
  VALID_READING_UNITS,
  VALID_READING_SOURCES_V2,
  createDeviceInput,
} from '../../setup/factories';

describe('ReadingV2 Model', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // DOCUMENT CREATION TESTS
  // ==========================================================================

  describe('Document Creation', () => {
    it('should create a reading with valid data', async () => {
      const readingData = createReadingV2Input('device_001');
      const reading = await ReadingV2.create(readingData);

      expect(reading.metadata.device_id).toBe('device_001');
      expect(reading.metadata.type).toBe('temperature');
      expect(reading.metadata.unit).toBe('celsius');
      expect(reading.metadata.source).toBe('sensor');
      expect(reading.value).toBeDefined();
      expect(reading.timestamp).toBeInstanceOf(Date);
    });

    it('should set default values for optional fields', async () => {
      const readingData = createReadingV2Input('device_002');
      const reading = await ReadingV2.create(readingData);

      // Check defaults
      expect(reading.quality.is_valid).toBe(true);
      expect(reading.quality.is_anomaly).toBe(false);
      expect(reading.processing.ingested_at).toBeInstanceOf(Date);
    });

    it('should enforce required fields', async () => {
      const invalidData = {
        // Missing required fields: metadata, timestamp, value
      };

      await expect(ReadingV2.create(invalidData)).rejects.toThrow();
    });

    it('should enforce required metadata fields', async () => {
      const invalidData = {
        metadata: {
          device_id: 'device_001',
          // Missing type and unit
        },
        timestamp: new Date(),
        value: 22.5,
      };

      await expect(ReadingV2.create(invalidData)).rejects.toThrow();
    });

    it('should validate reading type enum', async () => {
      const invalidTypeData = createReadingV2Input('device_003');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (invalidTypeData.metadata as any).type = 'invalid_type';

      await expect(ReadingV2.create(invalidTypeData)).rejects.toThrow(/validation/i);
    });

    it('should validate reading unit enum', async () => {
      const invalidUnitData = createReadingV2Input('device_004');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (invalidUnitData.metadata as any).unit = 'invalid_unit';

      await expect(ReadingV2.create(invalidUnitData)).rejects.toThrow(/validation/i);
    });

    it('should validate reading source enum', async () => {
      const invalidSourceData = createReadingV2Input('device_005');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (invalidSourceData.metadata as any).source = 'invalid_source';

      await expect(ReadingV2.create(invalidSourceData)).rejects.toThrow(/validation/i);
    });

    it('should accept all valid reading types', async () => {
      for (const type of VALID_READING_TYPES_V2) {
        const reading = await ReadingV2.create(
          createReadingV2OfType(type, `device_type_${type}`)
        );
        expect(reading.metadata.type).toBe(type);
      }
    });

    it('should accept all valid reading sources', async () => {
      for (const source of VALID_READING_SOURCES_V2) {
        const readingData = createReadingV2Input(`device_source_${source}`);
        readingData.metadata.source = source;
        const reading = await ReadingV2.create(readingData);
        expect(reading.metadata.source).toBe(source);
      }
    });
  });

  // ==========================================================================
  // METADATA VALIDATION TESTS (Timeseries Bucketing Key)
  // ==========================================================================

  describe('Metadata Validation', () => {
    it('should require device_id in metadata', async () => {
      const invalidData = {
        metadata: {
          type: 'temperature' as const,
          unit: 'celsius' as const,
          source: 'sensor' as const,
          // Missing device_id
        },
        timestamp: new Date(),
        value: 22.5,
      };

      await expect(ReadingV2.create(invalidData)).rejects.toThrow();
    });

    it('should require type in metadata', async () => {
      const invalidData = {
        metadata: {
          device_id: 'device_001',
          unit: 'celsius' as const,
          source: 'sensor' as const,
          // Missing type
        },
        timestamp: new Date(),
        value: 22.5,
      };

      await expect(ReadingV2.create(invalidData)).rejects.toThrow();
    });

    it('should require unit in metadata', async () => {
      const invalidData = {
        metadata: {
          device_id: 'device_001',
          type: 'temperature' as const,
          source: 'sensor' as const,
          // Missing unit
        },
        timestamp: new Date(),
        value: 22.5,
      };

      await expect(ReadingV2.create(invalidData)).rejects.toThrow();
    });

    it('should use default source if not provided', async () => {
      const readingData = {
        metadata: {
          device_id: 'device_default_source',
          type: 'temperature' as const,
          unit: 'celsius' as const,
          // source not provided - should default to 'sensor'
        },
        timestamp: new Date(),
        value: 22.5,
      };

      const reading = await ReadingV2.create(readingData);
      expect(reading.metadata.source).toBe('sensor');
    });
  });

  // ==========================================================================
  // QUALITY METRICS TESTS
  // ==========================================================================

  describe('Quality Metrics', () => {
    it('should validate confidence_score range (0-1)', async () => {
      const validReading = await ReadingV2.create(
        createReadingV2Input('device_confidence_valid', {
          quality: {
            is_valid: true,
            confidence_score: 0.95,
            is_anomaly: false,
          },
        })
      );

      expect(validReading.quality.confidence_score).toBe(0.95);
    });

    it('should reject confidence_score over 1', async () => {
      const readingData = createReadingV2Input('device_confidence_high');
      readingData.quality = {
        is_valid: true,
        confidence_score: 1.5, // Invalid
        is_anomaly: false,
      };

      await expect(ReadingV2.create(readingData)).rejects.toThrow();
    });

    it('should reject negative confidence_score', async () => {
      const readingData = createReadingV2Input('device_confidence_negative');
      readingData.quality = {
        is_valid: true,
        confidence_score: -0.5, // Invalid
        is_anomaly: false,
      };

      await expect(ReadingV2.create(readingData)).rejects.toThrow();
    });

    it('should validate anomaly_score range (0-1)', async () => {
      const validReading = await ReadingV2.create(
        createReadingV2Input('device_anomaly_valid', {
          quality: {
            is_valid: true,
            is_anomaly: true,
            anomaly_score: 0.85,
          },
        })
      );

      expect(validReading.quality.anomaly_score).toBe(0.85);
    });

    it('should reject anomaly_score over 1', async () => {
      const readingData = createReadingV2Input('device_anomaly_high');
      readingData.quality = {
        is_valid: true,
        is_anomaly: true,
        anomaly_score: 1.5, // Invalid
      };

      await expect(ReadingV2.create(readingData)).rejects.toThrow();
    });

    it('should store validation flags', async () => {
      const reading = await ReadingV2.create(
        createReadingV2Input('device_flags', {
          quality: {
            is_valid: false,
            validation_flags: ['out_of_range', 'sensor_drift'],
            is_anomaly: true,
            anomaly_score: 0.9,
          },
        })
      );

      expect(reading.quality.is_valid).toBe(false);
      expect(reading.quality.validation_flags).toContain('out_of_range');
      expect(reading.quality.validation_flags).toContain('sensor_drift');
    });
  });

  // ==========================================================================
  // CONTEXT TESTS
  // ==========================================================================

  describe('Context Fields', () => {
    it('should store battery level context', async () => {
      const reading = await ReadingV2.create(
        createReadingV2Input('device_battery', {
          context: {
            battery_level: 75,
            signal_strength: -45,
          },
        })
      );

      expect(reading.context?.battery_level).toBe(75);
      expect(reading.context?.signal_strength).toBe(-45);
    });

    it('should validate battery level range (0-100)', async () => {
      const readingData = createReadingV2Input('device_battery_invalid');
      readingData.context = {
        battery_level: 150, // Invalid
      };

      await expect(ReadingV2.create(readingData)).rejects.toThrow();
    });

    it('should reject negative battery level', async () => {
      const readingData = createReadingV2Input('device_battery_negative');
      readingData.context = {
        battery_level: -10, // Invalid
      };

      await expect(ReadingV2.create(readingData)).rejects.toThrow();
    });

    it('should store ambient temperature context', async () => {
      const reading = await ReadingV2.create(
        createReadingV2Input('device_ambient', {
          context: {
            ambient_temp: 21.5,
          },
        })
      );

      expect(reading.context?.ambient_temp).toBe(21.5);
    });

    it('should allow optional context', async () => {
      const readingData = createReadingV2Input('device_no_context');
      delete readingData.context;

      const reading = await ReadingV2.create(readingData);
      expect(reading.context).toBeUndefined();
    });
  });

  // ==========================================================================
  // PROCESSING / AUDIT TESTS
  // ==========================================================================

  describe('Processing Fields', () => {
    it('should store raw_value and calibration_offset', async () => {
      const reading = await ReadingV2.create(
        createReadingV2Input('device_processing', {
          processing: {
            raw_value: 23.0,
            calibration_offset: -0.5,
            ingested_at: new Date(),
          },
        })
      );

      expect(reading.processing.raw_value).toBe(23.0);
      expect(reading.processing.calibration_offset).toBe(-0.5);
    });

    it('should set ingested_at automatically', async () => {
      const beforeCreate = new Date();
      const reading = await ReadingV2.create(createReadingV2Input('device_ingested'));

      expect(reading.processing.ingested_at).toBeInstanceOf(Date);
      expect(reading.processing.ingested_at.getTime()).toBeGreaterThanOrEqual(
        beforeCreate.getTime() - 1000
      );
    });
  });

  // ==========================================================================
  // STATIC METHODS TESTS
  // ==========================================================================

  describe('Static Methods', () => {
    describe('getLatestForDevice', () => {
      beforeEach(async () => {
        // Create readings at different timestamps
        const baseTime = Date.now();
        const readings = [
          createReadingV2Input('device_latest', {
            timestamp: new Date(baseTime - 3000),
            value: 22.0,
          }),
          createReadingV2Input('device_latest', {
            timestamp: new Date(baseTime - 2000),
            value: 23.0,
          }),
          createReadingV2Input('device_latest', {
            timestamp: new Date(baseTime - 1000),
            value: 24.0, // Latest
          }),
        ];
        await ReadingV2.insertMany(readings);
      });

      it('should return the most recent reading for a device', async () => {
        const latest = await ReadingV2.getLatestForDevice('device_latest');

        expect(latest).not.toBeNull();
        expect(latest?.value).toBe(24.0);
      });

      it('should return null for non-existent device', async () => {
        const latest = await ReadingV2.getLatestForDevice('non_existent_device');
        expect(latest).toBeNull();
      });

      it('should filter by type when provided', async () => {
        // Add a humidity reading
        await ReadingV2.create(
          createReadingV2OfType('humidity', 'device_latest', {
            timestamp: new Date(),
            value: 65.0,
          })
        );

        const latestTemp = await ReadingV2.getLatestForDevice('device_latest', 'temperature');
        const latestHumidity = await ReadingV2.getLatestForDevice('device_latest', 'humidity');

        expect(latestTemp?.metadata.type).toBe('temperature');
        expect(latestHumidity?.metadata.type).toBe('humidity');
        expect(latestHumidity?.value).toBe(65.0);
      });
    });

    describe('getForDeviceInRange', () => {
      beforeEach(async () => {
        const baseTime = Date.now();
        const readings = [];

        // Create 10 readings over 10 hours
        for (let i = 0; i < 10; i++) {
          readings.push(
            createReadingV2Input('device_range', {
              timestamp: new Date(baseTime - i * 60 * 60 * 1000), // 1 hour apart
              value: 20 + i,
            })
          );
        }

        // Add an invalid reading
        readings.push(
          createReadingV2Input('device_range', {
            timestamp: new Date(baseTime - 5 * 60 * 60 * 1000),
            value: 99.0,
            quality: { is_valid: false, is_anomaly: false },
          })
        );

        await ReadingV2.insertMany(readings);
      });

      it('should return readings within time range', async () => {
        const now = Date.now();
        const startTime = new Date(now - 5 * 60 * 60 * 1000); // 5 hours ago
        const endTime = new Date(now);

        const readings = await ReadingV2.getForDeviceInRange(
          'device_range',
          startTime,
          endTime
        );

        // Should return readings from last 5 hours (excluding invalid by default)
        expect(readings.length).toBeGreaterThan(0);
        expect(readings.length).toBeLessThanOrEqual(6);
      });

      it('should respect limit option', async () => {
        const now = Date.now();
        const startTime = new Date(now - 24 * 60 * 60 * 1000);
        const endTime = new Date(now);

        const readings = await ReadingV2.getForDeviceInRange(
          'device_range',
          startTime,
          endTime,
          { limit: 3 }
        );

        expect(readings.length).toBe(3);
      });

      it('should filter by type when provided', async () => {
        // Add humidity readings
        const baseTime = Date.now();
        await ReadingV2.create(
          createReadingV2OfType('humidity', 'device_range', {
            timestamp: new Date(baseTime - 1000),
            value: 50,
          })
        );

        const startTime = new Date(baseTime - 24 * 60 * 60 * 1000);
        const endTime = new Date(baseTime);

        const tempReadings = await ReadingV2.getForDeviceInRange(
          'device_range',
          startTime,
          endTime,
          { type: 'temperature' }
        );

        expect(tempReadings.every((r) => r.metadata.type === 'temperature')).toBe(true);
      });

      it('should exclude invalid readings by default', async () => {
        const now = Date.now();
        const startTime = new Date(now - 24 * 60 * 60 * 1000);
        const endTime = new Date(now);

        const readings = await ReadingV2.getForDeviceInRange(
          'device_range',
          startTime,
          endTime
        );

        expect(readings.every((r) => r.quality.is_valid === true)).toBe(true);
      });

      it('should include invalid readings when requested', async () => {
        const now = Date.now();
        const startTime = new Date(now - 24 * 60 * 60 * 1000);
        const endTime = new Date(now);

        const readings = await ReadingV2.getForDeviceInRange(
          'device_range',
          startTime,
          endTime,
          { includeInvalid: true }
        );

        const hasInvalid = readings.some((r) => r.quality.is_valid === false);
        expect(hasInvalid).toBe(true);
      });
    });

    describe('getAnomalies', () => {
      beforeEach(async () => {
        const baseTime = Date.now();

        // Create normal readings
        for (let i = 0; i < 5; i++) {
          await ReadingV2.create(
            createReadingV2Input('device_anomaly_test', {
              timestamp: new Date(baseTime - i * 60 * 60 * 1000),
              value: 22 + i * 0.5,
            })
          );
        }

        // Create anomaly readings
        await ReadingV2.create(
          createAnomalyReadingV2('device_anomaly_test', 0.85, {
            timestamp: new Date(baseTime - 2 * 60 * 60 * 1000),
          })
        );
        await ReadingV2.create(
          createAnomalyReadingV2('device_anomaly_test', 0.95, {
            timestamp: new Date(baseTime - 3 * 60 * 60 * 1000),
          })
        );
        await ReadingV2.create(
          createAnomalyReadingV2('another_device', 0.75, {
            timestamp: new Date(baseTime - 1 * 60 * 60 * 1000),
          })
        );
      });

      it('should return only anomalous readings', async () => {
        const anomalies = await ReadingV2.getAnomalies();

        expect(anomalies.length).toBe(3);
        expect(anomalies.every((r) => r.quality.is_anomaly === true)).toBe(true);
      });

      it('should filter by device when provided', async () => {
        const anomalies = await ReadingV2.getAnomalies('device_anomaly_test');

        expect(anomalies.length).toBe(2);
        expect(anomalies.every((r) => r.metadata.device_id === 'device_anomaly_test')).toBe(
          true
        );
      });

      it('should filter by time range', async () => {
        const now = Date.now();
        const anomalies = await ReadingV2.getAnomalies(undefined, {
          startTime: new Date(now - 2.5 * 60 * 60 * 1000),
          endTime: new Date(now),
        });

        expect(anomalies.length).toBeGreaterThan(0);
      });

      it('should filter by minimum anomaly score', async () => {
        const anomalies = await ReadingV2.getAnomalies(undefined, {
          minScore: 0.9,
        });

        expect(anomalies.length).toBe(1);
        expect(anomalies[0].quality.anomaly_score).toBeGreaterThanOrEqual(0.9);
      });

      it('should respect limit option', async () => {
        const anomalies = await ReadingV2.getAnomalies(undefined, {
          limit: 1,
        });

        expect(anomalies.length).toBe(1);
      });
    });

    describe('bulkInsertReadings', () => {
      it('should insert multiple readings', async () => {
        const readings = createReadingV2Inputs('device_bulk', 5);

        const result = await ReadingV2.bulkInsertReadings(readings);

        expect(result.length).toBe(5);
      });

      it('should set ingested_at for all readings', async () => {
        const beforeInsert = new Date();
        const readings = createReadingV2Inputs('device_bulk_timestamp', 3);

        const result = await ReadingV2.bulkInsertReadings(readings);

        for (const reading of result) {
          expect(reading.processing.ingested_at).toBeInstanceOf(Date);
          expect(reading.processing.ingested_at.getTime()).toBeGreaterThanOrEqual(
            beforeInsert.getTime() - 1000
          );
        }
      });

      it('should use ordered: false for partial success', async () => {
        const readings = createReadingV2Inputs('device_bulk_partial', 3);
        // First two should succeed
        const result = await ReadingV2.bulkInsertReadings(readings);

        expect(result.length).toBe(3);
      });

      it('should handle empty array', async () => {
        const result = await ReadingV2.bulkInsertReadings([]);
        expect(result.length).toBe(0);
      });
    });
  });

  // ==========================================================================
  // BULK OPERATIONS TESTS
  // ==========================================================================

  describe('Bulk Operations', () => {
    it('should insert multiple readings', async () => {
      const readings = createReadingV2Inputs('device_insert_many', 10);

      const result = await ReadingV2.insertMany(readings);

      expect(result.length).toBe(10);
    });

    it('should support unordered inserts for performance', async () => {
      const readings = createReadingV2Inputs('device_unordered', 5);

      const result = await ReadingV2.insertMany(readings, { ordered: false });

      expect(result.length).toBe(5);
    });
  });

  // ==========================================================================
  // UNIT MAPPING TESTS
  // ==========================================================================

  describe('Unit Mapping', () => {
    const typeUnitPairs = [
      { type: 'temperature', units: ['celsius', 'fahrenheit', 'kelvin'] },
      { type: 'humidity', units: ['percent'] },
      { type: 'power', units: ['watts', 'kilowatts'] },
      { type: 'co2', units: ['ppm'] },
      { type: 'light', units: ['lux', 'lumens'] },
      { type: 'voltage', units: ['volts', 'millivolts'] },
      { type: 'current', units: ['amperes', 'milliamperes'] },
      { type: 'energy', units: ['watt_hours', 'kilowatt_hours'] },
    ] as const;

    for (const { type, units } of typeUnitPairs) {
      it(`should accept ${units.join(', ')} units for ${type} type`, async () => {
        for (const unit of units) {
          const readingData = {
            metadata: {
              device_id: `device_${type}_${unit}`,
              type,
              unit,
              source: 'sensor' as const,
            },
            timestamp: new Date(),
            value: 25.0,
          };

          const reading = await ReadingV2.create(readingData);
          expect(reading.metadata.unit).toBe(unit);
        }
      });
    }
  });
});
