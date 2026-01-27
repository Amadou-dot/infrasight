/**
 * V2 Audit Trail API Route
 *
 * GET /api/v2/audit - Cross-device audit trail with filtering
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import DeviceV2 from '@/models/v2/DeviceV2';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { z } from 'zod';
import { validateQuery } from '@/lib/validations/validator';
import { paginationSchema, dateRangeSchema } from '@/lib/validations/common.validation';

// ============================================================================
// Validation Schema
// ============================================================================

const auditQuerySchema = z.object({
  ...paginationSchema.shape,
  ...dateRangeSchema.shape,

  // Action filter
  action: z
    .enum(['create', 'update', 'delete'])
    .or(z.string().transform(val => val.split(',') as ('create' | 'update' | 'delete')[]))
    .optional(),

  // User filter
  user: z.string().max(100).optional(),

  // Device filter
  device_id: z
    .string()
    .or(z.string().transform(val => val.split(',')))
    .optional(),

  // Include deleted devices
  include_deleted: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(true),

  // Sorting
  sortBy: z.enum(['timestamp', 'action', 'device_id', 'user']).default('timestamp'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

type AuditQuery = z.infer<typeof auditQuerySchema>;

// ============================================================================
// Audit Entry Type
// ============================================================================

interface AuditEntry {
  device_id: string;
  action: 'create' | 'update' | 'delete';
  timestamp: Date;
  user: string;
  details: Record<string, unknown>;
}

// ============================================================================
// GET /api/v2/audit - Audit Trail
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, auditQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as AuditQuery;

    // Extract pagination
    const pagination = getOffsetPaginationParams({
      page: query.page,
      limit: query.limit,
    });

    // Build device match
    const deviceMatch: Record<string, unknown> = {};

    if (!query.include_deleted) deviceMatch['audit.deleted_at'] = { $exists: false };

    if (query.device_id) {
      const deviceIds = Array.isArray(query.device_id) ? query.device_id : [query.device_id];
      deviceMatch._id = deviceIds.length === 1 ? deviceIds[0] : { $in: deviceIds };
    }

    // Get all devices matching filters
    const devices = await DeviceV2.find(deviceMatch).select('_id serial_number audit').lean();

    // Build audit entries from devices
    const auditEntries: AuditEntry[] = [];

    for (const device of devices) {
      const audit = device.audit;

      // Create entry
      auditEntries.push({
        device_id: device._id,
        action: 'create',
        timestamp: audit.created_at,
        user: audit.created_by,
        details: {
          action_type: 'device_created',
          serial_number: device.serial_number,
        },
      });

      // Update entries
      if (audit.updated_at && audit.updated_at.getTime() !== audit.created_at.getTime())
        auditEntries.push({
          device_id: device._id,
          action: 'update',
          timestamp: audit.updated_at,
          user: audit.updated_by || audit.created_by,
          details: {
            action_type: 'device_updated',
          },
        });

      // Delete entry
      if (audit.deleted_at)
        auditEntries.push({
          device_id: device._id,
          action: 'delete',
          timestamp: audit.deleted_at,
          user: audit.deleted_by || 'system',
          details: {
            action_type: 'device_deleted',
          },
        });
    }

    // Apply filters
    let filteredEntries = auditEntries;

    // Action filter
    if (query.action) {
      const actions = Array.isArray(query.action) ? query.action : [query.action];
      filteredEntries = filteredEntries.filter(e => actions.includes(e.action));
    }

    // User filter
    if (query.user) {
      const userLower = query.user.toLowerCase();
      filteredEntries = filteredEntries.filter(e => e.user.toLowerCase().includes(userLower));
    }

    // Date range filter
    if (query.startDate) {
      const startDate = new Date(query.startDate);
      filteredEntries = filteredEntries.filter(e => e.timestamp >= startDate);
    }
    if (query.endDate) {
      const endDate = new Date(query.endDate);
      filteredEntries = filteredEntries.filter(e => e.timestamp <= endDate);
    }

    // Sort entries
    const sortMultiplier = query.sortDirection === 'asc' ? 1 : -1;
    filteredEntries.sort((a, b) => {
      switch (query.sortBy) {
        case 'timestamp':
          return sortMultiplier * (a.timestamp.getTime() - b.timestamp.getTime());
        case 'action':
          return sortMultiplier * a.action.localeCompare(b.action);
        case 'device_id':
          return sortMultiplier * a.device_id.localeCompare(b.device_id);
        case 'user':
          return sortMultiplier * a.user.localeCompare(b.user);
        default:
          return 0;
      }
    });

    // Get total before pagination
    const total = filteredEntries.length;

    // Apply pagination
    const paginatedEntries = filteredEntries.slice(
      pagination.skip,
      pagination.skip + pagination.limit
    );

    // Calculate pagination info
    const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

    // Get summary statistics
    const actionCounts = filteredEntries.reduce(
      (acc, entry) => {
        acc[entry.action] = (acc[entry.action] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const userCounts = filteredEntries.reduce(
      (acc, entry) => {
        acc[entry.user] = (acc[entry.user] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Get top users
    const topUsers = Object.entries(userCounts)
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return jsonSuccess({
      entries: paginatedEntries,
      pagination: paginationInfo,
      summary: {
        total_entries: total,
        by_action: actionCounts,
        top_users: topUsers,
      },
      filters_applied: {
        action: query.action || null,
        user: query.user || null,
        device_id: query.device_id || null,
        date_range: {
          start: query.startDate,
          end: query.endDate,
        },
      },
    });
  })();
}
