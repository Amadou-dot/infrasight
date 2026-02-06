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
import dbConnect from '@/lib/db';
import DeviceV2 from '@/models/v2/DeviceV2';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { z } from 'zod';
import { validateQuery } from '@/lib/validations/validator';

// Phase 5 imports
import { getOrSet, CACHE_TTL, healthKey } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';

// Auth
import { requireOrgMembership } from '@/lib/auth';

// ============================================================================
// Query Schema
// ============================================================================

const healthAnalyticsQuerySchema = z.object({
  building_id: z.string().optional(),
  floor: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),
  department: z.string().optional(),
  offline_threshold_minutes: z
    .union([z.number(), z.string().transform(v => parseInt(v, 10))])
    .default(5),
  battery_warning_threshold: z
    .union([z.number(), z.string().transform(v => parseInt(v, 10))])
    .default(20),
});

type HealthAnalyticsQuery = z.infer<typeof healthAnalyticsQuerySchema>;

// ============================================================================
// GET /api/v2/analytics/health - Health Analytics
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require org membership for read access
    const authContext = await requireOrgMembership();

    await dbConnect();

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

    const query = validationResult.data as HealthAnalyticsQuery;

    // Generate cache key based on filters
    const cacheKey = healthKey(authContext.orgId, {
      building_id: query.building_id,
      floor: query.floor,
      department: query.department,
    });

    // Use cache-aside pattern
    const response = await getOrSet(
      cacheKey,
      async () => {
        // Build base filter
        const baseFilter: Record<string, unknown> = {
          'audit.deleted_at': { $exists: false },
        };

        if (query.building_id) baseFilter['location.building_id'] = query.building_id;

        if (query.floor !== undefined) baseFilter['location.floor'] = query.floor;

        if (query.department) baseFilter['metadata.department'] = query.department;

        // Calculate offline threshold
        const offlineThreshold = new Date(Date.now() - query.offline_threshold_minutes * 60 * 1000);

        // Run all independent queries in parallel
        const now = new Date();
        const maintenanceDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const [
          statusBreakdown,
          totalDevices,
          activeDevices,
          offlineDevices,
          lowBatteryDevices,
          errorDevices,
          maintenanceDue,
          uptimeStats,
          predictiveMaintenanceDevices,
        ] = await Promise.all([
          // Status breakdown
          DeviceV2.aggregate([
            { $match: baseFilter },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                status: '$_id',
                count: 1,
              },
            },
          ]).option({ maxTimeMS: 5000 }),

          // Total device count
          DeviceV2.countDocuments(baseFilter).maxTimeMS(5000),

          // Active devices count
          DeviceV2.countDocuments({
            ...baseFilter,
            status: 'active',
          }).maxTimeMS(5000),

          // Offline devices (based on last_seen)
          DeviceV2.find(
            {
              ...baseFilter,
              'health.last_seen': { $lt: offlineThreshold },
            },
            {
              _id: 1,
              serial_number: 1,
              'location.building_id': 1,
              'location.floor': 1,
              'location.room_name': 1,
              'health.last_seen': 1,
              status: 1,
            }
          )
            .limit(50)
            .maxTimeMS(5000)
            .lean(),

          // Devices with low battery
          DeviceV2.find(
            {
              ...baseFilter,
              'health.battery_level': { $lt: query.battery_warning_threshold, $ne: null },
            },
            {
              _id: 1,
              serial_number: 1,
              'location.room_name': 1,
              'health.battery_level': 1,
            }
          )
            .limit(50)
            .maxTimeMS(5000)
            .lean(),

          // Devices with errors
          DeviceV2.find(
            {
              ...baseFilter,
              status: 'error',
            },
            {
              _id: 1,
              serial_number: 1,
              'location.room_name': 1,
              'health.last_error': 1,
              'health.error_count': 1,
            }
          )
            .limit(50)
            .maxTimeMS(5000)
            .lean(),

          // Devices needing maintenance (next_maintenance within 7 days)
          DeviceV2.find(
            {
              ...baseFilter,
              'metadata.next_maintenance': { $lte: maintenanceDueDate, $ne: null },
            },
            {
              _id: 1,
              serial_number: 1,
              'location.room_name': 1,
              'metadata.next_maintenance': 1,
              'metadata.last_maintenance': 1,
            }
          )
            .limit(50)
            .maxTimeMS(5000)
            .lean(),

          // Average uptime
          DeviceV2.aggregate([
            { $match: baseFilter },
            {
              $group: {
                _id: null,
                avg_uptime: { $avg: '$health.uptime_percentage' },
                min_uptime: { $min: '$health.uptime_percentage' },
                max_uptime: { $max: '$health.uptime_percentage' },
                total_errors: { $sum: '$health.error_count' },
              },
            },
          ]).option({ maxTimeMS: 5000 }),

          // Predictive maintenance: devices at risk
          DeviceV2.find(
            {
              ...baseFilter,
              $or: [
                { 'health.battery_level': { $lt: 15, $ne: null } },
                {
                  'metadata.next_maintenance': {
                    $lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
                    $ne: null,
                  },
                },
                { 'health.error_count': { $gt: 10 } },
              ],
            },
            {
              _id: 1,
              serial_number: 1,
              'location.room_name': 1,
              'health.battery_level': 1,
              'health.error_count': 1,
              'metadata.next_maintenance': 1,
            }
          )
            .limit(50)
            .maxTimeMS(5000)
            .lean(),
        ]);

        // Calculate health score (percentage of active devices)
        const healthScore =
          totalDevices > 0 ? Math.round((activeDevices / totalDevices) * 100) : 100;

        // Categorize predictive maintenance issues
        const predictiveMaintenanceItems = predictiveMaintenanceDevices.map(device => {
          let issueType = 'unknown';
          let daysUntil: number | null = null;
          let severity: 'critical' | 'warning' = 'warning';

          // Determine issue type and severity
          if (device.health.battery_level !== undefined && device.health.battery_level < 15) {
            issueType = 'battery_critical';
            severity = 'critical';
          } else if (device.metadata.next_maintenance) {
            const maintenanceDate = new Date(device.metadata.next_maintenance);
            daysUntil = Math.ceil(
              (maintenanceDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
            );

            if (daysUntil < 0) {
              issueType = 'maintenance_overdue';
              severity = 'critical';
            } else if (daysUntil <= 3) {
              issueType = 'maintenance_due';
              severity = 'critical';
            }
          } else if (device.health.error_count > 10) {
            issueType = 'high_error_count';
            severity = 'critical';
          }

          return {
            id: device._id,
            serial_number: device.serial_number,
            room_name: device.location.room_name,
            issue_type: issueType,
            days_until: daysUntil,
            severity,
          };
        });

        return {
          summary: {
            total_devices: totalDevices,
            active_devices: activeDevices,
            health_score: healthScore,
            uptime_stats: uptimeStats[0] || {
              avg_uptime: 100,
              min_uptime: 100,
              max_uptime: 100,
              total_errors: 0,
            },
          },
          status_breakdown: statusBreakdown,
          alerts: {
            offline_devices: {
              count: offlineDevices.length,
              devices: offlineDevices.slice(0, 10),
              threshold_minutes: query.offline_threshold_minutes,
            },
            low_battery_devices: {
              count: lowBatteryDevices.length,
              devices: lowBatteryDevices.slice(0, 10),
              threshold_percent: query.battery_warning_threshold,
            },
            error_devices: {
              count: errorDevices.length,
              devices: errorDevices.slice(0, 10),
            },
            maintenance_due: {
              count: maintenanceDue.length,
              devices: maintenanceDue.slice(0, 10),
            },
            predictive_maintenance: {
              count: predictiveMaintenanceDevices.length,
              devices: predictiveMaintenanceItems.slice(0, 10),
            },
          },
          filters_applied: {
            building_id: query.building_id || null,
            floor: query.floor || null,
            department: query.department || null,
          },
        };
      },
      { ttl: CACHE_TTL.HEALTH }
    );

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/analytics/health', 200, duration);

    logger.debug('Health analytics request', {
      duration,
      cached: duration < 50,
      cacheKey,
    });

    return jsonSuccess(response);
  })();
}
