'use client';

import { Monitor } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

// ============================================================================
// TYPES
// ============================================================================

export interface DeviceStatusCardsProps {
  loading: boolean;
  totalCount: number;
  onlineCount: number;
  attentionCount: number;
  offlineCount: number;
  lowBatteryCount: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function DeviceStatusCards({
  loading,
  totalCount,
  onlineCount,
  attentionCount,
  offlineCount,
  lowBatteryCount,
}: DeviceStatusCardsProps) {
  return (
    <section className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Devices */}
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Total Devices</span>
              <Monitor className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-4xl font-bold text-foreground mb-1">
              {loading ? '—' : totalCount}
            </div>
            <span className="text-xs text-emerald-500">↗ +4 new this week</span>
          </CardContent>
        </Card>

        {/* Online Status */}
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Online Status</span>
              <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
            </div>
            <div className="text-4xl font-bold text-foreground mb-1">
              {loading ? '—' : onlineCount}
              <span className="text-lg text-muted-foreground font-normal ml-1">/ {totalCount}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all"
                style={{
                  width: totalCount ? `${(onlineCount / totalCount) * 100}%` : '0%',
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Attention Needed */}
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Attention Needed</span>
              <div className="h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span className="text-amber-500 text-xs">⚠</span>
              </div>
            </div>
            <div className="text-4xl font-bold text-foreground mb-1">
              {loading ? '—' : attentionCount}
            </div>
            <span className="text-xs text-muted-foreground">
              {offlineCount} Offline, {lowBatteryCount} Low Battery
            </span>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
