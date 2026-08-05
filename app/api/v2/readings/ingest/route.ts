/**
 * V2 Readings Ingest API Route
 *
 * POST /api/v2/readings/ingest - Bulk insert readings with validation
 *
 * Phase 5 Features:
 * - Rate limiting by IP and Device ID
 * - Request body size validation (10MB max)
 * - Metrics recording for ingestion
 * - Structured logging
 * - Cache invalidation for readings
 */

import type { NextRequest } from 'next/server';
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
import { safeEvaluateReadings } from '@/lib/alerting';

// Phase 5 imports
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { logger, recordIngestion, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { invalidateReadings } from '@/lib/cache';

// Auth
import { requireAdmin, getAuditUser } from '@/lib/auth';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 500; // Process readings in batches
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

async function handleIngest(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require admin and get user info for audit
    const authContext = await requireAdmin();
    const auditUser = getAuditUser(authContext.userId, authContext.user);

    await dbConnect();

    // Parse and validate request body
    const body = await request.json();
    const validationResult = validateInput(body, bulkIngestReadingsSchema);

    if (!validationResult.success) {
      logger.validationFailure('/api/v2/readings/ingest', validationResult.errors);
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );
    }

    const data = validationResult.data as BulkIngestReadingsInput;

    // Enforce max readings limit
    if (data.readings.length > MAX_READINGS_PER_REQUEST)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        `Cannot ingest more than ${MAX_READINGS_PER_REQUEST} readings in a single request`,
        { received: String(data.readings.length), max: String(MAX_READINGS_PER_REQUEST) }
      );

    // Check idempotency (simple in-memory check - in production use Redis)
    // For now, we'll skip idempotency check implementation

    // Validate that devices exist (batch check). The projection carries every
    // field the alert selector needs — evaluation reuses this result rather than
    // issuing a second device query.
    const deviceIds = [...new Set(data.readings.map(r => r.device_id))];
    const existingDevices = await DeviceV2.find(
      { _id: { $in: deviceIds }, 'audit.deleted_at': { $exists: false } },
      { _id: 1, type: 1, location: 1, 'metadata.tags': 1 }
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

    // Batch insert valid readings, accumulating exactly the documents that
    // persisted. `insertedReadings` — never `validReadings`, which is only
    // what was ATTEMPTED — is what alert evaluation below must see: a
    // reading that never made it into `readings_v2` must never be allowed to
    // fire or resolve an alert. Mirrors the cron path's identical fix
    // (commits 2480e01, 4cb3d26), which threads bulkInsertReadings' returned
    // subset through the same way.
    const insertedReadings: Partial<IReadingV2>[] = [];

    if (validReadings.length > 0)
      // Process in batches to avoid overwhelming the database
      for (let i = 0; i < validReadings.length; i += BATCH_SIZE) {
        const batch = validReadings.slice(i, i + BATCH_SIZE);

        try {
          const insertResult = await ReadingV2.insertMany(batch, {
            ordered: false, // Continue on error
          });
          const successfulInsertsInBatch = insertResult.length;
          results.inserted += successfulInsertsInBatch;
          insertedReadings.push(...insertResult);
          const batchFailures = batch.length - successfulInsertsInBatch;
          if (batchFailures > 0) {
            results.rejected += batchFailures;
            results.errors.push({
              index: i,
              device_id: 'batch',
              error: 'Some documents in batch failed to insert',
            });
          }
        } catch (error: unknown) {
          // Handle bulk write errors (some may have succeeded). With
          // `ordered: false`, MongoBulkWriteError.insertedIds is the driver's
          // index -> _id map for exactly the documents THIS batch actually
          // wrote (index is relative to `batch`, not the full request) — map
          // those indices back to `batch` to recover the persisted subset.
          let successfulInsertsInBatch = 0;
          if (error && typeof error === 'object' && 'insertedCount' in error) {
            const bulkError = error as {
              insertedCount: number;
              insertedIds?: Record<number, unknown>;
            };
            successfulInsertsInBatch = bulkError.insertedCount ?? 0;
            results.inserted += successfulInsertsInBatch;

            if (bulkError.insertedIds)
              for (const key of Object.keys(bulkError.insertedIds)) {
                const persisted = batch[Number(key)];
                if (persisted) insertedReadings.push(persisted);
              }
            else if (successfulInsertsInBatch > 0)
              // No insertedIds to identify which specific entries survived.
              // Deliberate under-approximation: treat this batch as
              // contributing NOTHING to evaluation rather than guessing.
              // `results.inserted` above still counts them correctly for the
              // response — only alert evaluation loses visibility into a
              // reading that genuinely persisted this cycle, which is a real
              // but strictly safer failure than the bug being fixed (a
              // non-existent reading firing an alert).
              logger.warn(
                'Bulk insert partially failed without insertedIds; this batch will not be evaluated for alerts',
                {
                  batchStart: i,
                  batchSize: batch.length,
                  insertedCount: successfulInsertsInBatch,
                }
              );
          }

          // Count failures
          const batchFailures = batch.length - successfulInsertsInBatch;
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

    // Update device health.last_seen for all ingested devices
    if (results.inserted > 0) {
      await DeviceV2.updateMany(
        { _id: { $in: [...existingDeviceIds] } },
        {
          $set: {
            'health.last_seen': new Date(),
            'audit.updated_at': new Date(),
            'audit.updated_by': auditUser,
          },
        }
      );

      // Invalidate readings cache (non-blocking)
      invalidateReadings(authContext.orgId).catch(() => {
        // Error already logged in invalidateReadings
      });
    }

    // Evaluate alert rules against the readings that actually persisted.
    // Runs strictly after the inserts have committed and cannot affect them;
    // safeEvaluateReadings never throws. Gated on insertedReadings, not
    // results.inserted: the two can differ (see the insertedIds-less
    // fallback above), and only the former is safe to hand to the evaluator.
    if (insertedReadings.length > 0) {
      const evaluation = await safeEvaluateReadings(
        insertedReadings,
        existingDevices as unknown as Parameters<typeof safeEvaluateReadings>[1]
      );

      // An alert firing (or auto-resolving) is a domain event in its own right,
      // not just an ingest side effect — log it distinctly from the "Readings
      // ingested" summary below, which says nothing about alerting.
      if (evaluation.fired.length || evaluation.resolved.length) {
        const affected = [...evaluation.fired, ...evaluation.resolved];
        logger.info('Alert rules fired or resolved during ingest', {
          fired: evaluation.fired.length,
          resolved: evaluation.resolved.length,
          ruleIds: [...new Set(affected.map(a => a.rule_id))],
          deviceIds: [...new Set(affected.map(a => a.device_id))],
        });
      }
    }

    // Record metrics
    const duration = timer.elapsed();
    recordIngestion(results.inserted, results.rejected);
    recordRequest('POST', '/api/v2/readings/ingest', 201, duration);

    logger.info('Readings ingested', {
      inserted: results.inserted,
      rejected: results.rejected,
      duration,
      deviceCount: existingDeviceIds.size,
      submittedBy: auditUser,
    });

    return jsonSuccess(
      {
        inserted: results.inserted,
        rejected: results.rejected,
        errors: results.errors.slice(0, 10), // Limit error details
        total_errors: results.errors.length,
        submitted_by: auditUser,
        submitted_at: new Date().toISOString(),
      },
      `Ingested ${results.inserted} readings`,
      201
    );
  })();
}

// Export with middleware: Rate Limiting -> Request Validation -> Handler
export const POST = withRateLimit(
  withRequestValidation(handleIngest, ValidationPresets.bulkIngestion)
);
