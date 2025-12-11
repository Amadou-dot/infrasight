/**
 * V2 Readings API Routes
 *
 * GET /api/v2/readings - Query readings with filters, pagination, and sorting
 */

import { type NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import ReadingV2 from '@/models/v2/ReadingV2';
import { listReadingsQuerySchema, type ListReadingsQuery } from '@/lib/validations/v2/reading.validation';
import { validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonPaginated } from '@/lib/api/response';
import {
  getOffsetPaginationParams,
  calculateOffsetPagination,
} from '@/lib/api/pagination';

// ============================================================================
// GET /api/v2/readings - Query Readings
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, listReadingsQuerySchema);
    if (!validationResult.success) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );
    }

    const query = validationResult.data as ListReadingsQuery;

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
      if (query.startDate) {
        (filter.timestamp as Record<string, Date>).$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        (filter.timestamp as Record<string, Date>).$lte = new Date(query.endDate);
      }
    }

    // Quality filters
    if (query.is_valid !== undefined) {
      filter['quality.is_valid'] = query.is_valid;
    }

    if (query.is_anomaly !== undefined) {
      filter['quality.is_anomaly'] = query.is_anomaly;
    }

    if (query.min_confidence !== undefined) {
      filter['quality.confidence_score'] = { $gte: query.min_confidence };
    }

    if (query.min_anomaly_score !== undefined) {
      filter['quality.anomaly_score'] = { 
        ...(filter['quality.anomaly_score'] as Record<string, number> || {}),
        $gte: query.min_anomaly_score 
      };
    }

    // Value range filter
    if (query.min_value !== undefined || query.max_value !== undefined) {
      filter.value = {};
      if (query.min_value !== undefined) {
        (filter.value as Record<string, number>).$gte = query.min_value;
      }
      if (query.max_value !== undefined) {
        (filter.value as Record<string, number>).$lte = query.max_value;
      }
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

    // Build field projection
    let projection: Record<string, 1> | undefined;
    if (query.fields) {
      projection = {};
      for (const field of query.fields) {
        projection[field] = 1;
      }
    }

    // Execute query
    const [readings, total] = await Promise.all([
      ReadingV2.find(filter, projection)
        .sort(sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      ReadingV2.countDocuments(filter),
    ]);

    // Calculate pagination info
    const paginationInfo = calculateOffsetPagination(
      total,
      pagination.page,
      pagination.limit
    );

    return jsonPaginated(readings, paginationInfo);
  })();
}
