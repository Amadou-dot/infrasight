/**
 * V2 Maintenance Forecast API Route
 *
 * GET /api/v2/analytics/maintenance-forecast - Predictive maintenance analytics
 *
 * Phase 5 Features:
 * - Redis caching with 2-minute TTL
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
import { getOrSet, CACHE_TTL, analyticsKey } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';

// ============================================================================
// Query Schema
// ============================================================================

const maintenanceForecastQuerySchema = z.object({
  days_ahead: z
    .union([z.number(), z.string().transform((v) => parseInt(v, 10))])
    .default(7),
  severity_threshold: z
    .enum(['critical', 'warning', 'all'])
    .default('all'),
  building_id: z.string().optional(),
  floor: z
    .union([z.number(), z.string().transform((v) => parseInt(v, 10))])
    .optional(),
});

type MaintenanceForecastQuery = z.infer<typeof maintenanceForecastQuerySchema>;

// ============================================================================
// GET /api/v2/analytics/maintenance-forecast
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(
      searchParams,
      maintenanceForecastQuerySchema
    );
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map((e) => e.message).join(', '),
        { errors: validationResult.errors }
      );


    const query = validationResult.data as MaintenanceForecastQuery;

    // Generate cache key based on filters
    const cacheKey = analyticsKey('maintenance-forecast', {
      days_ahead: query.days_ahead,
      severity_threshold: query.severity_threshold,
      building_id: query.building_id,
      floor: query.floor,
    });

    // Use cache-aside pattern
    const response = await getOrSet(
      cacheKey,
      async () => {

    // Build base filter (exclude deleted devices)
    const baseFilter: Record<string, unknown> = {
      'audit.deleted_at': { $exists: false },
    };

    if (query.building_id) 
      baseFilter['location.building_id'] = query.building_id;
    
    if (query.floor !== undefined) 
      baseFilter['location.floor'] = query.floor;
    

    // Calculate date thresholds
    const now = new Date();
    const criticalMaintenanceDate = new Date(
      now.getTime() + 3 * 24 * 60 * 60 * 1000
    ); // 3 days
    const warningMaintenanceDate = new Date(
      now.getTime() + query.days_ahead * 24 * 60 * 60 * 1000
    );
    const warrantyWarningDate = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    ); // 30 days

    // Fetch all active devices
    const allDevices = await DeviceV2.findActive(baseFilter).lean();

    // Categorize devices
    const critical: typeof allDevices = [];
    const warning: typeof allDevices = [];
    const watch: typeof allDevices = [];

    for (const device of allDevices) {
      let isCritical = false;
      let isWarning = false;
      let isWatch = false;

      // Critical: Battery < 15%
      if (
        device.health.battery_level !== undefined &&
        device.health.battery_level < 15
      ) 
        isCritical = true;
      

      // Critical: Maintenance overdue (next_maintenance < now)
      if (
        device.metadata.next_maintenance &&
        new Date(device.metadata.next_maintenance) < now
      ) 
        isCritical = true;
      

      // Critical: Maintenance within 3 days
      if (
        !isCritical &&
        device.metadata.next_maintenance &&
        new Date(device.metadata.next_maintenance) < criticalMaintenanceDate
      ) 
        isCritical = true;
      

      // Warning: Battery < 30%
      if (
        !isCritical &&
        device.health.battery_level !== undefined &&
        device.health.battery_level < 30
      ) 
        isWarning = true;
      

      // Warning: Maintenance within specified days_ahead
      if (
        !isCritical &&
        device.metadata.next_maintenance &&
        new Date(device.metadata.next_maintenance) < warningMaintenanceDate
      ) 
        isWarning = true;
      

      // Watch: Warranty expiring within 30 days
      if (
        !isCritical &&
        !isWarning &&
        device.metadata.warranty_expiry &&
        new Date(device.metadata.warranty_expiry) < warrantyWarningDate
      ) 
        isWatch = true;
      

      // Add to appropriate category
      if (isCritical) critical.push(device);
      else if (isWarning) warning.push(device);
      else if (isWatch) watch.push(device);
    }

    // Calculate summary statistics
    const totalAtRisk = critical.length + warning.length + watch.length;

    // Find maintenance overdue devices
    const maintenanceOverdue = critical.filter(
      (d) =>
        d.metadata.next_maintenance &&
        new Date(d.metadata.next_maintenance) < now
    );

    // Calculate average battery level
    const devicesWithBattery = allDevices.filter(
      (d) => d.health.battery_level !== undefined
    );
    const avgBatteryAll =
      devicesWithBattery.length > 0
        ? devicesWithBattery.reduce(
            (sum, d) => sum + (d.health.battery_level || 0),
            0
          ) / devicesWithBattery.length
        : null;

    const response = {
      critical,
      warning,
      watch,
      summary: {
        total_at_risk: totalAtRisk,
        critical_count: critical.length,
        warning_count: warning.length,
        watch_count: watch.length,
        avg_battery_all: avgBatteryAll,
        maintenance_overdue: maintenanceOverdue,
      },
      filters_applied: {
        days_ahead: query.days_ahead,
        building_id: query.building_id || null,
        floor: query.floor || null,
      },
    };

        // Apply severity threshold filter if requested
        if (query.severity_threshold === 'critical') {
          return {
            ...response,
            warning: [],
            watch: [],
            summary: {
              ...response.summary,
              warning_count: 0,
              watch_count: 0,
            },
          };
        } else if (query.severity_threshold === 'warning') {
          return {
            ...response,
            watch: [],
            summary: {
              ...response.summary,
              watch_count: 0,
            },
          };
        }

        return response;
      },
      { ttl: CACHE_TTL.MAINTENANCE_FORECAST }
    );

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/analytics/maintenance-forecast', 200, duration);

    logger.debug('Maintenance forecast request', {
      duration,
      cached: duration < 50,
      cacheKey,
    });

    return jsonSuccess(response);
  })();
}
