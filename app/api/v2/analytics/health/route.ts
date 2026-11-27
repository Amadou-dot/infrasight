/**
 * V2 Health Analytics API Route
 *
 * GET /api/v2/analytics/health - Device health dashboard analytics
 *
 * Phase 5 Features:
 * - Redis caching with 60-second TTL
 * - Metrics and logging
 */

import type { NextRequest } from 'next/server';
import { healthAnalyticsQuerySchema, readHealth } from '@/lib/analytics/health';
import { jsonSuccess } from '@/lib/api/response';
import { requireOrgMembership } from '@/lib/auth';
import { createReadContext } from '@/lib/data/read-context';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { validateQuery } from '@/lib/validations/validator';

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require org membership for read access
    const authContext = await requireOrgMembership();

    const context = await createReadContext(authContext.orgId, request.signal);

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, healthAnalyticsQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const snapshot = await readHealth(context, validationResult.data);

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/analytics/health', 200, duration);

    logger.debug('Health analytics request', {
      duration,
    });

    return jsonSuccess(snapshot.data);
  })();
}
