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
import dbConnect from '@/lib/db';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
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
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';

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
    await requireOrgMembership();
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

    return jsonSuccess(rule);
  })();
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
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

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

    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/alert-rules/[id]', 200, duration);
    logger.info('Alert rule updated', {
      ruleId: id,
      updates: Object.keys(bodyValidation.data),
      updatedBy: auditUser,
      duration,
    });

    return jsonSuccess(updated, 'Alert rule updated successfully');
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
