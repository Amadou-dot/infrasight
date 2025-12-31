'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Wifi,
  Router,
  Thermometer,
  MoreVertical,
} from 'lucide-react';
import type { DeviceV2Response } from '@/types/v2';

// Type definitions
type MaintenanceStatus = 'critical' | 'warning' | 'scheduled' | 'healthy';
type FilterLocation = 'all' | string;
type FilterStatus = 'all' | MaintenanceStatus;

interface MaintenanceTableProps {
  devices: DeviceV2Response[];
  onDeviceClick?: (deviceId: string) => void;
  loading?: boolean;
}

// Helper functions
function getDeviceIcon(type: string) {
  switch (type.toLowerCase()) {
    case 'sensor':
      return <Wifi className='h-4 w-4' />;
    case 'gateway':
      return <Router className='h-4 w-4' />;
    case 'hvac':
      return <Thermometer className='h-4 w-4' />;
    default:
      return <Wifi className='h-4 w-4' />;
  }
}

function getMaintenanceStatus(device: DeviceV2Response): MaintenanceStatus {
  if (!device.metadata.next_maintenance) return 'healthy';

  const nextMaintenance = new Date(device.metadata.next_maintenance);
  const today = new Date();
  const daysUntil = Math.ceil(
    (nextMaintenance.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntil < 0) return 'critical';
  if (daysUntil <= 7) return 'warning';
  if (daysUntil <= 30) return 'scheduled';
  return 'healthy';
}

function getStatusBadge(status: MaintenanceStatus) {
  switch (status) {
    case 'critical':
      return <Badge className='bg-red-500 text-white text-xs'>Critical</Badge>;
    case 'warning':
      return <Badge className='bg-amber-500 text-white text-xs'>Warning</Badge>;
    case 'scheduled':
      return (
        <Badge variant='secondary' className='text-xs'>
          Scheduled
        </Badge>
      );
    case 'healthy':
      return (
        <Badge className='bg-emerald-500 text-white text-xs'>Healthy</Badge>
      );
  }
}

function formatDate(dateInput?: Date | string): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isToday(dateInput?: Date | string): boolean {
  if (!dateInput) return false;
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

export default function MaintenanceTable({
  devices,
  onDeviceClick,
  loading = false,
}: MaintenanceTableProps) {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [locationFilter, setLocationFilter] = useState<FilterLocation>('all');
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Get unique locations
  const locations = useMemo(() => {
    const uniqueLocations = new Set(devices.map(d => d.location.room_name));
    return Array.from(uniqueLocations).sort();
  }, [devices]);

  // Combined filtered and paginated devices
  const { filteredDevices, paginatedDevices, totalPages } = useMemo(() => {
    let filtered = devices;

    if (statusFilter !== 'all') {
      filtered = filtered.filter(d => getMaintenanceStatus(d) === statusFilter);
    }

    if (locationFilter !== 'all') {
      filtered = filtered.filter(d => d.location.room_name === locationFilter);
    }

    const total = Math.ceil(filtered.length / pageSize);
    const paginated = filtered.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize
    );

    return {
      filteredDevices: filtered,
      paginatedDevices: paginated,
      totalPages: total,
    };
  }, [devices, statusFilter, locationFilter, currentPage]);

  if (loading) {
    return (
      <Card className='bg-card border-border'>
        <CardContent className='p-6'>
          <div className='animate-pulse space-y-4'>
            <div className='flex gap-4'>
              <div className='h-10 w-32 bg-muted rounded' />
              <div className='h-10 w-32 bg-muted rounded' />
              <div className='h-10 w-32 bg-muted rounded' />
            </div>
            <div className='space-y-2 mt-6'>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className='h-12 bg-muted rounded' />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className='bg-card border-border'>
      <CardContent className='p-6'>
        {/* Filters */}
        <div className='flex flex-wrap items-center gap-3 mb-6'>
          {/* Status Filter */}
          <div className='relative'>
            <Button
              variant='outline'
              size='sm'
              className='flex items-center gap-2'
              onClick={() => {
                setShowStatusDropdown(!showStatusDropdown);
                setShowLocationDropdown(false);
              }}>
              {statusFilter === 'all' ? 'All Statuses' : statusFilter}
              <ChevronDown className='h-4 w-4' />
            </Button>
            {showStatusDropdown && (
              <div className='absolute top-full left-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-10 min-w-[140px]'>
                {(
                  [
                    'all',
                    'critical',
                    'warning',
                    'scheduled',
                    'healthy',
                  ] as FilterStatus[]
                ).map(status => (
                  <button
                    key={status}
                    className='w-full px-3 py-2 text-sm text-left hover:bg-muted capitalize'
                    onClick={() => {
                      setStatusFilter(status);
                      setShowStatusDropdown(false);
                      setCurrentPage(1);
                    }}>
                    {status === 'all' ? 'All Statuses' : status}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Location Filter */}
          <div className='relative'>
            <Button
              variant='outline'
              size='sm'
              className='flex items-center gap-2'
              onClick={() => {
                setShowLocationDropdown(!showLocationDropdown);
                setShowStatusDropdown(false);
              }}>
              {locationFilter === 'all' ? 'All Locations' : locationFilter}
              <ChevronDown className='h-4 w-4' />
            </Button>
            {showLocationDropdown && (
              <div className='absolute top-full left-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-10 min-w-[160px] max-h-[200px] overflow-auto'>
                <button
                  className='w-full px-3 py-2 text-sm text-left hover:bg-muted'
                  onClick={() => {
                    setLocationFilter('all');
                    setShowLocationDropdown(false);
                    setCurrentPage(1);
                  }}>
                  All Locations
                </button>
                {locations.map(location => (
                  <button
                    key={location}
                    className='w-full px-3 py-2 text-sm text-left hover:bg-muted'
                    onClick={() => {
                      setLocationFilter(location);
                      setShowLocationDropdown(false);
                      setCurrentPage(1);
                    }}>
                    {location}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date Range (placeholder) */}
          <Button
            variant='outline'
            size='sm'
            className='flex items-center gap-2'>
            <Calendar className='h-4 w-4' />
            Date Range
          </Button>

          {/* Results count */}
          <div className='ml-auto text-sm text-muted-foreground'>
            Showing {(currentPage - 1) * pageSize + 1}-
            {Math.min(currentPage * pageSize, filteredDevices.length)} of{' '}
            {filteredDevices.length}
            <Button
              variant='ghost'
              size='sm'
              className='ml-2'
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => p - 1)}>
              <ChevronLeft className='h-4 w-4' />
            </Button>
            <Button
              variant='ghost'
              size='sm'
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(p => p + 1)}>
              <ChevronRight className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-border text-muted-foreground'>
                <th className='text-left py-3 px-2 font-medium'>
                  <input type='checkbox' className='rounded border-border' />
                </th>
                <th className='text-left py-3 px-2 font-medium'>
                  DEVICE DETAILS
                </th>
                <th className='text-left py-3 px-2 font-medium'>LOCATION</th>
                <th className='text-left py-3 px-2 font-medium'>
                  MAINTENANCE TASK
                </th>
                <th className='text-left py-3 px-2 font-medium'>
                  LAST SERVICE
                </th>
                <th className='text-left py-3 px-2 font-medium'>DUE DATE</th>
                <th className='text-left py-3 px-2 font-medium'>STATUS</th>
                <th className='text-left py-3 px-2 font-medium'>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {paginatedDevices.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className='text-center py-8 text-muted-foreground'>
                    No devices found matching filters
                  </td>
                </tr>
              ) : (
                paginatedDevices.map(device => {
                  const status = getMaintenanceStatus(device);
                  const dueDate = device.metadata.next_maintenance;
                  const isTodayDue = isToday(dueDate);

                  return (
                    <tr
                      key={device._id}
                      className='border-b border-border hover:bg-muted/50 transition-colors'>
                      <td className='py-3 px-2'>
                        <input
                          type='checkbox'
                          className='rounded border-border'
                        />
                      </td>
                      <td className='py-3 px-2'>
                        <div className='flex items-center gap-3'>
                          <div className='p-2 rounded-lg bg-muted'>
                            {getDeviceIcon(device.type)}
                          </div>
                          <div>
                            <div className='font-medium'>{device._id}</div>
                            <div className='text-xs text-muted-foreground'>
                              ID: {device._id.slice(0, 8)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className='py-3 px-2 text-muted-foreground'>
                        {device.location.room_name}
                      </td>
                      <td className='py-3 px-2 text-muted-foreground'>
                        {device.device_model || 'Routine Check'}
                      </td>
                      <td className='py-3 px-2 text-muted-foreground'>
                        {formatDate(device.metadata.last_maintenance)}
                      </td>
                      <td className='py-3 px-2'>
                        <span
                          className={
                            isTodayDue
                              ? 'text-red-500 font-medium'
                              : 'text-muted-foreground'
                          }>
                          {isTodayDue ? 'Today' : formatDate(dueDate)}
                        </span>
                      </td>
                      <td className='py-3 px-2'>{getStatusBadge(status)}</td>
                      <td className='py-3 px-2'>
                        <div className='flex items-center gap-2'>
                          {status === 'critical' && (
                            <Button
                              variant='ghost'
                              size='sm'
                              className='text-blue-500 hover:text-blue-600'
                              onClick={() => onDeviceClick?.(device._id)}>
                              Review
                            </Button>
                          )}
                          <Button variant='ghost' size='sm'>
                            <MoreVertical className='h-4 w-4' />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
