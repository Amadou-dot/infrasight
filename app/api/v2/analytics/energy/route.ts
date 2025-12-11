/**
 * V2 Energy Analytics API Route
 *
 * GET /api/v2/analytics/energy - Energy/reading analytics with aggregation
 */

import { type NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  readingAnalyticsQuerySchema,
  type ReadingAnalyticsQuery,
} from '@/lib/validations/v2/reading.validation';
import { validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';

// ============================================================================
// Helper: Get date format string for granularity
// ============================================================================

function getDateFormat(granularity: string): string {
  switch (granularity) {
    case 'second':
      return '%Y-%m-%dT%H:%M:%S';
    case 'minute':
      return '%Y-%m-%dT%H:%M:00';
    case 'hour':
      return '%Y-%m-%dT%H:00:00';
    case 'day':
      return '%Y-%m-%d';
    case 'week':
      return '%Y-W%V';
    case 'month':
      return '%Y-%m';
    default:
      return '%Y-%m-%dT%H:00:00';
  }
}

// ============================================================================
// Helper: Build aggregation operator
// ============================================================================

function getAggregationOperator(type: string): Record<string, unknown> {
  switch (type) {
    case 'sum':
      return { $sum: '$value' };
    case 'avg':
      return { $avg: '$value' };
    case 'min':
      return { $min: '$value' };
    case 'max':
      return { $max: '$value' };
    case 'count':
      return { $sum: 1 };
    case 'first':
      return { $first: '$value' };
    case 'last':
      return { $last: '$value' };
    default:
      return { $avg: '$value' };
  }
}

// ============================================================================
// GET /api/v2/analytics/energy - Energy Analytics
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, readingAnalyticsQuerySchema);
    if (!validationResult.success) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );
    }

    const query = validationResult.data as ReadingAnalyticsQuery;

    // Build match stage
    const matchStage: Record<string, unknown> = {};

    // Device filter
    if (query.device_id) {
      const deviceIds = Array.isArray(query.device_id) ? query.device_id : [query.device_id];
      matchStage['metadata.device_id'] = deviceIds.length === 1 ? deviceIds[0] : { $in: deviceIds };
    }

    // Type filter
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      matchStage['metadata.type'] = types.length === 1 ? types[0] : { $in: types };
    }

    // Time range filter
    if (query.startDate || query.endDate) {
      matchStage.timestamp = {};
      if (query.startDate) {
        (matchStage.timestamp as Record<string, Date>).$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        (matchStage.timestamp as Record<string, Date>).$lte = new Date(query.endDate);
      }
    }

    // Quality filter
    if (!query.include_invalid) {
      matchStage['quality.is_valid'] = true;
    }

    // Build group stage based on granularity and group_by
    const dateFormat = getDateFormat(query.granularity || 'hour');
    const aggOperator = getAggregationOperator(query.aggregation || 'avg');

    // Build group _id based on group_by option
    let groupId: Record<string, unknown> = {
      time_bucket: { $dateToString: { format: dateFormat, date: '$timestamp' } },
    };

    if (query.group_by) {
      switch (query.group_by) {
        case 'device':
          groupId.device_id = '$metadata.device_id';
          break;
        case 'type':
          groupId.type = '$metadata.type';
          break;
        // Note: floor, room, building, department require $lookup to devices collection
        // For simplicity, we'll add device_id and let the client join
        default:
          groupId.device_id = '$metadata.device_id';
      }
    }

    // Build aggregation pipeline
    const pipeline = [
      { $match: matchStage },
      { $sort: { timestamp: 1 as const } },
      {
        $group: {
          _id: groupId,
          value: aggOperator,
          count: { $sum: 1 },
          min_value: { $min: '$value' },
          max_value: { $max: '$value' },
          first_timestamp: { $first: '$timestamp' },
          last_timestamp: { $last: '$timestamp' },
        },
      },
      {
        $project: {
          _id: 0,
          time_bucket: '$_id.time_bucket',
          device_id: '$_id.device_id',
          type: '$_id.type',
          value: { $round: ['$value', 3] },
          count: 1,
          min_value: { $round: ['$min_value', 3] },
          max_value: { $round: ['$max_value', 3] },
          first_timestamp: 1,
          last_timestamp: 1,
        },
      },
      { $sort: { time_bucket: 1 as const } },
    ];

    // Execute aggregation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await ReadingV2.aggregate(pipeline as any);

    // Calculate metadata
    const excludedInvalid = !query.include_invalid;
    let invalidCount = 0;
    
    if (excludedInvalid) {
      // Count excluded invalid readings
      const invalidMatchStage = { ...matchStage };
      delete invalidMatchStage['quality.is_valid'];
      invalidMatchStage['quality.is_valid'] = false;
      
      invalidCount = await ReadingV2.countDocuments(invalidMatchStage);
    }

    return jsonSuccess({
      results,
      metadata: {
        granularity: query.granularity || 'hour',
        aggregation_type: query.aggregation || 'avg',
        total_points: results.length,
        excluded_invalid: invalidCount,
        group_by: query.group_by || null,
        time_range: {
          start: query.startDate,
          end: query.endDate,
        },
      },
    });
  })();
}
