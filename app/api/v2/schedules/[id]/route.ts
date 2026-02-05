/**
 * V2 Single Schedule API Routes
 *
 * GET /api/v2/schedules/[id] - Get a single schedule by ID
 * PATCH /api/v2/schedules/[id] - Update a schedule (reschedule, update notes, change status)
 * DELETE /api/v2/schedules/[id] - Cancel a schedule (sets status to 'cancelled')
 *
 * Status Transition Rules:
 * - scheduled -> completed | cancelled
 * - completed -> (cannot change)
 * - cancelled -> (cannot change)
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import ScheduleV2, { ScheduleTransitionError, type ScheduleTransitionCode } from '@/models/v2/ScheduleV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  updateScheduleSchema,
  getScheduleQuerySchema,
  scheduleIdParamSchema,
  type GetScheduleQuery,
} from '@/lib/validations/v2/schedule.validation';
import { validateInput, validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';

// ============================================================================
// GET /api/v2/schedules/[id] - Get Single Schedule
// ============================================================================

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require org membership for read access
    await requireOrgMembership();

    await dbConnect();

    const { id } = await params;

    // Validate path param
    const paramValidation = validateInput({ id }, scheduleIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    // Validate query params
    const searchParams = request.nextUrl.searchParams;
    const queryValidation = validateQuery(searchParams, getScheduleQuerySchema);

    if (!queryValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        queryValidation.errors.map(e => e.message).join(', '),
        { errors: queryValidation.errors }
      );

    const query = queryValidation.data as GetScheduleQuery;

    // Find schedule
    const schedule = await ScheduleV2.findById(id).lean();

    if (!schedule) {
      throw new ApiError(
        ErrorCodes.SCHEDULE_NOT_FOUND,
        404,
        `Schedule '${id}' not found`
      );
    }

    // Build response
    const response: Record<string, unknown> = { ...schedule };

    // Include device details if requested
    if (query.include_device) {
      const device = await DeviceV2.findById(schedule.device_id)
        .select('_id serial_number type location')
        .lean();

      if (device) {
        response.device = {
          _id: device._id,
          serial_number: device.serial_number,
          type: device.type,
          location: {
            building_id: device.location?.building_id,
            floor: device.location?.floor,
            room_name: device.location?.room_name,
          },
        };
      } else {
        logger.warn('Device not found for schedule', {
          scheduleId: id,
          deviceId: schedule.device_id,
        });
        response.device = null;
      }
    }

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/schedules/[id]', 200, duration);

    return jsonSuccess(response);
  })();
}

// ============================================================================
// ERROR MAPPING HELPER
// ============================================================================

const TRANSITION_CODE_MAP: Record<ScheduleTransitionCode, { code: string; message: string }> = {
  ALREADY_COMPLETED: {
    code: ErrorCodes.SCHEDULE_ALREADY_COMPLETED,
    message: 'Schedule is already completed',
  },
  ALREADY_CANCELLED: {
    code: ErrorCodes.SCHEDULE_ALREADY_CANCELLED,
    message: 'Schedule is already cancelled',
  },
  CANNOT_COMPLETE_CANCELLED: {
    code: ErrorCodes.SCHEDULE_ALREADY_CANCELLED,
    message: 'Cannot complete a cancelled schedule',
  },
  CANNOT_CANCEL_COMPLETED: {
    code: ErrorCodes.SCHEDULE_ALREADY_COMPLETED,
    message: 'Cannot cancel a completed schedule',
  },
};

function rethrowAsApiError(error: unknown): never {
  if (error instanceof ScheduleTransitionError) {
    const mapped = TRANSITION_CODE_MAP[error.code];
    throw new ApiError(mapped.code, 422, mapped.message);
  }
  throw error;
}

// ============================================================================
// PATCH /api/v2/schedules/[id] - Update Schedule
// ============================================================================

async function handleUpdateSchedule(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require admin for update operations
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;

    // Validate path param
    const paramValidation = validateInput({ id }, scheduleIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    // Parse and validate body
    const bodyValidation = await validateBody(request, updateScheduleSchema);

    if (!bodyValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );

    const updateData = bodyValidation.data;

    // Handle status transitions via static methods for consistency
    if (updateData.status === 'completed') {
      const completedSchedule = await ScheduleV2.complete(id, auditUser).catch(rethrowAsApiError);
      if (!completedSchedule) {
        throw new ApiError(ErrorCodes.SCHEDULE_NOT_FOUND, 404, `Schedule '${id}' not found`);
      }

      const duration = timer.elapsed();
      recordRequest('PATCH', '/api/v2/schedules/[id]', 200, duration);
      logger.info('Schedule completed', { scheduleId: id, completedBy: auditUser, duration });

      return jsonSuccess(completedSchedule.toObject(), 'Schedule marked as completed');
    }

    if (updateData.status === 'cancelled') {
      const cancelledSchedule = await ScheduleV2.cancel(id, auditUser).catch(rethrowAsApiError);
      if (!cancelledSchedule) {
        throw new ApiError(ErrorCodes.SCHEDULE_NOT_FOUND, 404, `Schedule '${id}' not found`);
      }

      const duration = timer.elapsed();
      recordRequest('PATCH', '/api/v2/schedules/[id]', 200, duration);
      logger.info('Schedule cancelled via PATCH', { scheduleId: id, cancelledBy: auditUser, duration });

      return jsonSuccess(cancelledSchedule.toObject(), 'Schedule cancelled');
    }

    // For non-status updates (scheduled_date, notes), check schedule exists and is modifiable
    const existingSchedule = await ScheduleV2.findById(id);
    if (!existingSchedule) {
      throw new ApiError(
        ErrorCodes.SCHEDULE_NOT_FOUND,
        404,
        `Schedule '${id}' not found`
      );
    }

    if (existingSchedule.status === 'completed') {
      throw new ApiError(
        ErrorCodes.SCHEDULE_ALREADY_COMPLETED,
        422,
        'Cannot modify a completed schedule'
      );
    }

    if (existingSchedule.status === 'cancelled') {
      throw new ApiError(
        ErrorCodes.SCHEDULE_ALREADY_CANCELLED,
        422,
        'Cannot modify a cancelled schedule'
      );
    }

    // Build update object for non-status fields
    const updateObj: Record<string, unknown> = {
      'audit.updated_at': new Date(),
      'audit.updated_by': auditUser,
    };

    if (updateData.scheduled_date) {
      updateObj.scheduled_date = updateData.scheduled_date;
    }

    if (updateData.notes !== undefined) {
      updateObj.notes = updateData.notes;
    }

    // Perform update
    const updatedSchedule = await ScheduleV2.findByIdAndUpdate(
      id,
      { $set: updateObj },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedSchedule) {
      throw new ApiError(
        ErrorCodes.SCHEDULE_NOT_FOUND,
        404,
        `Schedule '${id}' not found`
      );
    }

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/schedules/[id]', 200, duration);

    logger.info('Schedule updated', {
      scheduleId: id,
      updates: Object.keys(updateData),
      updatedBy: auditUser,
      duration,
    });

    return jsonSuccess(updatedSchedule, 'Schedule updated successfully');
  })();
}

// Export with middleware: Rate Limiting -> Request Validation -> Handler
export const PATCH = withRateLimit(
  withRequestValidation(handleUpdateSchedule, ValidationPresets.jsonApi)
);

// ============================================================================
// DELETE /api/v2/schedules/[id] - Cancel Schedule
// ============================================================================

async function handleCancelSchedule(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require admin for cancel operations
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;

    // Validate path param
    const paramValidation = validateInput({ id }, scheduleIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    const cancelledSchedule = await ScheduleV2.cancel(id, auditUser).catch(rethrowAsApiError);

    if (!cancelledSchedule) {
      throw new ApiError(ErrorCodes.SCHEDULE_NOT_FOUND, 404, `Schedule '${id}' not found`);
    }

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('DELETE', '/api/v2/schedules/[id]', 200, duration);

    logger.info('Schedule cancelled', {
      scheduleId: id,
      cancelledBy: auditUser,
      duration,
    });

    return jsonSuccess(
      {
        _id: id,
        cancelled: true,
        cancelled_at: cancelledSchedule.audit?.cancelled_at,
      },
      'Schedule cancelled successfully'
    );
  })();
}

export const DELETE = withRateLimit(handleCancelSchedule);
