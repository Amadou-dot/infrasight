/**
 * V2 Health Analytics API Route
 *
 * GET /api/v2/analytics/health - Device health dashboard analytics
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import DeviceV2 from '@/models/v2/DeviceV2';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { z } from 'zod';
import { validateQuery } from '@/lib/validations/validator';

// ============================================================================
// Query Schema
// ============================================================================

const healthAnalyticsQuerySchema = z.object({
  building_id: z.string().optional(),
  floor: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),
  department: z.string().optional(),
  offline_threshold_minutes: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).default(5),
  battery_warning_threshold: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).default(20),
});

type HealthAnalyticsQuery = z.infer<typeof healthAnalyticsQuerySchema>;

// ============================================================================
// GET /api/v2/analytics/health - Health Analytics
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
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

    // Build base filter
    const baseFilter: Record<string, unknown> = {
      'audit.deleted_at': { $exists: false },
    };

    if (query.building_id) 
      baseFilter['location.building_id'] = query.building_id;
    
    if (query.floor !== undefined) 
      baseFilter['location.floor'] = query.floor;
    
    if (query.department) 
      baseFilter['metadata.department'] = query.department;
    

    // Calculate offline threshold
    const offlineThreshold = new Date(Date.now() - query.offline_threshold_minutes * 60 * 1000);

    // Get status breakdown
    const statusBreakdown = await DeviceV2.aggregate([
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
    ]);

    // Get total device count
    const totalDevices = await DeviceV2.countDocuments(baseFilter);

    // Get active devices count
    const activeDevices = await DeviceV2.countDocuments({
      ...baseFilter,
      status: 'active',
    });

    // Get offline devices (based on last_seen)
    const offlineDevices = await DeviceV2.find(
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
    ).lean();

    // Get devices with low battery
    const lowBatteryDevices = await DeviceV2.find(
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
    ).lean();

    // Get devices with errors
    const errorDevices = await DeviceV2.find(
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
    ).lean();

    // Get devices needing maintenance (next_maintenance within 7 days)
    const maintenanceDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const maintenanceDue = await DeviceV2.find(
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
    ).lean();

    // Calculate average uptime
    const uptimeStats = await DeviceV2.aggregate([
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
    ]);

    // Calculate health score (percentage of active devices)
    const healthScore = totalDevices > 0 
      ? Math.round((activeDevices / totalDevices) * 100) 
      : 100;

    return jsonSuccess({
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
      },
      filters_applied: {
        building_id: query.building_id || null,
        floor: query.floor || null,
        department: query.department || null,
      },
    });
  })();
}
