'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { v2Api, type HealthMetrics } from '@/lib/api/v2-client';
import type { MaintenanceForecastResponse, DeviceV2Response } from '@/types/v2';
import {
  AlertTriangle,
  WifiOff,
  AlertCircle,
  BatteryLow,
  Wrench,
  Clock,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

interface CriticalDevice {
  id: string;
  name: string;
  room: string;
  floor: number;
  type: string;
  issue:
    | 'offline'
    | 'error'
    | 'low_battery'
    | 'maintenance_overdue'
    | 'maintenance_critical';
  details?: string;
}

interface CriticalDevicesListProps {
  onDeviceClick?: (deviceId: string) => void;
  maxItems?: number;
}

export default function CriticalDevicesList({
  onDeviceClick,
  maxItems = 10,
}: CriticalDevicesListProps) {
  const [devices, setDevices] = useState<CriticalDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCriticalDevices = async (showLoading = false) => {
      try {
        if (showLoading) 
          setLoading(true);
        

        // Fetch health data and maintenance forecast in parallel
        const [healthRes, forecastRes, devicesRes] = await Promise.all([
          v2Api.analytics.health(),
          v2Api.analytics.maintenanceForecast({ days_ahead: 7 }),
          v2Api.devices.list({ limit: 100 }),
        ]);

        const health: HealthMetrics = healthRes.data;
        const forecast: MaintenanceForecastResponse = forecastRes.data;
        const allDevices: DeviceV2Response[] = devicesRes.data || [];

        // Create a map for quick device lookup
        const deviceMap = new Map<string, DeviceV2Response>();
        allDevices.forEach(d => deviceMap.set(d._id.toString(), d));

        const criticalDevices: CriticalDevice[] = [];

        // 1. Offline devices (highest priority)
        if (health.alerts?.offline_devices?.devices) 
          health.alerts.offline_devices.devices.forEach(d => {
            criticalDevices.push({
              id: d._id,
              name: d.serial_number || 'Unknown Device',
              room: d.location?.room_name || 'Unknown',
              floor: d.location?.floor || 0,
              type: 'unknown',
              issue: 'offline',
              details: 'Device offline',
            });
          });
        

        // 2. Error devices
        if (health.alerts?.error_devices?.devices) 
          health.alerts.error_devices.devices.forEach(d => {
            criticalDevices.push({
              id: d._id,
              name: d.serial_number || 'Unknown Device',
              room: d.location?.room_name || 'Unknown',
              floor: 0,
              type: 'unknown',
              issue: 'error',
              details: 'Device error',
            });
          });
        

        // 3. Low battery devices
        if (health.alerts?.low_battery_devices?.devices) 
          health.alerts.low_battery_devices.devices.forEach(d => {
            criticalDevices.push({
              id: d._id,
              name: d.serial_number || 'Unknown Device',
              room: d.location?.room_name || 'Unknown',
              floor: 0,
              type: 'unknown',
              issue: 'low_battery',
              details: d.health?.battery_level
                ? `Battery: ${d.health.battery_level}%`
                : 'Low battery',
            });
          });
        

        // 4. Maintenance overdue (from forecast summary)
        if (forecast.summary?.maintenance_overdue) 
          forecast.summary.maintenance_overdue.forEach(d => {
            criticalDevices.push({
              id: d._id,
              name: d.serial_number || 'Unknown Device',
              room: d.location?.room_name || 'Unknown',
              floor: d.location?.floor || 0,
              type: d.type || 'unknown',
              issue: 'maintenance_overdue',
              details: 'Maintenance overdue',
            });
          });
        

        // 5. Critical maintenance (from forecast critical list)
        forecast.critical?.forEach(d => {
          // Avoid duplicates
          if (!criticalDevices.some(cd => cd.id === d._id)) 
            criticalDevices.push({
              id: d._id,
              name: d.serial_number || 'Unknown Device',
              room: d.location?.room_name || 'Unknown',
              floor: d.location?.floor || 0,
              type: d.type || 'unknown',
              issue: 'maintenance_critical',
              details: 'Critical maintenance',
            });
          
        });

        setDevices(criticalDevices.slice(0, maxItems));
        setError(null);
      } catch (err) {
        console.error('Failed to fetch critical devices:', err);
        setError('Failed to load critical devices');
      } finally {
        if (showLoading) 
          setLoading(false);
        
      }
    };

    // Show loading only on initial fetch
    fetchCriticalDevices(true);
    // Refresh silently in the background
    const interval = setInterval(() => fetchCriticalDevices(false), 30000);
    return () => clearInterval(interval);
  }, [maxItems]);

  const getIssueIcon = (issue: CriticalDevice['issue']) => {
    switch (issue) {
      case 'offline':
        return <WifiOff className='h-4 w-4 text-gray-500' />;
      case 'error':
        return <AlertCircle className='h-4 w-4 text-red-500' />;
      case 'low_battery':
        return <BatteryLow className='h-4 w-4 text-orange-500' />;
      case 'maintenance_overdue':
        return <Clock className='h-4 w-4 text-red-500' />;
      case 'maintenance_critical':
        return <Wrench className='h-4 w-4 text-amber-500' />;
      default:
        return <AlertTriangle className='h-4 w-4 text-yellow-500' />;
    }
  };

  const getIssueBadgeClass = (issue: CriticalDevice['issue']) => {
    switch (issue) {
      case 'offline':
        return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
      case 'error':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
      case 'low_battery':
        return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300';
      case 'maintenance_overdue':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
      case 'maintenance_critical':
        return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
      default:
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300';
    }
  };

  const getIssueLabel = (issue: CriticalDevice['issue']) => {
    switch (issue) {
      case 'offline':
        return 'Offline';
      case 'error':
        return 'Error';
      case 'low_battery':
        return 'Low Battery';
      case 'maintenance_overdue':
        return 'Overdue';
      case 'maintenance_critical':
        return 'Maintenance';
      default:
        return 'Issue';
    }
  };

  if (loading) 
    return (
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-lg'>
            <AlertTriangle className='h-5 w-5 text-red-500' />
            Devices Needing Attention
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-3'>
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className='animate-pulse flex items-center gap-3 p-3 bg-muted rounded-lg'>
                <div className='h-8 w-8 bg-muted-foreground/20 rounded' />
                <div className='flex-1 space-y-2'>
                  <div className='h-4 bg-muted-foreground/20 rounded w-1/3' />
                  <div className='h-3 bg-muted-foreground/20 rounded w-1/2' />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  

  if (error) 
    return (
      <Card className='border-red-200 dark:border-red-900'>
        <CardContent className='py-6'>
          <p className='text-center text-red-500'>{error}</p>
        </CardContent>
      </Card>
    );
  

  if (devices.length === 0) 
    return (
      <Card className='border-green-200 dark:border-green-900'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-lg text-green-600 dark:text-green-400'>
            ✓ All Systems Healthy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground'>
            No devices require immediate attention.
          </p>
        </CardContent>
      </Card>
    );
  

  return (
    <Card className='border-red-200 dark:border-red-900/50 h-full flex flex-col'>
      <CardHeader className='flex flex-row items-center justify-between pb-2'>
        <CardTitle className='flex items-center gap-2 text-lg'>
          <AlertTriangle className='h-5 w-5 text-red-500' />
          Devices Needing Attention
          <span className='ml-2 text-sm font-normal text-muted-foreground'>
            ({devices.length})
          </span>
        </CardTitle>
        <Link
          href='/devices?filter=critical'
          className='text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1'>
          View all <ChevronRight className='h-4 w-4' />
        </Link>
      </CardHeader>
      <CardContent className='flex-1 flex flex-col min-h-0'>
        <div className='space-y-2 overflow-y-auto flex-1'>
          {devices.map(device => (
            <button
              key={`${device.id}-${device.issue}`}
              onClick={() => onDeviceClick?.(device.id)}
              className='w-full flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left'>
              <div className='shrink-0 p-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm'>
                {getIssueIcon(device.issue)}
              </div>
              <div className='flex-1 min-w-0'>
                <p className='font-medium text-sm truncate'>{device.name}</p>
                <p className='text-xs text-muted-foreground truncate'>
                  Floor {device.floor} • {device.room}
                </p>
              </div>
              <div className='flex flex-col items-end gap-1'>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${getIssueBadgeClass(
                    device.issue
                  )}`}>
                  {getIssueLabel(device.issue)}
                </span>
                {device.details && (
                  <span className='text-xs text-muted-foreground'>
                    {device.details}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
