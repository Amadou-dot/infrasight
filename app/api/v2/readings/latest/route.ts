/**
 * V2 Latest Readings API Route
 *
 * GET /api/v2/readings/latest - Get latest readings for devices
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  latestReadingsQuerySchema,
  type LatestReadingsQuery,
} from '@/lib/validations/v2/reading.validation';
import { validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';

// ============================================================================
// GET /api/v2/readings/latest - Get Latest Readings
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, latestReadingsQuerySchema);
    if (!validationResult.success) 
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );
    

    const query = validationResult.data as LatestReadingsQuery;

    // Build match stage
    const matchStage: Record<string, unknown> = {};

    // Device IDs filter
    if (query.device_ids) {
      const deviceIds = Array.isArray(query.device_ids) ? query.device_ids : [query.device_ids];
      matchStage['metadata.device_id'] = { $in: deviceIds };
    }

    // Type filter
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      matchStage['metadata.type'] = types.length === 1 ? types[0] : { $in: types };
    }

    // Quality filter
    if (!query.include_invalid) 
      matchStage['quality.is_valid'] = true;
    

    // Aggregation pipeline to get latest reading per device
    const pipeline = [
      { $match: matchStage },
      { $sort: { timestamp: -1 as const } },
      {
        $group: {
          _id: {
            device_id: '$metadata.device_id',
            type: '$metadata.type',
          },
          latest_reading: { $first: '$$ROOT' },
        },
      },
      {
        $project: {
          _id: 0,
          device_id: '$_id.device_id',
          type: '$_id.type',
          value: '$latest_reading.value',
          unit: '$latest_reading.metadata.unit',
          timestamp: '$latest_reading.timestamp',
          quality: '$latest_reading.quality',
          context: '$latest_reading.context',
        },
      },
    ];

    const latestReadings = await ReadingV2.aggregate(pipeline);

    // Include quality metrics if requested
    const response: Record<string, unknown> = {
      readings: latestReadings,
      count: latestReadings.length,
    };

    if (query.include_quality_metrics && query.device_ids) {
      const deviceIds = Array.isArray(query.device_ids) ? query.device_ids : [query.device_ids];
      
      // Calculate quality metrics
      const qualityPipeline = [
        {
          $match: {
            'metadata.device_id': { $in: deviceIds },
            timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
          },
        },
        {
          $group: {
            _id: '$metadata.device_id',
            total_readings: { $sum: 1 },
            valid_readings: {
              $sum: { $cond: ['$quality.is_valid', 1, 0] },
            },
            anomaly_count: {
              $sum: { $cond: ['$quality.is_anomaly', 1, 0] },
            },
            avg_confidence: { $avg: '$quality.confidence_score' },
          },
        },
        {
          $project: {
            _id: 0,
            device_id: '$_id',
            total_readings: 1,
            valid_readings: 1,
            validity_percentage: {
              $multiply: [
                { $divide: ['$valid_readings', { $max: ['$total_readings', 1] }] },
                100,
              ],
            },
            anomaly_count: 1,
            avg_confidence: { $round: ['$avg_confidence', 3] },
          },
        },
      ];

      const qualityMetrics = await ReadingV2.aggregate(qualityPipeline);
      response.quality_metrics = qualityMetrics;
    }

    return jsonSuccess(response);
  })();
}
