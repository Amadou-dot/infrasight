import {
  calculateOffsetPagination,
  getOffsetPaginationParams,
  MAX_ANALYTICS_PAGE_SIZE,
} from '@/lib/api/pagination';
import { anomaliesKey, CACHE_TTL } from '@/lib/cache';
import { type ReadContext, readCachedSnapshot, readOptions } from '@/lib/data/read-context';
import type { AnomalyAnalyticsQuery } from '@/lib/validations/v2/reading.validation';
import ReadingV2 from '@/models/v2/ReadingV2';

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

export async function readAnomalies(context: ReadContext, query: AnomalyAnalyticsQuery) {
  const snapshot = await readCachedSnapshot(
    anomaliesKey(context, query),
    CACHE_TTL.ANOMALIES,
    context,
    async () => {
      const options = readOptions(context);
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
        const deviceIds = Array.isArray(query.device_id) ? query.device_id : [query.device_id];
        matchStage['metadata.device_id'] =
          deviceIds.length === 1 ? deviceIds[0] : { $in: deviceIds };
      }

      // Type filter
      if (query.type) {
        const types = Array.isArray(query.type) ? query.type : [query.type];
        matchStage['metadata.type'] = types.length === 1 ? types[0] : { $in: types };
      }

      // Time range filter
      if (query.startDate || query.endDate) {
        matchStage.timestamp = {};
        if (query.startDate)
          (matchStage.timestamp as Record<string, Date>).$gte = new Date(query.startDate);

        if (query.endDate)
          (matchStage.timestamp as Record<string, Date>).$lte = new Date(query.endDate);
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
          .setOptions(options)
          .lean(),
        ReadingV2.countDocuments(matchStage).setOptions(options),
      ]);

      // Calculate pagination info
      const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

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

        trends = await ReadingV2.aggregate(trendPipeline).option(options);
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
      ]).option(options);

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
      ]).option(options);

      return {
        anomalies,
        pagination: paginationInfo,
        summary: {
          total_anomalies: total,
          by_device: deviceBreakdown,
          by_type: typeBreakdown,
        },
        trends: trends,
      };
    }
  );
  // Equivalent ID/type sets share data. Echo the filters supplied by this caller.
  return {
    ...snapshot,
    data: {
      ...snapshot.data,
      filters_applied: {
        device_id: query.device_id || null,
        type: query.type || null,
        min_score: query.min_score,
        time_range: { start: query.startDate?.toISOString(), end: query.endDate?.toISOString() },
      },
    },
  };
}
