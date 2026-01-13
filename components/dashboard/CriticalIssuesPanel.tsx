'use client';

import { useMemo, useRef } from 'react';
import { useHealthAnalytics, useMaintenanceForecast } from '@/lib/query/hooks';
import {
  AlertTriangle,
  WifiOff,
  Thermometer,
  BatteryWarning,
  Wrench,
  ChevronRight,
  Loader2,
  MemoryStick,
} from 'lucide-react';
import Link from 'next/link';

interface CriticalIssue {
  id: string;
  title: string;
  location: string;
  severity: 'critical' | 'warning';
  timestamp: Date;
  type: 'offline' | 'error' | 'overheating' | 'battery' | 'maintenance' | 'memory';
}

interface CriticalIssuesPanelProps {
  onIssueClick?: (deviceId: string) => void;
  maxItems?: number;
}

export default function CriticalIssuesPanel({
  onIssueClick,
  maxItems = 5,
}: CriticalIssuesPanelProps) {
  const { data: health, isLoading: healthLoading, error: healthError } = useHealthAnalytics();
  const {
    data: forecast,
    isLoading: forecastLoading,
    error: forecastError,
  } = useMaintenanceForecast({ days_ahead: 7 });

  const isLoading = healthLoading || forecastLoading;
  const error = healthError || forecastError ? 'Failed to load issues' : null;

  // Stable reference time for fallback timestamps - initialized lazily
  const fallbackTimeRef = useRef<number | null>(null);
  // eslint-disable-next-line react-hooks/purity -- Intentional: lazy initialization of fallback time
  if (fallbackTimeRef.current === null) fallbackTimeRef.current = Date.now();

  // Calculate issues using useMemo (only recalculate when data changes)
  const issues = useMemo(() => {
    if (!health || !forecast) return [];

    const collectedIssues: CriticalIssue[] = [];
    const fallbackTime = fallbackTimeRef.current ?? 0;

    // Offline devices - Critical
    health.alerts?.offline_devices?.devices?.forEach(d => {
      collectedIssues.push({
        id: d._id,
        title: `Sensor #${d.serial_number?.slice(-4) || d._id.slice(-4)} Offline`,
        location: `${d.location?.room_name || 'Unknown'} • Floor ${d.location?.floor || 'N/A'}`,
        severity: 'critical',
        timestamp: new Date(d.health?.last_seen || fallbackTime),
        type: 'offline',
      });
    });

    // Error devices - Critical
    health.alerts?.error_devices?.devices?.forEach(d => {
      collectedIssues.push({
        id: d._id,
        title: `Sensor #${d.serial_number?.slice(-4) || d._id.slice(-4)} Error`,
        location: d.location?.room_name || 'Unknown Location',
        severity: 'critical',
        timestamp: new Date(fallbackTime),
        type: 'error',
      });
    });

    // Low battery devices - Warning
    health.alerts?.low_battery_devices?.devices?.forEach(d => {
      collectedIssues.push({
        id: d._id,
        title: `Low Battery (${d.health?.battery_level}%)`,
        location: d.location?.room_name || 'Unknown Location',
        severity: 'warning',
        timestamp: new Date(fallbackTime),
        type: 'battery',
      });
    });

    // Maintenance overdue - Critical
    forecast.summary?.maintenance_overdue?.forEach(d => {
      collectedIssues.push({
        id: d._id,
        title: `Maintenance Overdue`,
        location: `${d.location?.room_name || 'Unknown'} • Floor ${d.location?.floor || 'N/A'}`,
        severity: 'critical',
        timestamp: new Date(d.metadata?.next_maintenance || fallbackTime),
        type: 'maintenance',
      });
    });

    // Critical maintenance - Critical
    forecast.critical?.forEach(d => {
      if (!collectedIssues.some(i => i.id === d._id))
        collectedIssues.push({
          id: d._id,
          title: `Critical Maintenance Needed`,
          location: `${d.location?.room_name || 'Unknown'} • Floor ${d.location?.floor || 'N/A'}`,
          severity: 'critical',
          timestamp: new Date(d.metadata?.next_maintenance || fallbackTime),
          type: 'maintenance',
        });
    });

    // Sort by severity (critical first) then by timestamp
    collectedIssues.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    return collectedIssues.slice(0, maxItems);
  }, [health, forecast, maxItems]);

  const getIssueIcon = (type: CriticalIssue['type']) => {
    switch (type) {
      case 'offline':
        return <WifiOff className="h-5 w-5" />;
      case 'overheating':
        return <Thermometer className="h-5 w-5" />;
      case 'battery':
        return <BatteryWarning className="h-5 w-5" />;
      case 'maintenance':
        return <Wrench className="h-5 w-5" />;
      case 'memory':
        return <MemoryStick className="h-5 w-5" />;
      default:
        return <AlertTriangle className="h-5 w-5" />;
    }
  };

  const getIconBgColor = (type: CriticalIssue['type']) => {
    switch (type) {
      case 'offline':
        return 'bg-red-500/20 text-red-400';
      case 'overheating':
        return 'bg-orange-500/20 text-orange-400';
      case 'battery':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'maintenance':
        return 'bg-purple-500/20 text-purple-400';
      case 'memory':
        return 'bg-blue-500/20 text-blue-400';
      default:
        return 'bg-red-500/20 text-red-400';
    }
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  if (isLoading)
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Critical Issues</h3>
        </div>
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );

  if (error)
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Critical Issues</h3>
        </div>
        <div className="flex items-center justify-center h-48">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      </div>
    );

  return (
    <div className="bg-card border border-border rounded-xl p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Critical Issues</h3>
        <Link
          href="/devices"
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          View All
        </Link>
      </div>

      {/* Issues list */}
      <div className="flex-1 space-y-3 overflow-auto">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <AlertTriangle className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No critical issues</p>
          </div>
        ) : (
          issues.map(issue => (
            <button
              key={issue.id}
              onClick={() => onIssueClick?.(issue.id)}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left group"
            >
              {/* Icon */}
              <div className={`p-2 rounded-lg ${getIconBgColor(issue.type)}`}>
                {getIssueIcon(issue.type)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{issue.title}</p>
                <p className="text-xs text-muted-foreground truncate">{issue.location}</p>
              </div>

              {/* Severity & time */}
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    issue.severity === 'critical'
                      ? 'bg-red-500/20 text-red-500'
                      : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                  }`}
                >
                  {issue.severity === 'critical' ? 'CRITICAL' : 'WARNING'}
                </span>
                <span className="text-xs text-muted-foreground hidden sm:block">
                  {formatTimeAgo(issue.timestamp)}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
