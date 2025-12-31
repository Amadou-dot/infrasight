'use client';

import { useEffect, useState } from 'react';
import { v2Api } from '@/lib/api/v2-client';
import type { MaintenanceForecastResponse, DeviceV2Response } from '@/types/v2';
import {
  Calendar,
  Wrench,
  Settings,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

interface MaintenanceItem {
  id: string;
  title: string;
  scheduledDate: Date;
  type: 'firmware' | 'calibration' | 'inspection' | 'repair';
}

interface MaintenanceWidgetProps {
  onItemClick?: (deviceId: string) => void;
  maxItems?: number;
}

export default function MaintenanceWidget({
  onItemClick,
  maxItems = 4,
}: MaintenanceWidgetProps) {
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMaintenance = async (showLoading = false) => {
      try {
        if (showLoading) setLoading(true);

        const response = await v2Api.analytics.maintenanceForecast({
          days_ahead: 14,
        });

        const forecast: MaintenanceForecastResponse = response.data;

        // Combine critical and warning devices, sorted by date
        const allDevices: DeviceV2Response[] = [
          ...(forecast.critical || []),
          ...(forecast.warning || []),
          ...(forecast.watch || []),
        ];

        const maintenanceItems: MaintenanceItem[] = allDevices
          .filter((d) => d.metadata?.next_maintenance)
          .map((d, index) => {
            // Determine maintenance type based on device type or serial
            let maintType: MaintenanceItem['type'] = 'inspection';
            
            if (d.type === 'temperature' || d.type === 'humidity' || d.type === 'pressure') {
              maintType = 'calibration';
            } else if (d.firmware_version && index % 3 === 0) {
              maintType = 'firmware';
            } else if (d.status === 'error') {
              maintType = 'repair';
            }

            return {
              id: d._id,
              title: maintType === 'firmware'
                ? `Firmware Update v${d.firmware_version || '2.4'}`
                : maintType === 'calibration'
                  ? 'Sensor Calibration'
                  : maintType === 'repair'
                    ? 'Device Repair'
                    : 'Routine Inspection',
              scheduledDate: new Date(d.metadata.next_maintenance!),
              type: maintType,
            };
          })
          .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
          .slice(0, maxItems);

        setItems(maintenanceItems);
        setError(null);
      } catch (err) {
        console.error('Error fetching maintenance:', err);
        setError('Failed to load maintenance data');
      } finally {
        if (showLoading) setLoading(false);
      }
    };

    fetchMaintenance(true);
    const interval = setInterval(() => fetchMaintenance(false), 60000);
    return () => clearInterval(interval);
  }, [maxItems]);

  const getTypeIcon = (type: MaintenanceItem['type']) => {
    switch (type) {
      case 'firmware':
        return <Settings className="h-4 w-4" />;
      case 'calibration':
        return <Wrench className="h-4 w-4" />;
      case 'repair':
        return <Wrench className="h-4 w-4" />;
      default:
        return <Wrench className="h-4 w-4" />;
    }
  };

  const getTypeColor = (type: MaintenanceItem['type']) => {
    switch (type) {
      case 'firmware':
        return 'bg-cyan-500/20 text-cyan-400';
      case 'calibration':
        return 'bg-amber-500/20 text-amber-400';
      case 'repair':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-purple-500/20 text-purple-400';
    }
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const targetDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    if (targetDate.getTime() === today.getTime()) {
      return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (targetDate.getTime() === tomorrow.getTime()) {
      return `Tomorrow, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Maintenance</h3>
        </div>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Maintenance</h3>
        </div>
        <div className="flex items-center justify-center h-32">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Maintenance</h3>
        <Link
          href="/maintenance"
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Calendar
        </Link>
      </div>

      {/* Maintenance items */}
      <div className="flex-1 space-y-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Calendar className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No upcoming maintenance</p>
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => onItemClick?.(item.id)}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left group"
            >
              {/* Icon */}
              <div className={`p-2 rounded-lg ${getTypeColor(item.type)}`}>
                {getTypeIcon(item.type)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  Scheduled for {formatDate(item.scheduledDate)}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
