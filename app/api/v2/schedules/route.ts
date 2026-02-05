/**
 * V2 Schedules API Routes
 *
 * GET /api/v2/schedules - List schedules with pagination, filtering, and sorting
 * POST /api/v2/schedules - Create schedule(s) with bulk support via device_ids array
 *
 * Features:
 * - Rate limiting for POST
 * - Request validation with Zod
 * - Bulk creation support (1-100 devices per request)
 * - RBAC: Admins can create, Members can read
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import ScheduleV2 from '@/models/v2/ScheduleV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  createScheduleSchema,
  listSchedulesQuerySchema,
  type ListSchedulesQuery,
} from '@/lib/validations/v2/schedule.validation';
import { validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess, jsonPaginated } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';

// Phase 5 imports
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';

// Auth
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';

// ============================================================================
// GET /api/v2/schedules - List Schedules
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require org membership for read access
    await requireOrgMembership();

    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, listSchedulesQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as ListSchedulesQuery;

    // Extract pagination
    const pagination = getOffsetPaginationParams({
      page: query.page,
      limit: query.limit,
    });

    // Build filter query
    const filter: Record<string, unknown> = {};

    // Device ID filter
    if (query.device_id) {
      filter.device_id = query.device_id;
    }

    // Status filter - default to only 'scheduled' unless include_all is true
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    } else if (!query.include_all) {
      filter.status = 'scheduled';
    }

    // Service type filter
    if (query.service_type) {
      const types = Array.isArray(query.service_type) ? query.service_type : [query.service_type];
      filter.service_type = types.length === 1 ? types[0] : { $in: types };
    }

    // Date range filter for scheduled_date
    if (query.startDate || query.endDate) {
      filter.scheduled_date = {};
      if (query.startDate) {
        (filter.scheduled_date as Record<string, Date>).$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        (filter.scheduled_date as Record<string, Date>).$lte = new Date(query.endDate);
      }
    }

    // Build sort
    const sortOrder = query.sortDirection === 'asc' ? 1 : -1;
    const sortField = query.sortBy || 'scheduled_date';
    const sort: Record<string, 1 | -1> = {};

    // Map sort field to actual path
    const sortFieldMap: Record<string, string> = {
      scheduled_date: 'scheduled_date',
      created_at: 'audit.created_at',
      updated_at: 'audit.updated_at',
      status: 'status',
      service_type: 'service_type',
    };

    sort[sortFieldMap[sortField] || sortField] = sortOrder;

    // Execute query
    const [schedules, total] = await Promise.all([
      ScheduleV2.find(filter)
        .sort(sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      ScheduleV2.countDocuments(filter),
    ]);

    // Calculate pagination info
    const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/schedules', 200, duration);

    logger.debug('Schedules list request', {
      duration,
      total,
      filters: {
        device_id: query.device_id,
        status: query.status,
        service_type: query.service_type,
      },
    });

    return jsonPaginated(schedules, paginationInfo);
  })();
}

// ============================================================================
// POST /api/v2/schedules - Create Schedule(s)
// ============================================================================

async function handleCreateSchedules(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require admin for create operations
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    // Parse and validate request body
    const validationResult = await validateBody(request, createScheduleSchema);

    if (!validationResult.success) {
      logger.validationFailure('/api/v2/schedules', validationResult.errors);
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );
    }

    const scheduleData = validationResult.data;

    // Validate all device IDs exist and are not deleted
    const deviceIds = scheduleData.device_ids;
    const existingDevices = await DeviceV2.find({
      _id: { $in: deviceIds },
      'audit.deleted_at': { $exists: false },
    }).select('_id').lean();

    const existingDeviceIds = new Set(existingDevices.map(d => d._id));
    const missingDeviceIds = deviceIds.filter(id => !existingDeviceIds.has(id));

    if (missingDeviceIds.length > 0) {
      throw new ApiError(
        ErrorCodes.DEVICE_NOT_FOUND,
        404,
        `Device(s) not found or deleted: ${missingDeviceIds.join(', ')}`,
        { missing_device_ids: missingDeviceIds }
      );
    }

    // Create one schedule document per device
    const now = new Date();
    const scheduleDocs = deviceIds.map(deviceId => ({
      device_id: deviceId,
      service_type: scheduleData.service_type,
      scheduled_date: scheduleData.scheduled_date,
      status: 'scheduled' as const,
      notes: scheduleData.notes,
      audit: {
        created_at: now,
        created_by: auditUser,
        updated_at: now,
        updated_by: auditUser,
      },
    }));

    // Bulk insert
    const createdSchedules = await ScheduleV2.insertMany(scheduleDocs);

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('POST', '/api/v2/schedules', 201, duration);

    logger.info('Schedules created', {
      count: createdSchedules.length,
      service_type: scheduleData.service_type,
      scheduled_date: scheduleData.scheduled_date,
      createdBy: auditUser,
      duration,
    });

    return jsonSuccess(
      {
        created: createdSchedules,
        count: createdSchedules.length,
      },
      `${createdSchedules.length} schedule(s) created successfully`,
      201
    );
  })();
}

// Export with middleware: Rate Limiting -> Request Validation -> Handler
export const POST = withRateLimit(
  withRequestValidation(handleCreateSchedules, ValidationPresets.jsonApi)
);
