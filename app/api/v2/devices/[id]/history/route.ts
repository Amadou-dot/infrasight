/**
 * V2 Device History API Route
 *
 * GET /api/v2/devices/[id]/history - Get device audit history
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  deviceIdParamSchema,
  deviceHistoryQuerySchema,
  type DeviceHistoryQuery,
} from '@/lib/validations/v2/device.validation';
import { validateInput, validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonPaginated } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';

// ============================================================================
// History Entry Type
// ============================================================================

interface HistoryEntry {
  action: 'created' | 'updated' | 'deleted';
  timestamp: Date;
  user: string;
  changes?: Record<string, unknown>;
}

// ============================================================================
// GET /api/v2/devices/[id]/history - Get Device History
// ============================================================================

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    await dbConnect();

    const { id } = await params;

    // Validate path param
    const paramValidation = validateInput({ id }, deviceIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    // Validate query params
    const searchParams = request.nextUrl.searchParams;
    const queryValidation = validateQuery(searchParams, deviceHistoryQuerySchema);

    if (!queryValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        queryValidation.errors.map(e => e.message).join(', '),
        { errors: queryValidation.errors }
      );

    const query = queryValidation.data as DeviceHistoryQuery;

    // Find device (include deleted for history)
    const device = await DeviceV2.findById(id).lean();

    if (!device) throw ApiError.notFound('Device', id);

    // Build history from audit trail
    // Note: In a production system, you might have a separate audit log collection
    // For now, we construct history from the device's audit field
    const history: HistoryEntry[] = [];

    // Created entry
    if (device.audit?.created_at)
      history.push({
        action: 'created',
        timestamp: device.audit.created_at,
        user: device.audit.created_by || 'unknown',
        changes: {
          initial_status: device.status,
          initial_type: device.type,
          initial_location: device.location,
        },
      });

    // Updated entry (if different from created)
    if (
      device.audit?.updated_at &&
      device.audit.created_at &&
      device.audit.updated_at.getTime() !== device.audit.created_at.getTime()
    )
      history.push({
        action: 'updated',
        timestamp: device.audit.updated_at,
        user: device.audit.updated_by || 'unknown',
        changes: {
          current_status: device.status,
        },
      });

    // Deleted entry
    if (device.audit?.deleted_at)
      history.push({
        action: 'deleted',
        timestamp: device.audit.deleted_at,
        user: device.audit.deleted_by || 'unknown',
      });

    // Apply filters
    let filteredHistory = history;

    // Filter by action
    if (query.action) filteredHistory = filteredHistory.filter(h => h.action === query.action);

    // Filter by user
    if (query.user) filteredHistory = filteredHistory.filter(h => h.user === query.user);

    // Filter by date range
    if (query.startDate) {
      const startDate = new Date(query.startDate);
      filteredHistory = filteredHistory.filter(h => h.timestamp >= startDate);
    }
    if (query.endDate) {
      const endDate = new Date(query.endDate);
      filteredHistory = filteredHistory.filter(h => h.timestamp <= endDate);
    }

    // Sort by timestamp descending (most recent first)
    filteredHistory.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const pagination = getOffsetPaginationParams({
      page: query.page,
      limit: query.limit,
    });

    const total = filteredHistory.length;
    const paginatedHistory = filteredHistory.slice(
      pagination.skip,
      pagination.skip + pagination.limit
    );

    const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

    return jsonPaginated(paginatedHistory, paginationInfo);
  })();
}
