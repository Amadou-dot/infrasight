'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { v2Api } from '@/lib/api/v2-client';
import type { MaintenanceForecastResponse, DeviceV2Response } from '@/types/v2';
import { AlertCircle, AlertTriangle, Eye, Battery, Wrench, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { formatRelativeDate } from '@/lib/utils/severity';

// ============================================================================
// TYPES
// ============================================================================

interface MaintenanceForecastWidgetProps {
  onDeviceClick?: (deviceId: string) => void;
  onFilterBySeverity?: (severity: 'critical' | 'warning' | 'watch') => void;
  daysAhead?: number;
}

type Section = 'critical' | 'warning' | 'watch';

// ============================================================================
// COMPONENT
// ============================================================================

export default function MaintenanceForecastWidget({
  onDeviceClick,
  onFilterBySeverity,
  daysAhead = 7,
}: MaintenanceForecastWidgetProps) {
  const [forecast, setForecast] = useState<MaintenanceForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<Section>>(
    new Set(['critical', 'warning'])
  );

  // Fetch forecast data
  const fetchForecast = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await v2Api.analytics.maintenanceForecast({ days_ahead: daysAhead });
      setForecast(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forecast');
      console.error('Maintenance forecast error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchForecast();
  }, [daysAhead]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(fetchForecast, 60000);
    return () => clearInterval(interval);
  }, [daysAhead]);

  // Toggle section expansion
  const toggleSection = (section: Section) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  // Get issue description for a device
  const getDeviceIssue = (device: DeviceV2Response, severity: Section): string => {
    const issues: string[] = [];

    if (device.health.battery_level !== undefined) {
      if (severity === 'critical' && device.health.battery_level < 15) {
        issues.push(`Battery ${device.health.battery_level}%`);
      } else if (severity === 'warning' && device.health.battery_level < 30) {
        issues.push(`Battery ${device.health.battery_level}%`);
      }
    }

    if (device.metadata.next_maintenance) {
      const maintenanceDate = new Date(device.metadata.next_maintenance);
      const isPast = maintenanceDate < new Date();
      
      if (isPast) {
        issues.push(`Maintenance overdue ${formatRelativeDate(maintenanceDate)}`);
      } else {
        issues.push(`Maintenance ${formatRelativeDate(maintenanceDate)}`);
      }
    }

    if (device.metadata.warranty_expiry && severity === 'watch') {
      issues.push(`Warranty ${formatRelativeDate(device.metadata.warranty_expiry)}`);
    }

    return issues.length > 0 ? issues.join(', ') : 'Requires attention';
  };

  // Render device item
  const renderDevice = (device: DeviceV2Response, severity: Section) => (
    <button
      key={device._id}
      onClick={() => onDeviceClick?.(device._id)}
      className="w-full text-left p-2 rounded hover:bg-muted/50 transition-colors flex items-start gap-2 group"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{device._id}</div>
        <div className="text-xs text-muted-foreground truncate">
          {device.location.room_name} • Floor {device.location.floor}
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          {getDeviceIssue(device, severity)}
        </div>
      </div>
      <ChevronDown className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );

  // Render section
  const renderSection = (
    section: Section,
    devices: DeviceV2Response[],
    icon: React.ReactNode,
    title: string,
    colorClass: string
  ) => {
    const isExpanded = expandedSections.has(section);
    const visibleDevices = isExpanded ? devices.slice(0, 5) : [];
    const hasMore = devices.length > 5;

    return (
      <div className={`border-l-4 ${colorClass} pl-3 py-2`}>
        <button
          onClick={() => toggleSection(section)}
          className="w-full flex items-center justify-between mb-2 hover:opacity-80 transition-opacity"
        >
          <div className="flex items-center gap-2">
            {icon}
            <span className="font-semibold">{title}</span>
            <Badge variant="secondary" className="ml-1">
              {devices.length}
            </Badge>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {isExpanded && (
          <div className="space-y-1">
            {devices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No devices in this category</p>
            ) : (
              <>
                {visibleDevices.map((device) => renderDevice(device, section))}
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFilterBySeverity?.(section);
                    }}
                  >
                    Show {devices.length - 5} more...
                  </Button>
                )}
                {devices.length > 0 && onFilterBySeverity && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => onFilterBySeverity(section)}
                  >
                    View all {devices.length} devices
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Loading state
  if (loading && !forecast) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Maintenance Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error || !forecast) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Maintenance Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{error || 'Failed to load forecast'}</p>
            <Button variant="outline" size="sm" onClick={fetchForecast} className="mt-4">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalAtRisk = forecast.summary.total_at_risk;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Maintenance Forecast
          </div>
          <Badge variant={totalAtRisk > 0 ? 'destructive' : 'secondary'}>
            {totalAtRisk} at risk
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">Next {daysAhead} days</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Critical Section */}
        {renderSection(
          'critical',
          forecast.critical,
          <AlertCircle className="h-4 w-4 text-red-600" />,
          'CRITICAL',
          'border-red-500'
        )}

        {/* Warning Section */}
        {renderSection(
          'warning',
          forecast.warning,
          <AlertTriangle className="h-4 w-4 text-amber-600" />,
          'WARNING',
          'border-amber-500'
        )}

        {/* Watch Section */}
        {renderSection(
          'watch',
          forecast.watch,
          <Eye className="h-4 w-4 text-blue-600" />,
          'WATCH',
          'border-blue-500'
        )}

        {/* Summary Stats */}
        {forecast.summary.maintenance_overdue.length > 0 && (
          <div className="pt-4 border-t">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <Clock className="h-4 w-4" />
              <span className="font-medium">
                {forecast.summary.maintenance_overdue.length} device(s) have overdue maintenance
              </span>
            </div>
          </div>
        )}

        {forecast.summary.avg_battery_all !== null && forecast.summary.avg_battery_all < 50 && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <Battery className="h-4 w-4" />
            <span>
              Average battery: {Math.round(forecast.summary.avg_battery_all)}%
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
