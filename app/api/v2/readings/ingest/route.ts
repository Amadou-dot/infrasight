/**
 * V2 Readings Ingest API Route
 *
 * POST /api/v2/readings/ingest - Bulk insert readings with validation
 */

import { type NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import ReadingV2, { type IReadingV2 } from '@/models/v2/ReadingV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  bulkIngestReadingsSchema,
  type BulkIngestReadingsInput,
  type BulkReadingItem,
} from '@/lib/validations/v2/reading.validation';
import { validateInput } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100; // Process readings in batches
const MAX_READINGS_PER_REQUEST = 10000;

// ============================================================================
// Helper: Map unit based on type
// ============================================================================

function getDefaultUnit(type: string): string {
  const unitMap: Record<string, string> = {
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
  return unitMap[type] || 'raw';
}

// ============================================================================
// Helper: Transform bulk item to ReadingV2 document
// ============================================================================

function transformToReadingDoc(item: BulkReadingItem): Partial<IReadingV2> {
  return {
    metadata: {
      device_id: item.device_id,
      type: item.type,
      unit: item.unit || getDefaultUnit(item.type),
      source: item.source || 'sensor',
    },
    timestamp: item.timestamp instanceof Date ? item.timestamp : new Date(item.timestamp),
    value: item.value,
    quality: {
      is_valid: true,
      confidence_score: item.confidence_score ?? 0.95,
      is_anomaly: false,
      anomaly_score: 0,
    },
    context: {
      battery_level: item.battery_level,
      signal_strength: item.signal_strength,
    },
    processing: {
      raw_value: item.raw_value ?? item.value,
      calibration_offset: item.calibration_offset ?? 0,
      ingested_at: new Date(),
    },
  };
}

// ============================================================================
// POST /api/v2/readings/ingest - Bulk Insert Readings
// ============================================================================

export async function POST(request: NextRequest) {
  return withErrorHandler(async () => {
    await dbConnect();

    // Parse and validate request body
    const body = await request.json();
    const validationResult = validateInput(body, bulkIngestReadingsSchema);
    
    if (!validationResult.success) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );
    }

    const data = validationResult.data as BulkIngestReadingsInput;

    // Enforce max readings limit
    if (data.readings.length > MAX_READINGS_PER_REQUEST) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        `Cannot ingest more than ${MAX_READINGS_PER_REQUEST} readings in a single request`,
        { received: String(data.readings.length), max: String(MAX_READINGS_PER_REQUEST) }
      );
    }

    // Check idempotency (simple in-memory check - in production use Redis)
    // For now, we'll skip idempotency check implementation

    // Validate that devices exist (batch check)
    const deviceIds = [...new Set(data.readings.map(r => r.device_id))];
    const existingDevices = await DeviceV2.find(
      { _id: { $in: deviceIds }, 'audit.deleted_at': { $exists: false } },
      { _id: 1 }
    ).lean();
    
    const existingDeviceIds = new Set(existingDevices.map(d => d._id));
    const missingDevices = deviceIds.filter(id => !existingDeviceIds.has(id));

    // Results tracking
    const results = {
      inserted: 0,
      rejected: 0,
      errors: [] as Array<{ index: number; device_id: string; error: string }>,
    };

    // Process readings and collect errors for missing devices
    const validReadings: Partial<IReadingV2>[] = [];
    
    for (let i = 0; i < data.readings.length; i++) {
      const item = data.readings[i];
      
      // Check if device exists
      if (missingDevices.includes(item.device_id)) {
        results.rejected++;
        results.errors.push({
          index: i,
          device_id: item.device_id,
          error: `Device '${item.device_id}' not found`,
        });
        continue;
      }

      // Transform to reading document
      try {
        const readingDoc = transformToReadingDoc(item);
        validReadings.push(readingDoc);
      } catch (error) {
        results.rejected++;
        results.errors.push({
          index: i,
          device_id: item.device_id,
          error: error instanceof Error ? error.message : 'Transformation failed',
        });
      }
    }

    // Batch insert valid readings
    if (validReadings.length > 0) {
      // Process in batches to avoid overwhelming the database
      for (let i = 0; i < validReadings.length; i += BATCH_SIZE) {
        const batch = validReadings.slice(i, i + BATCH_SIZE);
        
        try {
          const insertResult = await ReadingV2.insertMany(batch, { 
            ordered: false // Continue on error
          });
          results.inserted += insertResult.length;
        } catch (error: unknown) {
          // Handle bulk write errors (some may have succeeded)
          if (error && typeof error === 'object' && 'insertedDocs' in error) {
            const bulkError = error as { insertedDocs: unknown[] };
            results.inserted += bulkError.insertedDocs?.length || 0;
          }
          
          // Count failures
          const batchFailures = batch.length - (results.inserted - (results.inserted - batch.length));
          if (batchFailures > 0) {
            results.rejected += batchFailures;
            results.errors.push({
              index: i,
              device_id: 'batch',
              error: error instanceof Error ? error.message : 'Batch insert failed',
            });
          }
        }
      }
    }

    // Update device health.last_seen for all ingested devices
    if (results.inserted > 0) {
      await DeviceV2.updateMany(
        { _id: { $in: [...existingDeviceIds] } },
        { 
          $set: { 
            'health.last_seen': new Date(),
            'audit.updated_at': new Date(),
          } 
        }
      );
    }

    return jsonSuccess(
      {
        inserted: results.inserted,
        rejected: results.rejected,
        errors: results.errors.slice(0, 10), // Limit error details
        total_errors: results.errors.length,
      },
      `Ingested ${results.inserted} readings`,
      201
    );
  })();
}
