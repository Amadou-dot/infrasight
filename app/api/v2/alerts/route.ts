/**
 * V2 Alerts API Route
 *
 * GET /api/v2/alerts - List alerts with pagination, filtering, and sorting
 *
 * Defaults to OPEN alerts (firing + acknowledged) and NEVER returns `pending`.
 * `pending` is an internal state: it is what makes for_duration_seconds work
 * without a second state store, it raises no notification, and it is deleted
 * rather than resolved when the condition clears.
 *
 * Deliberately NOT cached. The set changes whenever the evaluator fires or
 * resolves an episode — i.e. on every ingest, see lib/alerting/index.ts — and,
 * unlike alert-rules (which calls `invalidateAlertRules()` on every mutation),
 * no invalidation hook is wired to those writes. A cache-aside layer here would
 * mean stale results for an operator actively triaging what is currently
 * firing. Nothing publishes alerts over Pusher yet either: both
 * `safeEvaluateReadings()` call sites (readings/ingest, cron/simulate) discard
 * its result after logging it. Real-time delivery is Task 13/14's job, not
 * this endpoint's.
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertV2 from '@/models/v2/AlertV2';
import {
  listAlertsQuerySchema,
  type ListAlertsQuery,
} from '@/lib/validations/v2/alert.validation';
import { validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonPaginated } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireOrgMembership } from '@/lib/auth';

/** Statuses a client may ever see. `pending` is internal and always excluded. */
const VISIBLE_STATUSES = ['firing', 'acknowledged', 'resolved'] as const;
const OPEN_STATUSES = ['firing', 'acknowledged'] as const;

const SORT_FIELD_MAP: Record<string, string> = {
  created_at: 'audit.created_at',
  fired_at: 'fired_at',
  severity: 'severity',
  status: 'status',
  last_observed_at: 'last_observed_at',
};

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const validationResult = validateQuery(request.nextUrl.searchParams, listAlertsQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as ListAlertsQuery;
    const pagination = getOffsetPaginationParams({ page: query.page, limit: query.limit });

    const filter: Record<string, unknown> = {};

    // Intersect whatever the caller asked for with the visible set, so `pending`
    // can never leak through an explicit status filter.
    const requested = query.status
      ? (Array.isArray(query.status) ? query.status : [query.status])
      : [...OPEN_STATUSES];
    const statuses = requested.filter(s => (VISIBLE_STATUSES as readonly string[]).includes(s));
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };

    if (query.severity) {
      const severities = Array.isArray(query.severity) ? query.severity : [query.severity];
      filter.severity = severities.length === 1 ? severities[0] : { $in: severities };
    }

    if (query.device_id) filter.device_id = query.device_id;
    if (query.rule_id) filter.rule_id = query.rule_id;

    // Filter on `fired_at`, the domain event — NOT `audit.created_at`, which is
    // stamped when the invisible `pending` episode is first created. With a
    // non-zero for_duration_seconds those differ by the whole duration, so a
    // client asking "which alerts fired in this window" would get the wrong set.
    // Matches how readings filter on `timestamp` and schedules on
    // `scheduled_date`. Every visible alert has `fired_at`: pending episodes are
    // deleted rather than resolved, so they never reach a client.
    if (query.startDate || query.endDate) {
      const range: Record<string, Date> = {};
      if (query.startDate) range.$gte = new Date(query.startDate);
      if (query.endDate) range.$lte = new Date(query.endDate);
      filter.fired_at = range;
    }

    const sortField = SORT_FIELD_MAP[query.sortBy ?? 'created_at'] ?? 'audit.created_at';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortDirection === 'asc' ? 1 : -1 };

    const [alerts, total] = await Promise.all([
      AlertV2.find(filter)
        .select('-__v')
        .sort(sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      AlertV2.countDocuments(filter),
    ]);

    const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/alerts', 200, duration);
    logger.debug('Alerts list request', { duration, total, statuses });

    return jsonPaginated(alerts, paginationInfo);
  })();
}
