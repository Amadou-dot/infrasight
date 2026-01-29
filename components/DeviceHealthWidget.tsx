'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useHealthAnalytics } from '@/lib/query/hooks';
import {
  Activity,
  AlertTriangle,
  Battery,
  CheckCircle,
  Clock,
  Wrench,
  XCircle,
} from 'lucide-react';

interface DeviceHealthWidgetProps {
  selectedFloor?: number | 'all';
  onFilterDevices?: (filter: { status?: string; hasIssues?: boolean }) => void;
}

export default function DeviceHealthWidget({ selectedFloor, onFilterDevices }: DeviceHealthWidgetProps) {
  // Data fetching with React Query, filtered by floor when selected
  const floorFilter = selectedFloor !== undefined && selectedFloor !== 'all' ? { floor: selectedFloor } : {};
  const { data: healthData, isLoading, error: fetchError } = useHealthAnalytics(floorFilter);

  const error = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : 'Failed to load health data'
    : null;

  if (isLoading)
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            System Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </CardContent>
      </Card>
    );

  if (error || !healthData)
    return (
      <Card className="w-full border-red-200 dark:border-red-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            System Health - Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            {error || 'Failed to load health data'}
          </p>
        </CardContent>
      </Card>
    );

  // Extract values from nested structure
  const healthScore = healthData.summary?.health_score ?? 0;
  const totalDevices = healthData.summary?.total_devices ?? 0;
  const activeDevices = healthData.summary?.active_devices ?? 0;

  // Get counts from status_breakdown
  const maintenanceDevices =
    healthData.status_breakdown?.find(s => s.status === 'maintenance')?.count ?? 0;
  const offlineDevices = healthData.status_breakdown?.find(s => s.status === 'offline')?.count ?? 0;
  const errorDevices = healthData.alerts?.error_devices?.count ?? 0;

  // Get alert counts
  const criticalAlerts = errorDevices;
  const maintenanceNeeded = healthData.alerts?.maintenance_due?.count ?? 0;
  const batteryWarnings = healthData.alerts?.low_battery_devices?.count ?? 0;

  const healthScoreColor =
    healthScore >= 90
      ? 'text-green-600 dark:text-green-400'
      : healthScore >= 70
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-red-600 dark:text-red-400';

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            System Health
          </span>
          <span className={`text-2xl font-bold ${healthScoreColor}`}>
            {healthScore.toFixed(1)}%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Device Status Breakdown */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            onClick={() => onFilterDevices?.({ status: 'active' })}
            className="flex flex-col items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors cursor-pointer border border-transparent hover:border-green-300 dark:hover:border-green-700"
          >
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {activeDevices}
              </p>
              <p className="text-xs text-green-700 dark:text-green-300">Active</p>
            </div>
          </button>

          <button
            onClick={() => onFilterDevices?.({ status: 'maintenance' })}
            className="flex flex-col items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors cursor-pointer border border-transparent hover:border-yellow-300 dark:hover:border-yellow-700"
          >
            <Wrench className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                {maintenanceDevices}
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300">Maintenance</p>
            </div>
          </button>

          <button
            onClick={() => onFilterDevices?.({ status: 'offline' })}
            className="flex flex-col items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer border border-transparent hover:border-gray-300 dark:hover:border-gray-600"
          >
            <Clock className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                {offlineDevices}
              </p>
              <p className="text-xs text-gray-700 dark:text-gray-300">Offline</p>
            </div>
          </button>

          <button
            onClick={() => onFilterDevices?.({ status: 'error' })}
            className="flex flex-col items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer border border-transparent hover:border-red-300 dark:hover:border-red-700"
          >
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{errorDevices}</p>
              <p className="text-xs text-red-700 dark:text-red-300">Error</p>
            </div>
          </button>
        </div>

        {/* Alerts & Warnings */}
        {(criticalAlerts > 0 || maintenanceNeeded > 0 || batteryWarnings > 0) && (
          <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Alerts & Warnings
            </h4>

            {criticalAlerts > 0 && (
              <button
                onClick={() => onFilterDevices?.({ hasIssues: true })}
                className="flex items-center justify-between w-full p-2 bg-red-50 dark:bg-red-950/20 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4" />
                  Critical Alerts
                </span>
                <Badge variant="destructive">{criticalAlerts}</Badge>
              </button>
            )}

            {maintenanceNeeded > 0 && (
              <button
                onClick={() => onFilterDevices?.({ status: 'maintenance' })}
                className="flex items-center justify-between w-full p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-300">
                  <Wrench className="h-4 w-4" />
                  Maintenance Needed
                </span>
                <Badge className="bg-yellow-500 hover:bg-yellow-600">{maintenanceNeeded}</Badge>
              </button>
            )}

            {batteryWarnings > 0 && (
              <button
                onClick={() => onFilterDevices?.({ hasIssues: true })}
                className="flex items-center justify-between w-full p-2 bg-orange-50 dark:bg-orange-950/20 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm text-orange-700 dark:text-orange-300">
                  <Battery className="h-4 w-4" />
                  Low Battery Warnings
                </span>
                <Badge className="bg-orange-500 hover:bg-orange-600">{batteryWarnings}</Badge>
              </button>
            )}
          </div>
        )}

        {/* Total Devices */}
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Total Devices:{' '}
            <span className="font-semibold text-gray-900 dark:text-white">{totalDevices}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
