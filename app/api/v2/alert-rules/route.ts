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
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { invalidateAlertRules } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireAdmin, requireOrgMembership, getAuditUser, isDemoCaller } from '@/lib/auth';
import { redactAuditForDemo, jsonRedacted, jsonRedactedPaginated } from '@/lib/alerting';

const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  created_at: 'audit.created_at',
  updated_at: 'audit.updated_at',
  severity: 'severity',
};

/**
 * Urgency rank. Mongo sorts the raw string lexically, which puts `critical`
 * last. Same `$switch` shape as /api/v2/alerts — deliberately one idiom across
 * both endpoints rather than a second way of saying the same thing.
 */
const SEVERITY_RANK = {
  $switch: {
    branches: [
      { case: { $eq: ['$severity', 'critical'] }, then: 3 },
      { case: { $eq: ['$severity', 'warning'] }, then: 2 },
    ],
    default: 1, // info
  },
};

// ============================================================================
// GET /api/v2/alert-rules
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const authContext = await requireOrgMembership();
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
    const direction: 1 | -1 = query.sortDirection === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortField]: direction };

    // `filter` carries no ObjectId-typed path (see the alerts route for why
    // that matters), so $match can consume it directly.
    const rulesQuery =
      query.sortBy === 'severity'
        ? AlertRuleV2.aggregate([
            { $match: filter },
            { $addFields: { _severity_rank: SEVERITY_RANK } },
            // audit.created_at breaks ties so paging is stable within a band.
            { $sort: { _severity_rank: direction, 'audit.created_at': -1 } },
            { $skip: pagination.skip },
            { $limit: pagination.limit },
            { $project: { __v: 0, _severity_rank: 0 } },
          ])
        : AlertRuleV2.find(filter)
            .select('-__v')
            .sort(sort)
            .skip(pagination.skip)
            .limit(pagination.limit)
            .lean();

    const [rules, total] = await Promise.all([rulesQuery, AlertRuleV2.countDocuments(filter)]);

    recordRequest('GET', '/api/v2/alert-rules', 200, timer.elapsed());

    // Demo mode grants an anonymous visitor the same read access as a real org
    // member (see requireOrgMembership()) — never let that also hand them a
    // real administrator's email off audit.created_by/updated_by/deleted_by.
    return jsonRedactedPaginated(
      redactAuditForDemo(rules, isDemoCaller(authContext)),
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
    const authContext = await requireAdmin();
    const auditUser = getAuditUser(authContext.userId, authContext.user);

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

    // requireAdmin() rejects a demo caller above, so this is inert today — it
    // is here so a future RBAC change cannot quietly start returning
    // audit.created_by/updated_by (a real administrator's email, via
    // getAuditUser) to an anonymous demo visitor. Every response from the
    // alert endpoints goes through one contract; this was the last hole in it,
    // and jsonRedacted is what now keeps it from reopening: it does not accept
    // an unredacted record, so deleting the call below is a compile error.
    return jsonRedacted(
      redactAuditForDemo(created.toObject({ versionKey: false }), isDemoCaller(authContext)),
      'Alert rule created successfully',
      201
    );
  })();
}

export const POST = withRateLimit(
  withRequestValidation(handleCreateAlertRule, ValidationPresets.jsonApi)
);
