import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { type ReadContext, fieldProjection, readOptions } from '@/lib/data/read-context';
import type { ListReadingsQuery } from '@/lib/validations/v2/reading.validation';
import ReadingV2 from '@/models/v2/ReadingV2';

export async function readReadings(context: ReadContext, query: ListReadingsQuery) {
  const options = readOptions(context);
  // Extract pagination
  const pagination = getOffsetPaginationParams({
    page: query.page,
    limit: query.limit,
  });

  // Build filter query
  const filter: Record<string, unknown> = {};

  // Device ID filter
  if (query.device_id) {
    const deviceIds = Array.isArray(query.device_id) ? query.device_id : [query.device_id];
    filter['metadata.device_id'] = deviceIds.length === 1 ? deviceIds[0] : { $in: deviceIds };
  }

  // Type filter
  if (query.type) {
    const types = Array.isArray(query.type) ? query.type : [query.type];
    filter['metadata.type'] = types.length === 1 ? types[0] : { $in: types };
  }

  // Source filter
  if (query.source) {
    const sources = Array.isArray(query.source) ? query.source : [query.source];
    filter['metadata.source'] = sources.length === 1 ? sources[0] : { $in: sources };
  }

  // Time range filter (required for efficient time series queries)
  if (query.startDate || query.endDate) {
    filter.timestamp = {};
    if (query.startDate)
      (filter.timestamp as Record<string, Date>).$gte = new Date(query.startDate);

    if (query.endDate) (filter.timestamp as Record<string, Date>).$lte = new Date(query.endDate);
  }

  // Quality filters
  if (query.is_valid !== undefined) filter['quality.is_valid'] = query.is_valid;

  if (query.is_anomaly !== undefined) filter['quality.is_anomaly'] = query.is_anomaly;

  if (query.min_confidence !== undefined)
    filter['quality.confidence_score'] = { $gte: query.min_confidence };

  if (query.min_anomaly_score !== undefined)
    filter['quality.anomaly_score'] = {
      ...((filter['quality.anomaly_score'] as Record<string, number>) || {}),
      $gte: query.min_anomaly_score,
    };

  // Value range filter
  if (query.min_value !== undefined || query.max_value !== undefined) {
    filter.value = {};
    if (query.min_value !== undefined)
      (filter.value as Record<string, number>).$gte = query.min_value;

    if (query.max_value !== undefined)
      (filter.value as Record<string, number>).$lte = query.max_value;
  }

  // Build sort
  const sortOrder = query.sortDirection === 'asc' ? 1 : -1;
  const sortField = query.sortBy || 'timestamp';
  const sort: Record<string, 1 | -1> = {};

  // Map sort field to actual path
  const sortFieldMap: Record<string, string> = {
    timestamp: 'timestamp',
    value: 'value',
    anomaly_score: 'quality.anomaly_score',
    confidence_score: 'quality.confidence_score',
  };

  sort[sortFieldMap[sortField] || sortField] = sortOrder;

  // Execute query
  const [readings, total] = await Promise.all([
    ReadingV2.find(filter, fieldProjection(query.fields))
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .setOptions(options)
      .lean(),
    ReadingV2.countDocuments(filter).setOptions(options),
  ]);

  // Calculate pagination info
  const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

  return { readings, paginationInfo };
}
