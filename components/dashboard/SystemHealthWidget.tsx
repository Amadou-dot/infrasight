'use client';

import { useHealthAnalytics } from '@/lib/query/hooks';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

interface SystemHealthWidgetProps {
  onFilterClick?: (filter: 'online' | 'issues') => void;
}

export default function SystemHealthWidget({
  onFilterClick,
}: SystemHealthWidgetProps) {
  const { data: health, isLoading, error: fetchError } = useHealthAnalytics();
  const error = fetchError ? 'Failed to load health data' : null;

  const healthScore = health?.summary?.health_score ?? 0;
  const _totalDevices = health?.summary?.total_devices ?? 0;
  const activeDevices = health?.summary?.active_devices ?? 0;
  const issuesCount =
    (health?.alerts?.offline_devices?.count ?? 0) +
    (health?.alerts?.error_devices?.count ?? 0) +
    (health?.alerts?.low_battery_devices?.count ?? 0);

  // Calculate circle parameters for progress
  const size = 160;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (healthScore / 100) * circumference;
  const offset = circumference - progress;

  const getHealthColor = (score: number) => {
    if (score >= 80) return '#22c55e'; // green
    if (score >= 60) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  const getHealthLabel = (score: number) => {
    if (score >= 80) return 'GOOD';
    if (score >= 60) return 'FAIR';
    return 'POOR';
  };

  if (isLoading)
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <h3 className="text-lg font-semibold text-foreground mb-4">System Health</h3>
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );


  if (error) 
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <h3 className="text-lg font-semibold text-foreground mb-4">System Health</h3>
        <div className="flex items-center justify-center h-48">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      </div>
    );
  

  return (
    <div className="bg-card border border-border rounded-xl p-6 h-full flex flex-col">
      <h3 className="text-lg font-semibold text-foreground mb-4">System Health</h3>

      {/* Circular Progress */}
      <div className="flex-1 flex items-center justify-center">
        <div className="relative">
          <svg width={size} height={size} className="transform -rotate-90">
            {/* Background circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-muted"
            />
            {/* Progress circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={getHealthColor(healthScore)}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          </svg>
          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold text-foreground">{healthScore}%</span>
            <span
              className="text-sm font-medium"
              style={{ color: getHealthColor(healthScore) }}
            >
              {getHealthLabel(healthScore)}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border">
        <button
          onClick={() => onFilterClick?.('online')}
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted transition-colors text-left"
        >
          <CheckCircle2 className="h-5 w-5 text-cyan-500" />
          <div>
            <p className="text-xs text-muted-foreground">Online</p>
            <p className="text-lg font-bold text-foreground">
              {activeDevices.toLocaleString()}
            </p>
          </div>
        </button>
        <button
          onClick={() => onFilterClick?.('issues')}
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted transition-colors text-left"
        >
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <div>
            <p className="text-xs text-muted-foreground">Issues</p>
            <p className="text-lg font-bold text-foreground">
              {issuesCount.toLocaleString()}
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
