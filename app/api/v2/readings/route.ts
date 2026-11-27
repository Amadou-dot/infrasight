/**
 * V2 Readings API Routes
 *
 * GET /api/v2/readings - Query readings with filters, pagination, and sorting
 */

import type { NextRequest } from 'next/server';
import { createReadContext } from '@/lib/data/read-context';
import { readReadings } from '@/lib/data/reading-reads';
import { listReadingsQuerySchema } from '@/lib/validations/v2/reading.validation';
import { validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonPaginated } from '@/lib/api/response';
import { requireOrgMembership } from '@/lib/auth';

// ============================================================================
// GET /api/v2/readings - Query Readings
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    const { orgId } = await requireOrgMembership();
    const context = await createReadContext(orgId, request.signal);

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, listReadingsQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const { readings, paginationInfo } = await readReadings(context, validationResult.data);
    return jsonPaginated(readings, paginationInfo);
  })();
}
