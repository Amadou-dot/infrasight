/**
 * V2 Single Alert Rule API Routes
 *
 * GET    /api/v2/alert-rules/[id] - Get a rule
 * PATCH  /api/v2/alert-rules/[id] - Update a rule
 * DELETE /api/v2/alert-rules/[id] - Soft delete a rule
 *
 * DELETE is SOFT. Alerts reference their rule; hard-deleting would orphan the
 * history that justifies every alert it ever raised. `enabled: false` is the
 * reversible off switch; deletion is the permanent one.
 */

import type { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import dbConnect from '@/lib/db';
import AlertRuleV2, { type IAlertRuleV2 } from '@/models/v2/AlertRuleV2';
import AlertV2 from '@/models/v2/AlertV2';
import {
  updateAlertRuleSchema,
  alertRuleIdParamSchema,
} from '@/lib/validations/v2/alert-rule.validation';
import { validateInput, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { invalidateAlertRules } from '@/lib/cache';
import {
  logger,
  recordRequest,
  createRequestTimer,
  recordAlert,
  captureException,
} from '@/lib/monitoring';
import { requireAdmin, requireOrgMembership, getAuditUser, isDemoCaller } from '@/lib/auth';
import { redactAuditForDemo, jsonRedacted, publishAlertEvents } from '@/lib/alerting';
import type { ResolvedAlert } from '@/types/v2/alert.types';

function assertValidId(id: string): void {
  const paramValidation = validateInput({ id }, alertRuleIdParamSchema);
  if (!paramValidation.success)
    throw new ApiError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      paramValidation.errors.map(e => e.message).join(', '),
      { errors: paramValidation.errors }
    );
}

// ============================================================================
// GET
// ============================================================================

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const authContext = await requireOrgMembership();
    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const rule = await AlertRuleV2.findOne({
      _id: id,
      'audit.deleted_at': { $exists: false },
    })
      .select('-__v')
      .lean();

    if (!rule)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    recordRequest('GET', '/api/v2/alert-rules/[id]', 200, timer.elapsed());

    // Demo mode grants an anonymous visitor the same read access as a real org
    // member (see requireOrgMembership()) — never let that also hand them a
    // real administrator's email off audit.created_by/updated_by/deleted_by.
    // jsonRedacted (not jsonSuccess) will not compile without the redaction
    // call — see the Redacted<> note in lib/alerting/redact.ts.
    return jsonRedacted(redactAuditForDemo(rule, isDemoCaller(authContext)));
  })();
}

// ============================================================================
// CONDITION CHANGES AND OPEN EPISODES
// ============================================================================

/**
 * The three fields an alert SNAPSHOTS at fire time (see IAlertV2). `selector`
 * is deliberately absent: it changes which devices are in scope, not what the
 * snapshot on an already-open episode means.
 */
const SNAPSHOT_FIELDS = ['metric', 'comparison', 'threshold'] as const;

const COMPARISON_WORDS = { gt: 'above', gte: 'at or above', lt: 'below', lte: 'at or below' };

function describeCondition(rule: Pick<IAlertRuleV2, 'metric' | 'comparison' | 'threshold'>): string {
  return `${rule.metric} ${COMPARISON_WORDS[rule.comparison]} ${rule.threshold}`;
}

/**
 * Close every episode still open against a rule whose condition just changed.
 *
 * An open episode carries the OLD metric/comparison/threshold, but `last_value`
 * and `resolved_value` are not snapshotted — they are whatever the evaluator
 * measured last. Leave the episode open and the next evaluation auto-resolves
 * it with a value measured against the NEW metric: switch a temperature rule to
 * `battery_level` and history permanently records "value above 30" clearing at
 * 87. Re-snapshotting instead would be worse — `trigger_value`, `fired_at` and
 * `breached_since` would then describe a breach of a condition that never fired.
 *
 * So the episode is CLOSED at the boundary, while its snapshot is still true:
 *   - firing / acknowledged -> resolved, `manual`, attributed to the admin who
 *     edited the rule, with a note naming both conditions. `manual` is honest:
 *     an administrator's action closed it. `auto` would claim the metric came
 *     back within threshold, which is exactly the false history being fixed.
 *     No `resolved_value` is written — nothing measured this episode closed.
 *   - pending -> DELETED, matching how the evaluator and sweep retire pending
 *     episodes (`deleteOne`/`deleteMany` guarded on `status: 'pending'`).
 *     Resolving one would break the documented invariant that every visible
 *     alert has `fired_at`. Nothing is broadcast or counted for these: a
 *     pending episode was never visible to a client and never counted as
 *     fired, so announcing its resolution would invent an alert.
 *
 * Closing them in the database is only half the job. Nothing patches alert rows
 * into the React Query cache (see useAlertsList's header comment) and
 * `refetchOnWindowFocus` is off, so a close that is neither broadcast nor
 * counted leaves the alerts list and the nav badge showing every one of these
 * episodes as still firing until something else happens to invalidate them —
 * indefinitely on a wall display — and leaves `alerts_resolved` short by the
 * same number. So each closed episode is also published on the alert channel
 * and recorded, exactly as a manual resolve through `PATCH /api/v2/alerts/[id]`
 * is.
 *
 * IDENTIFYING what was closed: `updateMany` reports a count, not documents, so
 * the episodes are read back afterwards, keyed on the `now` this function
 * minted. Reading the ids BEFORE the update would race the other way — the
 * evaluator can promote a pending episode to firing in between, and that
 * episode would then be closed in the database but absent from the broadcast
 * and the count, which is the exact defect being fixed. The read-back cannot
 * miss one: `resolved` is terminal (`AlertV2.resolve` matches only
 * firing/acknowledged, and the evaluator and sweep both act on `is_open: true`
 * documents), so nothing can move a document out of the matched set after the
 * update commits. The accepted residual is the reverse and it is benign: a
 * concurrent PATCH on the SAME rule landing in the same millisecond would have
 * its episodes read back here too, over-publishing an already-resolved episode
 * and over-counting by that many.
 */
async function closeEpisodesOrphanedByConditionChange(
  ruleId: string,
  before: Pick<IAlertRuleV2, 'metric' | 'comparison' | 'threshold'>,
  after: Pick<IAlertRuleV2, 'metric' | 'comparison' | 'threshold'>,
  auditUser: string,
  actor: string
): Promise<{ resolved: number; deleted: number }> {
  const rule_id = new Types.ObjectId(ruleId);
  const now = new Date();

  const [resolved, deleted] = await Promise.all([
    AlertV2.updateMany(
      { rule_id, status: { $in: ['firing', 'acknowledged'] } },
      {
        $set: {
          status: 'resolved',
          is_open: false,
          'audit.updated_at': now,
          'audit.updated_by': auditUser,
          'audit.resolved_at': now,
          'audit.resolved_by': auditUser,
          'audit.resolution': 'manual',
          'audit.note':
            `Closed automatically: the rule condition changed from ` +
            `"${describeCondition(before)}" to "${describeCondition(after)}", ` +
            `so this episode's condition no longer exists.`,
        },
      }
    ),
    AlertV2.deleteMany({ rule_id, status: 'pending' }),
  ]);

  if (resolved.modifiedCount > 0)
    await announceClosedEpisodes(rule_id, now, actor, resolved.modifiedCount);

  return { resolved: resolved.modifiedCount, deleted: deleted.deletedCount };
}

/**
 * Read the episodes just closed above back out, count them and broadcast them.
 *
 * `actor` is the acting admin's opaque Clerk USER ID, never `auditUser`. Same
 * reasoning as the ACTOR IDENTITY note in `app/api/v2/alerts/[id]/route.ts`:
 * `audit.*_by` takes getAuditUser()'s value, which is an EMAIL whenever one is
 * on file, while this payload reaches every client subscribed to the alert
 * channel. The two must not be swapped.
 *
 * Neither the read-back, the metric nor the broadcast may fail the PATCH: the
 * rule update and the episode closes are already committed, so a fault here has
 * nothing left to roll back and a 500 would tell the admin their edit failed
 * when it did not. It is escalated rather than merely logged, for the reason
 * spelled out at the matching call site in `app/api/v2/alerts/[id]/route.ts`:
 * logger.error only reaches a console line, so without this a permanently
 * broken broadcast path is invisible while every PATCH keeps returning 200.
 */
async function announceClosedEpisodes(
  rule_id: Types.ObjectId,
  resolvedAt: Date,
  actor: string,
  expected: number
): Promise<void> {
  try {
    const closed = await AlertV2.find({
      rule_id,
      status: 'resolved',
      'audit.resolution': 'manual',
      'audit.resolved_at': resolvedAt,
    })
      .select('_id rule_id device_id severity')
      .lean();

    // Only ever a symptom of the millisecond collision described above, but
    // worth seeing if it is ever anything else.
    if (closed.length !== expected)
      logger.warn('Closed-episode read-back disagrees with the update count', {
        ruleId: String(rule_id),
        expected,
        readBack: closed.length,
      });

    const events: ResolvedAlert[] = closed.map(alert => ({
      _id: String(alert._id),
      rule_id: String(alert.rule_id),
      device_id: alert.device_id,
      severity: alert.severity,
      resolution: 'manual',
      resolved_at: resolvedAt.toISOString(),
      actor,
    }));

    // One per closed episode, not one per PATCH: `alerts_resolved` counts
    // episodes, and the sweep and the evaluator both record it that way.
    events.forEach(() => recordAlert('resolved', { resolution: 'manual' }));

    await publishAlertEvents([], events);
  } catch (error) {
    logger.error('Closed-episode broadcast failed after a committed write', {
      ruleId: String(rule_id),
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      captureException(error instanceof Error ? error : new Error(String(error)), undefined, {
        subsystem: 'alerting',
      });
    } catch {
      // Deliberately swallowed — a misbehaving Sentry SDK must not turn an
      // already-handled fault into an unhandled one.
    }
  }
}

// ============================================================================
// PATCH
// ============================================================================

async function handleUpdateAlertRule(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const authContext = await requireAdmin();
    const auditUser = getAuditUser(authContext.userId, authContext.user);

    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const bodyValidation = await validateBody(request, updateAlertRuleSchema);
    if (!bodyValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );

    // Read before writing: the snapshot fields' PREVIOUS values are what
    // decide whether open episodes were orphaned, and they are also what the
    // audit note has to name. `findOneAndUpdate` alone cannot give us both the
    // old and the new document.
    const before = await AlertRuleV2.findOne({
      _id: id,
      'audit.deleted_at': { $exists: false },
    })
      .select('metric comparison threshold')
      .lean();

    if (!before)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    const updated = await AlertRuleV2.findOneAndUpdate(
      { _id: id, 'audit.deleted_at': { $exists: false } },
      {
        $set: {
          ...bodyValidation.data,
          'audit.updated_at': new Date(),
          'audit.updated_by': auditUser,
        },
      },
      { new: true, runValidators: true }
    )
      .select('-__v')
      .lean();

    if (!updated)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    // A no-op PATCH (same values resent, or a rename) must not close anything.
    const conditionChanged = SNAPSHOT_FIELDS.some(field => before[field] !== updated[field]);

    // BEFORE invalidateAlertRules(), not after: while the pre-mutation rule set
    // is still cached, every episode the evaluator can create carries the OLD
    // snapshot, so closing them all is correct. Invalidating first would open a
    // window in which a genuinely new-condition episode gets closed as orphaned.
    // `authContext.userId`, not `auditUser`: the second argument is broadcast
    // to every subscriber, the first is persisted. See announceClosedEpisodes.
    const closed = conditionChanged
      ? await closeEpisodesOrphanedByConditionChange(
          id,
          before,
          updated,
          auditUser,
          authContext.userId
        )
      : null;

    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/alert-rules/[id]', 200, duration);
    logger.info('Alert rule updated', {
      ruleId: id,
      updates: Object.keys(bodyValidation.data),
      updatedBy: auditUser,
      duration,
      ...(closed ? { episodesResolved: closed.resolved, episodesDeleted: closed.deleted } : {}),
    });

    // Wrapped for the same reason as the POST on the sibling route: inert
    // behind requireAdmin() today, but its `alerts/[id]` counterpart already
    // redacts and a future RBAC change must not silently open this one.
    // jsonRedacted refuses an unredacted record, so the asymmetry this PR
    // shipped with (POST/PATCH redacting, their siblings not) cannot recur.
    return jsonRedacted(
      redactAuditForDemo(updated, isDemoCaller(authContext)),
      'Alert rule updated successfully'
    );
  })();
}

export const PATCH = withRateLimit(
  withRequestValidation(handleUpdateAlertRule, ValidationPresets.jsonApi)
);

// ============================================================================
// DELETE
// ============================================================================

async function handleDeleteAlertRule(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const deleted = await AlertRuleV2.softDelete(id, auditUser);

    if (!deleted)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('DELETE', '/api/v2/alert-rules/[id]', 200, duration);
    logger.info('Alert rule deleted', { ruleId: id, deletedBy: auditUser, duration });

    return jsonSuccess(
      { _id: id, deleted: true, deleted_at: deleted.audit?.deleted_at },
      'Alert rule deleted successfully'
    );
  })();
}

export const DELETE = withRateLimit(handleDeleteAlertRule);
