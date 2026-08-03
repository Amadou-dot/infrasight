/**
 * V2 Single Alert API Routes
 *
 * GET   /api/v2/alerts/[id] - Get a single alert
 * PATCH /api/v2/alerts/[id] - Acknowledge or resolve
 *
 * There is no DELETE. An alert is resolved, never cancelled and never removed —
 * the history is the point.
 *
 * Status Transition Rules:
 *   firing       -> acknowledged | resolved
 *   acknowledged -> resolved
 *   resolved     -> (terminal)
 *   pending      -> (internal; not a legal PATCH target)
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertV2, {
  AlertTransitionError,
  type AlertTransitionCode,
} from '@/models/v2/AlertV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  updateAlertSchema,
  getAlertQuerySchema,
  alertIdParamSchema,
  type GetAlertQuery,
} from '@/lib/validations/v2/alert.validation';
import { validateInput, validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';
import { logger, recordRequest, createRequestTimer, recordAlert } from '@/lib/monitoring';

// ============================================================================
// GET /api/v2/alerts/[id]
// ============================================================================

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const { id } = await params;

    const paramValidation = validateInput({ id }, alertIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    const queryValidation = validateQuery(request.nextUrl.searchParams, getAlertQuerySchema);
    if (!queryValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        queryValidation.errors.map(e => e.message).join(', '),
        { errors: queryValidation.errors }
      );

    const query = queryValidation.data as GetAlertQuery;

    const alert = await AlertV2.findById(id).lean();
    if (!alert) throw new ApiError(ErrorCodes.ALERT_NOT_FOUND, 404, `Alert '${id}' not found`);

    const response: Record<string, unknown> = { ...alert };

    if (query.include_device) {
      const device = await DeviceV2.findById(alert.device_id)
        .select('_id serial_number type location')
        .lean();

      response.device = device
        ? {
            _id: device._id,
            serial_number: device.serial_number,
            type: device.type,
            location: {
              building_id: device.location?.building_id,
              floor: device.location?.floor,
              room_name: device.location?.room_name,
            },
          }
        : null;

      if (!device)
        logger.warn('Device not found for alert', { alertId: id, deviceId: alert.device_id });
    }

    recordRequest('GET', '/api/v2/alerts/[id]', 200, timer.elapsed());

    return jsonSuccess(response);
  })();
}

// ============================================================================
// ERROR MAPPING HELPER
// ============================================================================

/**
 * Three codes, not four. ScheduleV2 needs four because its two terminal targets
 * are symmetric — either can block the other. Alerts are not symmetric:
 * `acknowledged` sits between `firing` and `resolved`.
 */
const TRANSITION_CODE_MAP: Record<AlertTransitionCode, { code: string; message: string }> = {
  ALREADY_ACKNOWLEDGED: {
    code: ErrorCodes.ALERT_ALREADY_ACKNOWLEDGED,
    message: 'Alert is already acknowledged',
  },
  ALREADY_RESOLVED: {
    code: ErrorCodes.ALERT_ALREADY_RESOLVED,
    message: 'Alert is already resolved',
  },
  NOT_YET_FIRING: {
    code: ErrorCodes.INVALID_ALERT_STATUS_TRANSITION,
    message: 'Alert has not fired yet and cannot be acknowledged or resolved',
  },
};

function rethrowAsApiError(error: unknown): never {
  if (error instanceof AlertTransitionError) {
    const mapped = TRANSITION_CODE_MAP[error.code];
    throw new ApiError(mapped.code, 422, mapped.message);
  }
  throw error;
}

// ============================================================================
// PATCH /api/v2/alerts/[id]
// ============================================================================

async function handleUpdateAlert(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;

    const paramValidation = validateInput({ id }, alertIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    const bodyValidation = await validateBody(request, updateAlertSchema);
    if (!bodyValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );

    const { status, note } = bodyValidation.data;

    const updated =
      status === 'acknowledged'
        ? await AlertV2.acknowledge(id, auditUser).catch(rethrowAsApiError)
        : await AlertV2.resolve(id, auditUser, 'manual').catch(rethrowAsApiError);

    if (!updated) throw new ApiError(ErrorCodes.ALERT_NOT_FOUND, 404, `Alert '${id}' not found`);

    if (note) {
      updated.audit.note = note;
      await updated.save();
    }

    if (status === 'resolved') recordAlert('resolved', { resolution: 'manual' });

    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/alerts/[id]', 200, duration);
    logger.info('Alert transitioned', { alertId: id, status, by: auditUser, duration });

    return jsonSuccess(
      updated.toObject(),
      status === 'acknowledged' ? 'Alert acknowledged' : 'Alert resolved'
    );
  })();
}

export const PATCH = withRateLimit(
  withRequestValidation(handleUpdateAlert, ValidationPresets.jsonApi)
);
