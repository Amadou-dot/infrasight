/**
 * V2 Alert Rules API Routes
 *
 * GET  /api/v2/alert-rules - List rules (soft-deleted excluded)
 * POST /api/v2/alert-rules - Create a rule
 *
 * Path is `/api/v2/alert-rules` rather than `/api/v2/alerts/rules` so that no
 * static segment competes with the `[id]` dynamic segment under /alerts.
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import {
  createAlertRuleSchema,
  listAlertRulesQuerySchema,
  type ListAlertRulesQuery,
} from '@/lib/validations/v2/alert-rule.validation';
import { validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess, jsonPaginated } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { invalidateAlertRules } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';

const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  created_at: 'audit.created_at',
  updated_at: 'audit.updated_at',
  severity: 'severity',
};

// ============================================================================
// GET /api/v2/alert-rules
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const validationResult = validateQuery(request.nextUrl.searchParams, listAlertRulesQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as ListAlertRulesQuery;
    const pagination = getOffsetPaginationParams({ page: query.page, limit: query.limit });

    const filter: Record<string, unknown> = { 'audit.deleted_at': { $exists: false } };
    if (query.enabled !== undefined) filter.enabled = query.enabled;
    if (query.metric) filter.metric = query.metric;
    if (query.severity) filter.severity = query.severity;

    const sortField = SORT_FIELD_MAP[query.sortBy ?? 'created_at'] ?? 'audit.created_at';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortDirection === 'asc' ? 1 : -1 };

    const [rules, total] = await Promise.all([
      AlertRuleV2.find(filter)
        .select('-__v')
        .sort(sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      AlertRuleV2.countDocuments(filter),
    ]);

    recordRequest('GET', '/api/v2/alert-rules', 200, timer.elapsed());

    return jsonPaginated(
      rules,
      calculateOffsetPagination(total, pagination.page, pagination.limit)
    );
  })();
}

// ============================================================================
// POST /api/v2/alert-rules
// ============================================================================

async function handleCreateAlertRule(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const bodyValidation = await validateBody(request, createAlertRuleSchema);
    if (!bodyValidation.success) {
      logger.validationFailure('/api/v2/alert-rules', bodyValidation.errors);
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );
    }

    const now = new Date();
    const created = await AlertRuleV2.create({
      ...bodyValidation.data,
      audit: {
        created_at: now,
        created_by: auditUser,
        updated_at: now,
        updated_by: auditUser,
      },
    });

    // Without this the new rule takes up to 60s to affect evaluation.
    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('POST', '/api/v2/alert-rules', 201, duration);
    logger.info('Alert rule created', { ruleId: String(created._id), createdBy: auditUser, duration });

    return jsonSuccess(created.toObject({ versionKey: false }), 'Alert rule created successfully', 201);
  })();
}

export const POST = withRateLimit(
  withRequestValidation(handleCreateAlertRule, ValidationPresets.jsonApi)
);
