import { z } from 'zod';
import DeviceV2 from '@/models/v2/DeviceV2';
import { CACHE_TTL, healthKey } from '@/lib/cache';
import { type ReadContext, readCachedSnapshot, readOptions } from '@/lib/data/read-context';
import { ApiError } from '@/lib/errors';

export const healthAnalyticsQuerySchema = z.object({
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

export async function readHealth(context: ReadContext, query: HealthAnalyticsQuery) {
  const snapshot = await readCachedSnapshot(
    healthKey(context, query),
    CACHE_TTL.HEALTH,
    context,
    async now => {
      const options = readOptions(context);
      // Build base filter
      const baseFilter: Record<string, unknown> = {
        'audit.deleted_at': { $exists: false },
      };

      if (query.building_id) baseFilter['location.building_id'] = query.building_id;

      if (query.floor !== undefined) baseFilter['location.floor'] = query.floor;

      if (query.department) baseFilter['metadata.department'] = query.department;

      // Calculate offline threshold
      const offlineThreshold = new Date(
        now.getTime() - query.offline_threshold_minutes * 60 * 1000
      );

      // Run all independent queries in parallel
      const maintenanceDueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

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
        offlineCount,
        lowBatteryCount,
        errorCount,
        maintenanceDueCount,
        predictiveCount,
        devicesWithIssuesCount,
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
        ]).option(options),

        // Total device count
        DeviceV2.countDocuments(baseFilter).setOptions(options),

        // Active devices count
        DeviceV2.countDocuments({
          ...baseFilter,
          status: 'active',
        }).setOptions(options),

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
          .limit(10)
          .setOptions(options)
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
          .limit(10)
          .setOptions(options)
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
          .limit(10)
          .setOptions(options)
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
          .limit(10)
          .setOptions(options)
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
        ]).option(options),

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
          .limit(10)
          .setOptions(options)
          .lean(),

        DeviceV2.countDocuments({
          ...baseFilter,
          'health.last_seen': { $lt: offlineThreshold },
        }).setOptions(options),
        DeviceV2.countDocuments({
          ...baseFilter,
          'health.battery_level': { $lt: query.battery_warning_threshold, $ne: null },
        }).setOptions(options),
        DeviceV2.countDocuments({ ...baseFilter, status: 'error' }).setOptions(options),
        DeviceV2.countDocuments({
          ...baseFilter,
          'metadata.next_maintenance': { $lte: maintenanceDueDate, $ne: null },
        }).setOptions(options),
        DeviceV2.countDocuments({
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
        }).setOptions(options),
        // Distinct devices with ANY of the three "issue" conditions — the
        // number the dashboard adds up; $or dedups devices in two buckets.
        DeviceV2.countDocuments({
          ...baseFilter,
          $or: [
            { 'health.last_seen': { $lt: offlineThreshold } },
            { 'health.battery_level': { $lt: query.battery_warning_threshold, $ne: null } },
            { status: 'error' },
          ],
        }).setOptions(options),
      ]);

      // Calculate health score (percentage of active devices)
      const healthScore = totalDevices > 0 ? Math.round((activeDevices / totalDevices) * 100) : 100;

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
            count: offlineCount,
            devices: offlineDevices,
            threshold_minutes: query.offline_threshold_minutes,
          },
          low_battery_devices: {
            count: lowBatteryCount,
            devices: lowBatteryDevices,
            threshold_percent: query.battery_warning_threshold,
          },
          error_devices: {
            count: errorCount,
            devices: errorDevices,
          },
          maintenance_due: {
            count: maintenanceDueCount,
            devices: maintenanceDue,
          },
          predictive_maintenance: {
            count: predictiveCount,
            devices: predictiveMaintenanceItems,
          },
          devices_with_issues: {
            count: devicesWithIssuesCount,
          },
        },
        filters_applied: {
          building_id: query.building_id || null,
          floor: query.floor ?? null,
          department: query.department || null,
        },
      };
    }
  );
  const { offline_devices, low_battery_devices } = snapshot.data.alerts;
  if (
    offline_devices.threshold_minutes !== query.offline_threshold_minutes ||
    low_battery_devices.threshold_percent !== query.battery_warning_threshold
  )
    throw ApiError.serviceUnavailable(
      'Health snapshot thresholds do not match the requested thresholds'
    );
  return snapshot;
}
