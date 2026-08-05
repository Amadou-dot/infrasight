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
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireAdmin, requireOrgMembership, getAuditUser, isDemoCaller } from '@/lib/auth';
import { redactAuditForDemo, jsonRedacted } from '@/lib/alerting';

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
 *     alert has `fired_at`.
 */
async function closeEpisodesOrphanedByConditionChange(
  ruleId: string,
  before: Pick<IAlertRuleV2, 'metric' | 'comparison' | 'threshold'>,
  after: Pick<IAlertRuleV2, 'metric' | 'comparison' | 'threshold'>,
  auditUser: string
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

  return { resolved: resolved.modifiedCount, deleted: deleted.deletedCount };
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
    const closed = conditionChanged
      ? await closeEpisodesOrphanedByConditionChange(id, before, updated, auditUser)
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
