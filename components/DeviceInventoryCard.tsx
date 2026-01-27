'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Thermometer,
  Droplets,
  Users,
  Zap,
  Cloud,
  Gauge,
  Sun,
  Activity,
  Waves,
  Flame,
  BarChart3,
  BatteryWarning,
  MoreVertical,
  MapPin,
  Trash2,
} from 'lucide-react';
import type { DeviceV2Response } from '@/types/v2';

interface DeviceInventoryCardProps {
  device: DeviceV2Response;
  onClick?: () => void;
  onDelete?: (deviceId: string) => void;
}

// Get icon component based on device type
function getDeviceIcon(type: string) {
  const iconClass = 'h-5 w-5';
  switch (type) {
    case 'temperature':
      return <Thermometer className={iconClass} />;
    case 'humidity':
      return <Droplets className={iconClass} />;
    case 'occupancy':
      return <Users className={iconClass} />;
    case 'power':
    case 'energy':
      return <Zap className={iconClass} />;
    case 'co2':
    case 'air_quality':
      return <Cloud className={iconClass} />;
    case 'pressure':
      return <Gauge className={iconClass} />;
    case 'light':
      return <Sun className={iconClass} />;
    case 'motion':
      return <Activity className={iconClass} />;
    case 'water_flow':
      return <Waves className={iconClass} />;
    case 'gas':
      return <Flame className={iconClass} />;
    case 'vibration':
      return <BarChart3 className={iconClass} />;
    case 'voltage':
    case 'current':
      return <Zap className={iconClass} />;
    default:
      return <Activity className={iconClass} />;
  }
}

// Get icon background color based on device type
function getIconBgColor(type: string): string {
  switch (type) {
    case 'temperature':
      return 'bg-orange-500/20 text-orange-500';
    case 'humidity':
      return 'bg-blue-500/20 text-blue-500';
    case 'occupancy':
      return 'bg-purple-500/20 text-purple-500';
    case 'power':
    case 'energy':
    case 'voltage':
    case 'current':
      return 'bg-yellow-500/20 text-yellow-500';
    case 'co2':
    case 'air_quality':
      return 'bg-teal-500/20 text-teal-500';
    case 'pressure':
      return 'bg-cyan-500/20 text-cyan-500';
    case 'light':
      return 'bg-amber-500/20 text-amber-500';
    case 'motion':
      return 'bg-green-500/20 text-green-500';
    case 'water_flow':
      return 'bg-sky-500/20 text-sky-500';
    case 'gas':
      return 'bg-red-500/20 text-red-500';
    case 'vibration':
      return 'bg-indigo-500/20 text-indigo-500';
    default:
      return 'bg-gray-500/20 text-gray-500';
  }
}

// Get status badge styling
function getStatusBadge(status: string, batteryLevel?: number) {
  // Check for low battery
  if (batteryLevel !== undefined && batteryLevel < 20)
    return (
      <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs gap-1">
        <BatteryWarning className="h-3 w-3" />
        Low Battery
      </Badge>
    );

  switch (status) {
    case 'active':
      return (
        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
          ● Online
        </Badge>
      );
    case 'offline':
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">● Offline</Badge>
      );
    case 'maintenance':
      return (
        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
          ● Maintenance
        </Badge>
      );
    case 'error':
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">● Error</Badge>
      );
    case 'decommissioned':
      return (
        <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs">
          ● Decommissioned
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-xs">
          {status}
        </Badge>
      );
  }
}

// Format device type for display
function formatDeviceType(type: string): string {
  return (
    type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') + ' Sensor'
  );
}

// Calculate uptime display
function formatUptime(uptimePercentage: number): string {
  const days = Math.floor(uptimePercentage);
  return `Uptime: ${days}d`;
}

// Get secondary stat based on device type
function getSecondaryStat(device: DeviceV2Response): { label: string; value: string } | null {
  const { health } = device;

  if (health.battery_level !== undefined)
    return { label: 'Battery', value: `${health.battery_level}%` };

  if (health.signal_strength !== undefined) {
    const strength =
      health.signal_strength > -50 ? 'Strong' : health.signal_strength > -70 ? 'Good' : 'Weak';
    return {
      label: 'Signal',
      value: `${health.signal_strength}dBm (${strength})`,
    };
  }

  if (health.uptime_percentage !== undefined)
    return {
      label: 'Uptime',
      value: `${Math.round(health.uptime_percentage)}%`,
    };

  return null;
}

export default function DeviceInventoryCard({
  device,
  onClick,
  onDelete,
}: DeviceInventoryCardProps) {
  const secondaryStat = getSecondaryStat(device);

  // Get status-based hover border color
  const getStatusHoverBorder = () => {
    switch (device.status) {
      case 'active':
        return 'hover:border-emerald-500';
      case 'offline':
      case 'error':
        return 'hover:border-red-500';
      case 'maintenance':
        return 'hover:border-amber-500';
      case 'decommissioned':
        return 'hover:border-gray-500';
      default:
        return 'hover:border-primary/50';
    }
  };

  return (
    <Card
      className={`bg-card border-border ${getStatusHoverBorder()} transition-all cursor-pointer group`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${getIconBgColor(device.type)}`}>
              {getDeviceIcon(device.type)}
            </div>
            <div>
              <h3 className='font-semibold text-sm text-foreground truncate max-w-35'>
                {device._id}
              </h3>
              <p className="text-xs text-muted-foreground">{formatDeviceType(device.type)}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0'
                onClick={e => {
                  e.stopPropagation();
                }}>
                <MoreVertical className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' onClick={e => e.stopPropagation()}>
              <DropdownMenuItem
                variant='destructive'
                onClick={() => onDelete?.(device._id)}
              >
                <Trash2 className='h-4 w-4' />
                Delete Device
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Location & Info */}
        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
          <div>
            <span className="text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              Location
            </span>
            <span className="text-foreground">
              Floor {device.location.floor}, {device.location.room_name}
            </span>
          </div>
          {secondaryStat && (
            <div>
              <span className="text-muted-foreground">{secondaryStat.label}</span>
              <span className="text-foreground block">{secondaryStat.value}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          {getStatusBadge(device.status, device.health.battery_level)}
          <span className="text-xs text-muted-foreground">
            {formatUptime(device.health.uptime_percentage)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
