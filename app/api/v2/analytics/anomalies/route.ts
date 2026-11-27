/**
 * V2 Anomalies Analytics API Route
 *
 * GET /api/v2/analytics/anomalies - Anomaly detection and trends
 *
 * Phase 5 Features:
 * - Redis caching with 1-minute TTL
 * - Metrics and logging
 */

import type { NextRequest } from 'next/server';
import { readAnomalies } from '@/lib/analytics/anomalies';
import { jsonSuccess } from '@/lib/api/response';
import { requireOrgMembership } from '@/lib/auth';
import { createReadContext } from '@/lib/data/read-context';
import { ApiError, ErrorCodes, withErrorHandler } from '@/lib/errors';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { anomalyAnalyticsQuerySchema } from '@/lib/validations/v2/reading.validation';
import { validateQuery } from '@/lib/validations/validator';

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require org membership for read access
    const authContext = await requireOrgMembership();

    const context = await createReadContext(authContext.orgId, request.signal);

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, anomalyAnalyticsQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const snapshot = await readAnomalies(context, validationResult.data);

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/analytics/anomalies', 200, duration);

    logger.debug('Anomalies analytics request', {
      duration,
    });

    return jsonSuccess(snapshot.data);
  })();
}
