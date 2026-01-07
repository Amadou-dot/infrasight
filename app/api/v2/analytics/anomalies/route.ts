/**
 * V2 Anomalies Analytics API Route
 *
 * GET /api/v2/analytics/anomalies - Anomaly detection and trends
 *
 * Phase 5 Features:
 * - Redis caching with 1-minute TTL
 * - Metrics and logging
 */

import {
  calculateOffsetPagination,
  getOffsetPaginationParams,
  MAX_ANALYTICS_PAGE_SIZE,
} from '@/lib/api/pagination';
import { jsonSuccess } from '@/lib/api/response';
import dbConnect from '@/lib/db';
import { ApiError, ErrorCodes, withErrorHandler } from '@/lib/errors';
import {
  anomalyAnalyticsQuerySchema,
  type AnomalyAnalyticsQuery,
} from '@/lib/validations/v2/reading.validation';
import { validateQuery } from '@/lib/validations/validator';
import ReadingV2 from '@/models/v2/ReadingV2';
import type { NextRequest } from 'next/server';

// Phase 5 imports
import { getOrSet, CACHE_TTL, analyticsKey } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';

// ============================================================================
// Helper: Get date format for bucketing
// ============================================================================

function getDateFormat(granularity: string): string {
  switch (granularity) {
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
// GET /api/v2/analytics/anomalies - Anomaly Analytics
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(
      searchParams,
      anomalyAnalyticsQuerySchema
    );
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as AnomalyAnalyticsQuery;

    // Generate cache key based on query parameters
    const cacheKey = analyticsKey('anomalies', {
      device_id: query.device_id,
      type: query.type,
      startDate: query.startDate,
      endDate: query.endDate,
      min_score: query.min_score,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
      bucket_granularity: query.bucket_granularity,
    });

    // Use cache-aside pattern
    const response = await getOrSet(
      cacheKey,
      async () => {

    // Extract pagination (analytics endpoints allow higher limits)
    const pagination = getOffsetPaginationParams(
      {
        page: query.page,
        limit: query.limit,
      },
      { maxLimit: MAX_ANALYTICS_PAGE_SIZE }
    );

    // Build match stage
    const matchStage: Record<string, unknown> = {
      'quality.is_anomaly': true,
    };

    // Device filter
    if (query.device_id) {
      const deviceIds = Array.isArray(query.device_id)
        ? query.device_id
        : [query.device_id];
      matchStage['metadata.device_id'] =
        deviceIds.length === 1 ? deviceIds[0] : { $in: deviceIds };
    }

    // Type filter
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      matchStage['metadata.type'] =
        types.length === 1 ? types[0] : { $in: types };
    }

    // Time range filter
    if (query.startDate || query.endDate) {
      matchStage.timestamp = {};
      if (query.startDate)
        (matchStage.timestamp as Record<string, Date>).$gte = new Date(
          query.startDate
        );

      if (query.endDate)
        (matchStage.timestamp as Record<string, Date>).$lte = new Date(
          query.endDate
        );
    }

    // Minimum anomaly score filter
    if (query.min_score !== undefined)
      matchStage['quality.anomaly_score'] = { $gte: query.min_score };

    // Build sort
    const sortOrder = query.sortDirection === 'asc' ? 1 : -1;
    const sortField = query.sortBy || 'timestamp';
    const sortFieldMap: Record<string, string> = {
      timestamp: 'timestamp',
      anomaly_score: 'quality.anomaly_score',
      value: 'value',
    };
    const sort: Record<string, 1 | -1> = {
      [sortFieldMap[sortField] || sortField]: sortOrder,
    };

    // Get total count and paginated anomalies
    const [anomalies, total] = await Promise.all([
      ReadingV2.find(matchStage)
        .sort(sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .maxTimeMS(5000)
        .lean(),
      ReadingV2.countDocuments(matchStage).maxTimeMS(5000),
    ]);

    // Calculate pagination info
    const paginationInfo = calculateOffsetPagination(
      total,
      pagination.page,
      pagination.limit
    );

    // Get anomaly trends if bucket_granularity is specified
    let trends = null;
    if (query.bucket_granularity) {
      const dateFormat = getDateFormat(query.bucket_granularity);

      const trendPipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: {
              time_bucket: {
                $dateToString: { format: dateFormat, date: '$timestamp' },
              },
            },
            count: { $sum: 1 },
            avg_score: { $avg: '$quality.anomaly_score' },
            max_score: { $max: '$quality.anomaly_score' },
          },
        },
        {
          $project: {
            _id: 0,
            time_bucket: '$_id.time_bucket',
            count: 1,
            avg_score: { $round: ['$avg_score', 3] },
            max_score: { $round: ['$max_score', 3] },
          },
        },
        { $sort: { time_bucket: 1 as const } },
      ];

      trends = await ReadingV2.aggregate(trendPipeline).option({ maxTimeMS: 5000 });
    }

    // Get anomaly breakdown by device
    const deviceBreakdown = await ReadingV2.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$metadata.device_id',
          count: { $sum: 1 },
          avg_score: { $avg: '$quality.anomaly_score' },
          latest_timestamp: { $max: '$timestamp' },
        },
      },
      {
        $project: {
          _id: 0,
          device_id: '$_id',
          count: 1,
          avg_score: { $round: ['$avg_score', 3] },
          latest_timestamp: 1,
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: 5000 });

    // Get anomaly breakdown by type
    const typeBreakdown = await ReadingV2.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$metadata.type',
          count: { $sum: 1 },
          avg_score: { $avg: '$quality.anomaly_score' },
        },
      },
      {
        $project: {
          _id: 0,
          type: '$_id',
          count: 1,
          avg_score: { $round: ['$avg_score', 3] },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: 5000 });

        return {
          anomalies,
          pagination: paginationInfo,
          summary: {
            total_anomalies: total,
            by_device: deviceBreakdown,
            by_type: typeBreakdown,
          },
          trends: trends,
          filters_applied: {
            device_id: query.device_id || null,
            type: query.type || null,
            min_score: query.min_score,
            time_range: {
              start: query.startDate,
              end: query.endDate,
            },
          },
        };
      },
      { ttl: CACHE_TTL.ANOMALIES }
    );

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/analytics/anomalies', 200, duration);

    logger.debug('Anomalies analytics request', {
      duration,
      cached: duration < 50,
      cacheKey,
    });

    return jsonSuccess(response);
  })();
}
