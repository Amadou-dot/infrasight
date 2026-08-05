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
  type AlertStatus,
} from '@/models/v2/AlertV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  updateAlertSchema,
  getAlertQuerySchema,
  alertIdParamSchema,
  type GetAlertQuery,
} from '@/lib/validations/v2/alert.validation';
import type { ResolvedAlert } from '@/types/v2/alert.types';
import { validateInput, validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { requireAdmin, requireOrgMembership, getAuditUser, isDemoCaller } from '@/lib/auth';
import {
  logger,
  recordRequest,
  createRequestTimer,
  recordAlert,
  captureException,
} from '@/lib/monitoring';
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
// ACTOR IDENTITY — two different strings, in scope together
// ============================================================================

/**
 * `audit.*_by` gets getAuditUser()'s value: the acting admin's EMAIL whenever
 * one is on file. The Pusher payload gets the opaque Clerk USER ID, because it
 * reaches every connected client — including anonymous demo visitors — on a
 * channel redact.ts does not cover. Both are `string`, both live in this one
 * handler, and until now only a comment stood between them and a swap that
 * would broadcast an administrator's email address.
 *
 * Branding makes that swap a COMPILE error instead. The two types are mutually
 * unassignable; each constructor below refuses the opposite brand; and the two
 * consumers (`applyTransition`, `buildResolvedEvent`) each demand their own, so
 * a bare `string` cannot reach either without going through a constructor.
 *
 * Deliberately local and narrow: `getAuditUser` (lib/auth) and `ResolvedAlert`
 * (types/v2) are outside this change's scope, so the brand is applied at this
 * boundary rather than pushed into their signatures.
 */
declare const AuditIdentityBrand: unique symbol;
declare const BroadcastActorBrand: unique symbol;

/** Persisted to `audit.*_by`. May be an email. NEVER broadcast. */
type AuditIdentity = string & { readonly [AuditIdentityBrand]: true };

/** Broadcast to every connected client. MUST be the opaque Clerk user id. */
type BroadcastActor = string & { readonly [BroadcastActorBrand]: true };

function auditIdentity(
  emailOrUserId: string & { readonly [BroadcastActorBrand]?: never }
): AuditIdentity {
  return emailOrUserId as AuditIdentity;
}

function broadcastActor(
  clerkUserId: string & { readonly [AuditIdentityBrand]?: never }
): BroadcastActor {
  return clerkUserId as BroadcastActor;
}

// ============================================================================
// TRANSITION + NOTE
// ============================================================================

/**
 * The status each transition requires, mirroring the guards inside
 * `AlertV2.acknowledge()` / `AlertV2.resolve()` (models/v2/AlertV2.ts). The
 * note write below reuses it as its own precondition so the two writes agree
 * about which alerts they may touch.
 */
const TRANSITION_PRECONDITION: Record<
  'acknowledged' | 'resolved',
  AlertStatus | { $in: AlertStatus[] }
> = {
  acknowledged: 'firing',
  resolved: { $in: ['firing', 'acknowledged'] },
};

/**
 * Attach — or clear — the operator's note.
 *
 * Runs BEFORE the transition, guarded on the same status precondition the
 * transition is about to apply. The note write used to run after
 * acknowledge()/resolve() had already committed, so a throw returned 500 and
 * told the operator the acknowledge had FAILED when it had not; the natural
 * retry then returned 422 "already acknowledged". Failing here commits
 * nothing, so the retry is clean and returns 200. The precondition is what
 * keeps the reordering honest: it matches exactly when the transition would
 * match, so a note cannot land on an alert whose transition is about to 422.
 *
 * Presence check, not truthiness: `if (note)` discarded an explicit
 * `note: ''`, so a caller could never clear a note. `$unset` removes the field
 * rather than storing a meaningless empty string.
 *
 * updateOne rather than doc.save(): AlertV2's pre('save') hook stamps
 * `audit.updated_at`, which the transition's own `$set` already sets — saving
 * bumped it a second time for what is one operator action.
 */
async function writeNote(
  id: string,
  status: 'acknowledged' | 'resolved',
  note: string
): Promise<void> {
  await AlertV2.updateOne(
    { _id: id, status: TRANSITION_PRECONDITION[status] },
    note === '' ? { $unset: { 'audit.note': '' } } : { $set: { 'audit.note': note } }
  );
}

/** Demands an AuditIdentity, so passing the broadcast actor here will not compile. */
function applyTransition(id: string, status: 'acknowledged' | 'resolved', by: AuditIdentity) {
  return status === 'acknowledged'
    ? AlertV2.acknowledge(id, by).catch(rethrowAsApiError)
    : AlertV2.resolve(id, by, 'manual').catch(rethrowAsApiError);
}

/** Demands a BroadcastActor, so passing the audit identity here will not compile. */
function buildResolvedEvent(
  alert: { _id: unknown; rule_id: unknown; device_id: string; severity: ResolvedAlert['severity'] },
  actor: BroadcastActor
): ResolvedAlert {
  return {
    _id: String(alert._id),
    rule_id: String(alert.rule_id),
    device_id: alert.device_id,
    severity: alert.severity,
    resolution: 'manual',
    resolved_at: new Date().toISOString(),
    actor,
  };
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
    const auditUser = auditIdentity(getAuditUser(userId, user));

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

    // Ordered deliberately: see writeNote's doc comment. A failure here
    // commits nothing, so it can never misreport a transition that succeeded.
    if (note !== undefined) await writeNote(id, status, note);

    const updated = await applyTransition(id, status, auditUser);

    if (!updated) throw new ApiError(ErrorCodes.ALERT_NOT_FOUND, 404, `Alert '${id}' not found`);

    if (status === 'resolved') recordAlert('resolved', { resolution: 'manual' });
    if (status === 'resolved')
      try {
        await publishAlertEvents([], [buildResolvedEvent(updated, broadcastActor(userId))]);
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
        // Escalated, not merely logged — logger.error only reaches a console
        // line (lib/monitoring/logger.ts), so without this a permanently
        // broken broadcast path is invisible in production while every PATCH
        // keeps returning 200. Same reasoning, and the same self-guarding, as
        // reportToSentry() in lib/alerting/index.ts: a misbehaving Sentry SDK
        // must not turn an already-handled fault into an unhandled one.
        try {
          captureException(error instanceof Error ? error : new Error(String(error)), undefined, {
            subsystem: 'alerting',
          });
        } catch {
          // Deliberately swallowed — see above.
        }
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
