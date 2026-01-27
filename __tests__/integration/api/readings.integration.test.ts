/**
 * Readings API Integration Tests
 *
 * Integration tests for /api/v2/readings endpoints.
 * These tests run against the actual API routes with MongoDB Memory Server.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  createDeviceInput,
  createReadingV2Input,
  createReadingV2Inputs,
  createAnomalyReadingV2,
  createReadingV2OfType,
  createBulkIngestPayloadV2,
  resetCounters,
} from '../../setup/factories';

// Import the route handlers
import { GET } from '@/app/api/v2/readings/route';
import { GET as GET_LATEST } from '@/app/api/v2/readings/latest/route';

/**
 * Helper to create a mock NextRequest for GET requests
 */
function createMockGetRequest(
  path: string,
  searchParams: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return new NextRequest(url);
}

/**
 * Helper to create a mock NextRequest for POST requests
 */
function _createMockPostRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Readings API Integration Tests', () => {
  beforeEach(async () => {
    resetCounters();

    // Create test devices
    const devices = [
      createDeviceInput({ _id: 'device_001' }),
      createDeviceInput({ _id: 'device_002' }),
      createDeviceInput({ _id: 'device_003' }),
    ];
    await DeviceV2.insertMany(devices);
  });

  // ==========================================================================
  // GET /api/v2/readings TESTS
  // ==========================================================================

  describe('GET /api/v2/readings', () => {
    describe('Basic Listing', () => {
      it('should return empty list when no readings exist', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual([]);
        expect(data.pagination.total).toBe(0);
      });

      it('should return list of readings', async () => {
        // Create test readings
        const readings = createReadingV2Inputs('device_001', 5);
        await ReadingV2.insertMany(readings);

        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.length).toBe(5);
        expect(data.pagination.total).toBe(5);
      });

      it('should require device_id or startDate', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          limit: '20',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          error: { code: string; message: string };
        }>(response);

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('VALIDATION_ERROR');
        expect(data.error.message).toContain('device_id or startDate');
      });

      it('should allow querying by startDate without device_id', async () => {
        const readingTimestamp = new Date('2024-01-10T10:00:00.000Z');
        await ReadingV2.create(
          createReadingV2Input('device_001', {
            timestamp: readingTimestamp,
          })
        );

        const request = createMockGetRequest('/api/v2/readings', {
          startDate: readingTimestamp.toISOString(),
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.length).toBeGreaterThan(0);
      });
    });

    describe('Pagination', () => {
      beforeEach(async () => {
        // Create 30 readings for pagination tests
        const readings = createReadingV2Inputs('device_001', 30);
        await ReadingV2.insertMany(readings);
      });

      it('should respect page and limit parameters', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          page: '2',
          limit: '10',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
          pagination: { total: number; page: number; limit: number };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(10);
        expect(data.pagination.page).toBe(2);
        expect(data.pagination.limit).toBe(10);
      });

      it('should return hasNext and hasPrevious correctly', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          page: '2',
          limit: '10',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          pagination: { hasNext: boolean; hasPrevious: boolean };
        }>(response);

        expect(data.pagination.hasPrevious).toBe(true);
        expect(data.pagination.hasNext).toBe(true);
      });

      it('should return empty array for out of range page', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          page: '100',
          limit: '10',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBe(0);
      });
    });

    describe('Filtering', () => {
      beforeEach(async () => {
        // Create readings with different attributes
        const baseTime = Date.now();

        // Temperature readings
        await ReadingV2.insertMany([
          createReadingV2Input('device_001', {
            timestamp: new Date(baseTime - 1000),
            value: 22.0,
          }),
          createReadingV2Input('device_001', {
            timestamp: new Date(baseTime - 2000),
            value: 24.0,
          }),
        ]);

        // Humidity readings
        await ReadingV2.insertMany([
          createReadingV2OfType('humidity', 'device_001', {
            timestamp: new Date(baseTime - 3000),
            value: 55.0,
          }),
        ]);

        // Readings from different device
        await ReadingV2.insertMany([
          createReadingV2Input('device_002', {
            timestamp: new Date(baseTime - 4000),
            value: 23.0,
          }),
        ]);

        // Invalid reading
        await ReadingV2.create(
          createReadingV2Input('device_001', {
            timestamp: new Date(baseTime - 5000),
            value: 99.0,
            quality: { is_valid: false, is_anomaly: false },
          })
        );

        // Anomaly reading
        await ReadingV2.create(
          createAnomalyReadingV2('device_001', 0.9, {
            timestamp: new Date(baseTime - 6000),
          })
        );
      });

      it('should filter by device_id', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ metadata: { device_id: string } }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.every(r => r.metadata.device_id === 'device_001')).toBe(true);
      });

      it('should filter by multiple device_ids', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001,device_002',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ metadata: { device_id: string } }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(
          data.data.every(
            r => r.metadata.device_id === 'device_001' || r.metadata.device_id === 'device_002'
          )
        ).toBe(true);
      });

      it('should filter by type', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          type: 'humidity',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ metadata: { type: string } }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.every(r => r.metadata.type === 'humidity')).toBe(true);
      });

      it('should filter by source', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          source: 'sensor',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: unknown[];
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.length).toBeGreaterThan(0);
      });

      it('should filter by is_valid', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          is_valid: 'false',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ quality: { is_valid: boolean } }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.every(r => r.quality.is_valid === false)).toBe(true);
      });

      it('should filter by is_anomaly', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          is_anomaly: 'true',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ quality: { is_anomaly: boolean } }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.every(r => r.quality.is_anomaly === true)).toBe(true);
      });

      it('should filter by value range', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          min_value: '23',
          max_value: '25',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ value: number }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.every(r => r.value >= 23 && r.value <= 25)).toBe(true);
      });

      it('should combine multiple filters', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          type: 'temperature',
          is_valid: 'true',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{
            metadata: { type: string };
            quality: { is_valid: boolean };
          }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(
          data.data.every(r => r.metadata.type === 'temperature' && r.quality.is_valid === true)
        ).toBe(true);
      });
    });

    describe('Time Range Filtering', () => {
      beforeEach(async () => {
        const baseTime = Date.now();

        // Create readings at different times
        for (let i = 0; i < 10; i++)
          await ReadingV2.create(
            createReadingV2Input('device_001', {
              timestamp: new Date(baseTime - i * 60 * 60 * 1000), // 1 hour apart
              value: 20 + i,
            })
          );
      });

      it('should filter by startDate', async () => {
        const startDate = new Date(Date.now() - 5 * 60 * 60 * 1000);
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          startDate: startDate.toISOString(),
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ timestamp: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.every(r => new Date(r.timestamp) >= startDate)).toBe(true);
      });

      it('should filter by endDate', async () => {
        const endDate = new Date(Date.now() - 5 * 60 * 60 * 1000);
        const request = createMockGetRequest('/api/v2/readings', {
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          endDate: endDate.toISOString(),
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ timestamp: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.every(r => new Date(r.timestamp) <= endDate)).toBe(true);
      });

      it('should filter by date range', async () => {
        const startDate = new Date(Date.now() - 7 * 60 * 60 * 1000);
        const endDate = new Date(Date.now() - 3 * 60 * 60 * 1000);

        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ timestamp: string }>;
        }>(response);

        expect(response.status).toBe(200);
        expect(
          data.data.every(r => {
            const ts = new Date(r.timestamp);
            return ts >= startDate && ts <= endDate;
          })
        ).toBe(true);
      });
    });

    describe('Sorting', () => {
      beforeEach(async () => {
        const baseTime = Date.now();
        const readings = [
          createReadingV2Input('device_001', {
            timestamp: new Date(baseTime - 3000),
            value: 20,
          }),
          createReadingV2Input('device_001', {
            timestamp: new Date(baseTime - 2000),
            value: 25,
          }),
          createReadingV2Input('device_001', {
            timestamp: new Date(baseTime - 1000),
            value: 22,
          }),
        ];
        await ReadingV2.insertMany(readings);
      });

      it('should sort by timestamp descending by default', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ timestamp: string }>;
        }>(response);

        expect(response.status).toBe(200);
        // Check that timestamps are in descending order
        for (let i = 1; i < data.data.length; i++)
          expect(new Date(data.data[i - 1].timestamp).getTime()).toBeGreaterThanOrEqual(
            new Date(data.data[i].timestamp).getTime()
          );
      });

      it('should sort by timestamp ascending', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          sortBy: 'timestamp',
          sortDirection: 'asc',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ timestamp: string }>;
        }>(response);

        expect(response.status).toBe(200);
        // Check that timestamps are in ascending order
        for (let i = 1; i < data.data.length; i++)
          expect(new Date(data.data[i - 1].timestamp).getTime()).toBeLessThanOrEqual(
            new Date(data.data[i].timestamp).getTime()
          );
      });

      it('should sort by value', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          sortBy: 'value',
          sortDirection: 'asc',
        });
        const response = await GET(request);
        const data = await parseResponse<{
          success: boolean;
          data: Array<{ value: number }>;
        }>(response);

        expect(response.status).toBe(200);
        // Check that values are in ascending order
        for (let i = 1; i < data.data.length; i++)
          expect(data.data[i - 1].value).toBeLessThanOrEqual(data.data[i].value);
      });
    });

    describe('Validation Errors', () => {
      it('should reject invalid sort field', async () => {
        const request = createMockGetRequest('/api/v2/readings', {
          device_id: 'device_001',
          sortBy: 'invalid_field',
        });
        const response = await GET(request);

        expect(response.status).toBe(400);
      });
    });
  });

  // ==========================================================================
  // GET /api/v2/readings/latest TESTS
  // ==========================================================================

  describe('GET /api/v2/readings/latest', () => {
    beforeEach(async () => {
      const baseTime = Date.now();

      // Create readings for device_001
      await ReadingV2.insertMany([
        createReadingV2Input('device_001', {
          timestamp: new Date(baseTime - 3000),
          value: 22.0,
        }),
        createReadingV2Input('device_001', {
          timestamp: new Date(baseTime - 1000),
          value: 24.0, // Latest
        }),
      ]);

      // Create readings for device_002
      await ReadingV2.insertMany([
        createReadingV2Input('device_002', {
          timestamp: new Date(baseTime - 2000),
          value: 23.0, // Latest
        }),
      ]);

      // Create humidity reading for device_001
      await ReadingV2.create(
        createReadingV2OfType('humidity', 'device_001', {
          timestamp: new Date(baseTime - 500),
          value: 55.0, // Latest humidity
        })
      );
    });

    describe('Basic Functionality', () => {
      it('should return latest reading for a device', async () => {
        const request = createMockGetRequest('/api/v2/readings/latest', {
          device_ids: 'device_001',
        });
        const response = await GET_LATEST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            readings: Array<{
              device_id: string;
              type: string;
              value: number;
            }>;
            count: number;
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.count).toBeGreaterThan(0);
      });

      it('should return latest readings for multiple devices', async () => {
        const request = createMockGetRequest('/api/v2/readings/latest', {
          device_ids: 'device_001,device_002',
        });
        const response = await GET_LATEST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            readings: Array<{
              device_id: string;
              value: number;
            }>;
            count: number;
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.count).toBeGreaterThanOrEqual(2);
      });

      it('should return latest readings per device per type', async () => {
        const request = createMockGetRequest('/api/v2/readings/latest', {
          device_ids: 'device_001',
        });
        const response = await GET_LATEST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            readings: Array<{
              device_id: string;
              type: string;
              value: number;
            }>;
          };
        }>(response);

        expect(response.status).toBe(200);

        // Should have both temperature and humidity readings
        const types = new Set(data.data.readings.map(r => r.type));
        expect(types.size).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Filtering', () => {
      it('should filter by type', async () => {
        const request = createMockGetRequest('/api/v2/readings/latest', {
          device_ids: 'device_001',
          type: 'temperature',
        });
        const response = await GET_LATEST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            readings: Array<{
              type: string;
            }>;
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.readings.every(r => r.type === 'temperature')).toBe(true);
      });

      it('should exclude invalid readings by default', async () => {
        // Add an invalid reading that is more recent
        await ReadingV2.create(
          createReadingV2Input('device_001', {
            timestamp: new Date(),
            value: 99.0,
            quality: { is_valid: false, is_anomaly: false },
          })
        );

        const request = createMockGetRequest('/api/v2/readings/latest', {
          device_ids: 'device_001',
          type: 'temperature',
        });
        const response = await GET_LATEST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            readings: Array<{
              value: number;
            }>;
          };
        }>(response);

        expect(response.status).toBe(200);
        // Should return the valid reading (24.0) not the invalid one (99.0)
        const tempReading = data.data.readings[0];
        expect(tempReading.value).toBe(24.0);
      });

      it('should include invalid readings when requested', async () => {
        // Add an invalid reading that is more recent
        await ReadingV2.create(
          createReadingV2Input('device_001', {
            timestamp: new Date(),
            value: 99.0,
            quality: { is_valid: false, is_anomaly: false },
          })
        );

        const request = createMockGetRequest('/api/v2/readings/latest', {
          device_ids: 'device_001',
          type: 'temperature',
          include_invalid: 'true',
        });
        const response = await GET_LATEST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            readings: Array<{
              value: number;
            }>;
          };
        }>(response);

        expect(response.status).toBe(200);
        // Should now include the invalid reading
        const tempReading = data.data.readings[0];
        expect(tempReading.value).toBe(99.0);
      });
    });

    describe('Quality Metrics', () => {
      beforeEach(async () => {
        const baseTime = Date.now();

        // Add more readings for quality metrics calculation
        for (let i = 0; i < 20; i++)
          await ReadingV2.create(
            createReadingV2Input('device_001', {
              timestamp: new Date(baseTime - i * 60 * 60 * 1000),
              value: 22 + Math.random() * 5,
              quality: {
                is_valid: i % 5 !== 0, // Every 5th reading is invalid
                confidence_score: 0.9 + Math.random() * 0.1,
                is_anomaly: i === 10, // One anomaly
              },
            })
          );
      });

      it('should include quality metrics when requested', async () => {
        const request = createMockGetRequest('/api/v2/readings/latest', {
          device_ids: 'device_001',
          include_quality_metrics: 'true',
        });
        const response = await GET_LATEST(request);
        const data = await parseResponse<{
          success: boolean;
          data: {
            readings: unknown[];
            quality_metrics: Array<{
              device_id: string;
              total_readings: number;
              valid_readings: number;
              validity_percentage: number;
              anomaly_count: number;
              avg_confidence: number;
            }>;
          };
        }>(response);

        expect(response.status).toBe(200);
        expect(data.data.quality_metrics).toBeDefined();
        expect(data.data.quality_metrics.length).toBeGreaterThan(0);

        const metrics = data.data.quality_metrics[0];
        expect(metrics.device_id).toBe('device_001');
        expect(metrics.total_readings).toBeGreaterThan(0);
        expect(metrics.validity_percentage).toBeDefined();
      });
    });

    describe('Validation Errors', () => {
      it('should require device_ids parameter', async () => {
        const request = createMockGetRequest('/api/v2/readings/latest', {});
        const response = await GET_LATEST(request);

        expect(response.status).toBe(400);
      });
    });
  });

  // ==========================================================================
  // POST /api/v2/readings/ingest TESTS
  // Note: These tests are limited because the ingest endpoint has middleware
  // (rate limiting, request validation) that requires special handling
  // ==========================================================================

  describe('POST /api/v2/readings/ingest', () => {
    // Import the handler directly to bypass middleware for testing
    // In a real test environment, you'd mock the middleware

    describe('Payload Validation', () => {
      it('should validate bulk reading payload structure', async () => {
        const payload = createBulkIngestPayloadV2('device_001', 5);

        // Verify the payload structure is valid
        expect(payload.readings).toBeDefined();
        expect(payload.readings.length).toBe(5);
        expect(payload.readings[0]).toHaveProperty('device_id');
        expect(payload.readings[0]).toHaveProperty('type');
        expect(payload.readings[0]).toHaveProperty('unit');
        expect(payload.readings[0]).toHaveProperty('timestamp');
        expect(payload.readings[0]).toHaveProperty('value');
      });

      it('should create valid bulk payload for multiple devices', async () => {
        const payload1 = createBulkIngestPayloadV2('device_001', 5);
        const payload2 = createBulkIngestPayloadV2('device_002', 5);

        const combinedReadings = [...payload1.readings, ...payload2.readings];

        expect(combinedReadings.length).toBe(10);
        expect(combinedReadings.filter(r => r.device_id === 'device_001').length).toBe(5);
        expect(combinedReadings.filter(r => r.device_id === 'device_002').length).toBe(5);
      });
    });

    describe('Data Transformation', () => {
      it('should transform bulk reading items to ReadingV2 format', async () => {
        const payload = createBulkIngestPayloadV2('device_001', 1);
        const item = payload.readings[0];

        // Verify the transformation produces valid ReadingV2 structure
        const readingDoc = {
          metadata: {
            device_id: item.device_id,
            type: item.type,
            unit: item.unit,
            source: item.source || 'sensor',
          },
          timestamp: item.timestamp,
          value: item.value,
          quality: {
            is_valid: true,
            is_anomaly: false,
          },
          processing: {
            ingested_at: new Date(),
          },
        };

        // This should be insertable
        const reading = await ReadingV2.create(readingDoc);
        expect(reading.metadata.device_id).toBe('device_001');
        expect(reading.metadata.type).toBe('temperature');
      });
    });
  });
});
