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
import { requireAdmin, requireOrgMembership, getAuditUser, isDemoCaller } from '@/lib/auth';
import { logger, recordRequest, createRequestTimer, recordAlert } from '@/lib/monitoring';
import { publishAlertEvents, redactAuditForDemo } from '@/lib/alerting';

// ============================================================================
// GET /api/v2/alerts/[id]
// ============================================================================

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const authContext = await requireOrgMembership();
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

    const found = await AlertV2.findById(id).select('-__v').lean();
    // `pending` is internal (see the list endpoint's header comment) and must
    // never be visible to a client — treat it exactly like "does not exist"
    // rather than leaking an alert whose for_duration_seconds hasn't elapsed.
    if (!found || found.status === 'pending')
      throw new ApiError(ErrorCodes.ALERT_NOT_FOUND, 404, `Alert '${id}' not found`);

    // Demo mode grants an anonymous visitor the same read access as a real org
    // member (see requireOrgMembership()) — never let that also hand them a
    // real administrator's email off audit.acknowledged_by/resolved_by/etc.
    const alert = redactAuditForDemo(found, isDemoCaller(authContext));

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
    const authContext = await requireAdmin();
    const { userId, user } = authContext;
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
    if (status === 'resolved')
      try {
        await publishAlertEvents(
          [],
          [
            {
              _id: String(updated._id),
              rule_id: String(updated.rule_id),
              device_id: updated.device_id,
              severity: updated.severity,
              resolution: 'manual',
              resolved_at: new Date().toISOString(),
              // The Clerk USER ID, never getAuditUser's email — this payload
              // reaches every connected client, including anonymous demo visitors.
              actor: userId,
            },
          ]
        );
      } catch (error) {
        // Mirrors safeEvaluateReadings's own nested try/catch around
        // publishAlertEvents (lib/alerting/index.ts): notify.ts already
        // swallows Pusher's own trigger failure internally, so the only
        // residual here is envelope construction — but this route already
        // committed the resolve to the database, so a broadcast fault must
        // never turn that into a 500.
        logger.error('Alert broadcast failed after a committed write', {
          alertId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/alerts/[id]', 200, duration);
    logger.info('Alert transitioned', { alertId: id, status, by: auditUser, duration });

    // Demo mode grants an anonymous visitor the same read access as a real org
    // member for GET, but PATCH is requireAdmin()-only, so isDemoCaller here
    // is always false in practice — applied anyway for defense in depth and
    // to keep every response from these endpoints going through one contract.
    return jsonSuccess(
      redactAuditForDemo(updated.toObject({ versionKey: false }), isDemoCaller(authContext)),
      status === 'acknowledged' ? 'Alert acknowledged' : 'Alert resolved'
    );
  })();
}

export const PATCH = withRateLimit(
  withRequestValidation(handleUpdateAlert, ValidationPresets.jsonApi)
);
