'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Monitor,
  Plus,
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import DeviceInventoryCard from '@/components/DeviceInventoryCard';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { v2Api } from '@/lib/api/v2-client';
import type { DeviceV2Response } from '@/types/v2';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEVICES_PER_PAGE = 16;

const DEVICE_STATUSES = [
  'active',
  'maintenance',
  'offline',
  'decommissioned',
  'error',
] as const;

const DEVICE_TYPES = [
  'temperature',
  'humidity',
  'occupancy',
  'power',
  'co2',
  'pressure',
  'light',
  'motion',
  'air_quality',
  'water_flow',
  'gas',
  'vibration',
  'voltage',
  'current',
  'energy',
] as const;

// ============================================================================
// FILTER TYPES
// ============================================================================

interface DeviceFilters {
  status: string[];
  type: string[];
  manufacturer: string[];
  department: string[];
}

const INITIAL_FILTERS: DeviceFilters = {
  status: [],
  type: [],
  manufacturer: [],
  department: [],
};

export default function DevicesPage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceV2Response[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  
  // Filter modal state
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filters, setFilters] = useState<DeviceFilters>(INITIAL_FILTERS);
  const [pendingFilters, setPendingFilters] = useState<DeviceFilters>(INITIAL_FILTERS);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch devices
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await v2Api.devices.list({ limit: 100 });
        setDevices(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load devices');
        console.error('Devices fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
  }, []);

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  // Get unique floors for filter
  const floors = useMemo(() => {
    const uniqueFloors = new Set(devices.map(d => d.location.floor));
    return Array.from(uniqueFloors).sort((a, b) => a - b);
  }, [devices]);

  // Get unique manufacturers and departments for filter options
  const filterOptions = useMemo(() => {
    const manufacturers = new Set<string>();
    const departments = new Set<string>();
    
    devices.forEach(d => {
      if (d.manufacturer) manufacturers.add(d.manufacturer);
      if (d.metadata?.department) departments.add(d.metadata.department);
    });
    
    return {
      manufacturers: Array.from(manufacturers).sort(),
      departments: Array.from(departments).sort(),
    };
  }, [devices]);

  // Filter devices based on search, floor, and advanced filters
  const filteredDevices = useMemo(() => {
    let filtered = devices;

    if (selectedFloor !== 'all') {
      filtered = filtered.filter(d => d.location.floor === selectedFloor);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        d =>
          d._id.toLowerCase().includes(query) ||
          d.location.room_name.toLowerCase().includes(query) ||
          d.type.toLowerCase().includes(query)
      );
    }

    // Apply advanced filters
    if (filters.status.length > 0) {
      filtered = filtered.filter(d => filters.status.includes(d.status));
    }
    if (filters.type.length > 0) {
      filtered = filtered.filter(d => filters.type.includes(d.type));
    }
    if (filters.manufacturer.length > 0) {
      filtered = filtered.filter(d => filters.manufacturer.includes(d.manufacturer));
    }
    if (filters.department.length > 0) {
      filtered = filtered.filter(d => filters.department.includes(d.metadata?.department || ''));
    }

    return filtered;
  }, [devices, selectedFloor, searchQuery, filters]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredDevices.length / DEVICES_PER_PAGE);
  const paginatedDevices = useMemo(() => {
    const startIndex = (currentPage - 1) * DEVICES_PER_PAGE;
    return filteredDevices.slice(startIndex, startIndex + DEVICES_PER_PAGE);
  }, [filteredDevices, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedFloor, searchQuery, filters]);

  // Calculate status counts
  const {
    totalCount,
    onlineCount,
    attentionCount,
    offlineCount,
    lowBatteryCount,
  } = useMemo(() => {
    const online = devices.filter(d => d.status === 'active').length;
    const offline = devices.filter(d => d.status === 'offline').length;
    const lowBattery = devices.filter(
      d => d.health.battery_level !== undefined && d.health.battery_level < 20
    ).length;
    const attention = offline + lowBattery;

    return {
      totalCount: devices.length,
      onlineCount: online,
      attentionCount: attention,
      offlineCount: offline,
      lowBatteryCount: lowBattery,
    };
  }, [devices]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    return (
      filters.status.length +
      filters.type.length +
      filters.manufacturer.length +
      filters.department.length
    );
  }, [filters]);

  // Filter modal handlers
  const openFilterModal = () => {
    setPendingFilters(filters);
    setFilterModalOpen(true);
  };

  const applyFilters = () => {
    setFilters(pendingFilters);
    setFilterModalOpen(false);
  };

  const clearAllFilters = () => {
    setPendingFilters(INITIAL_FILTERS);
  };

  const toggleFilterValue = (
    category: keyof DeviceFilters,
    value: string
  ) => {
    setPendingFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value],
    }));
  };

  return (
    <div className='min-h-screen bg-background p-4 md:p-6 lg:p-8'>
      <ToastContainer
        position='bottom-center'
        autoClose={false}
        pauseOnFocusLoss
        pauseOnHover
        theme='colored'
      />

      {/* Header */}
      <header className='mb-6'>
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
          <div>
            <div className='flex items-center gap-3 mb-2'>
              <Monitor className='h-8 w-8 text-primary' />
              <h1 className='text-2xl md:text-3xl font-bold text-foreground'>
                Device Inventory
              </h1>
            </div>
            <p className='text-muted-foreground'>
              Manage connected IoT endpoints across all zones.
            </p>
          </div>
          <Button className='w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white'>
            <Plus className='h-4 w-4 mr-2' />
            Add Device
          </Button>
        </div>
      </header>

      {/* Status Cards */}
      <section className='mb-6'>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
          {/* Total Devices */}
          <Card className='bg-card border-border'>
            <CardContent className='p-6'>
              <div className='flex items-center justify-between mb-2'>
                <span className='text-sm text-muted-foreground'>
                  Total Devices
                </span>
                <Monitor className='h-5 w-5 text-muted-foreground' />
              </div>
              <div className='text-4xl font-bold text-foreground mb-1'>
                {loading ? '—' : totalCount}
              </div>
              <span className='text-xs text-emerald-500'>
                ↗ +4 new this week
              </span>
            </CardContent>
          </Card>

          {/* Online Status */}
          <Card className='bg-card border-border'>
            <CardContent className='p-6'>
              <div className='flex items-center justify-between mb-2'>
                <span className='text-sm text-muted-foreground'>
                  Online Status
                </span>
                <div className='h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center'>
                  <div className='h-2 w-2 rounded-full bg-emerald-500' />
                </div>
              </div>
              <div className='text-4xl font-bold text-foreground mb-1'>
                {loading ? '—' : onlineCount}
                <span className='text-lg text-muted-foreground font-normal ml-1'>
                  / {totalCount}
                </span>
              </div>
              <div className='w-full bg-muted rounded-full h-2'>
                <div
                  className='bg-emerald-500 h-2 rounded-full transition-all'
                  style={{
                    width: totalCount
                      ? `${(onlineCount / totalCount) * 100}%`
                      : '0%',
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Attention Needed */}
          <Card className='bg-card border-border'>
            <CardContent className='p-6'>
              <div className='flex items-center justify-between mb-2'>
                <span className='text-sm text-muted-foreground'>
                  Attention Needed
                </span>
                <div className='h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center'>
                  <span className='text-amber-500 text-xs'>⚠</span>
                </div>
              </div>
              <div className='text-4xl font-bold text-foreground mb-1'>
                {loading ? '—' : attentionCount}
              </div>
              <span className='text-xs text-muted-foreground'>
                {offlineCount} Offline, {lowBatteryCount} Low Battery
              </span>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Search & Filters */}
      <section className='mb-6'>
        <div className='flex flex-col lg:flex-row gap-4'>
          {/* Search Input */}
          <div className='relative flex-1'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <input
              type='text'
              placeholder='Search by Name, IP, or MAC Address'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='w-full pl-10 pr-4 py-2 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'
            />
          </div>

          {/* Floor Filters */}
          <div className='flex items-center gap-2 flex-wrap'>
            <Button
              variant={selectedFloor === 'all' ? 'default' : 'outline'}
              size='sm'
              onClick={() => setSelectedFloor('all')}>
              All Floors
            </Button>
            {floors.map(floor => (
              <Button
                key={floor}
                variant={selectedFloor === floor ? 'default' : 'outline'}
                size='sm'
                onClick={() => setSelectedFloor(floor)}>
                Floor {floor}
              </Button>
            ))}
          </div>

          {/* View Mode & Filter Button */}
          <div className='flex items-center gap-2'>
            <Button 
              variant='outline' 
              size='sm'
              onClick={openFilterModal}
              className={activeFilterCount > 0 ? 'border-primary' : ''}
            >
              <SlidersHorizontal className='h-4 w-4 mr-2' />
              Filter
              {activeFilterCount > 0 && (
                <Badge variant='secondary' className='ml-2 h-5 w-5 p-0 flex items-center justify-center text-xs'>
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </div>
        </div>
      </section>

      {/* Error State */}
      {error && (
        <div className='mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm'>
          {error}
          <Button
            variant='outline'
            size='sm'
            className='ml-4'
            onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'>
          {[...Array(8)].map((_, i) => (
            <Card key={i} className='bg-card border-border'>
              <CardContent className='p-4'>
                <div className='animate-pulse'>
                  <div className='flex items-center gap-3 mb-3'>
                    <div className='h-10 w-10 bg-muted rounded-lg' />
                    <div className='flex-1'>
                      <div className='h-4 w-24 bg-muted rounded mb-1' />
                      <div className='h-3 w-16 bg-muted rounded' />
                    </div>
                  </div>
                  <div className='h-3 w-full bg-muted rounded mb-2' />
                  <div className='h-3 w-2/3 bg-muted rounded' />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Device Grid */}
      {!loading && (
        <>
          {filteredDevices.length === 0 ? (
            <div className='text-center py-12 text-muted-foreground'>
              No devices found matching your filters.
            </div>
          ) : (
            <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'>
              {paginatedDevices.map(device => (
                <DeviceInventoryCard
                  key={device._id}
                  device={device}
                  onClick={() => handleDeviceClick(device._id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Pagination */}
      {!loading && filteredDevices.length > 0 && (
        <div className='mt-6 flex flex-col sm:flex-row items-center justify-between gap-4'>
          <div className='text-sm text-muted-foreground'>
            Showing {((currentPage - 1) * DEVICES_PER_PAGE) + 1}–{Math.min(currentPage * DEVICES_PER_PAGE, filteredDevices.length)} of {filteredDevices.length} devices
          </div>
          
          {totalPages > 1 && (
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className='h-4 w-4' />
                Previous
              </Button>
              
              <div className='flex items-center gap-1'>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                  // Show first, last, current, and adjacent pages
                  const showPage = 
                    page === 1 || 
                    page === totalPages || 
                    Math.abs(page - currentPage) <= 1;
                  
                  const showEllipsisBefore = page === currentPage - 2 && currentPage > 3;
                  const showEllipsisAfter = page === currentPage + 2 && currentPage < totalPages - 2;
                  
                  if (showEllipsisBefore || showEllipsisAfter) {
                    return (
                      <span key={page} className='px-2 text-muted-foreground'>
                        ...
                      </span>
                    );
                  }
                  
                  if (!showPage) return null;
                  
                  return (
                    <Button
                      key={page}
                      variant={currentPage === page ? 'default' : 'outline'}
                      size='sm'
                      className='w-8 h-8 p-0'
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </Button>
                  );
                })}
              </div>
              
              <Button
                variant='outline'
                size='sm'
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Device Detail Modal */}
      <DeviceDetailModal
        deviceId={selectedDeviceId}
        isOpen={deviceModalOpen}
        onClose={() => {
          setDeviceModalOpen(false);
          setSelectedDeviceId(null);
        }}
      />

      {/* Filter Modal */}
      <Dialog open={filterModalOpen} onOpenChange={setFilterModalOpen}>
        <DialogContent className='sm:max-w-lg max-h-[80vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <SlidersHorizontal className='h-5 w-5' />
              Filter Devices
            </DialogTitle>
          </DialogHeader>

          <div className='space-y-6 py-4'>
            {/* Status Filter */}
            <div>
              <h4 className='text-sm font-medium mb-3'>Status</h4>
              <div className='flex flex-wrap gap-2'>
                {DEVICE_STATUSES.map(status => (
                  <Button
                    key={status}
                    variant={pendingFilters.status.includes(status) ? 'default' : 'outline'}
                    size='sm'
                    onClick={() => toggleFilterValue('status', status)}
                    className='capitalize'
                  >
                    {status}
                    {pendingFilters.status.includes(status) && (
                      <X className='h-3 w-3 ml-1' />
                    )}
                  </Button>
                ))}
              </div>
            </div>

            {/* Device Type Filter */}
            <div>
              <h4 className='text-sm font-medium mb-3'>Device Type</h4>
              <div className='flex flex-wrap gap-2'>
                {DEVICE_TYPES.map(type => (
                  <Button
                    key={type}
                    variant={pendingFilters.type.includes(type) ? 'default' : 'outline'}
                    size='sm'
                    onClick={() => toggleFilterValue('type', type)}
                    className='capitalize'
                  >
                    {type.replace('_', ' ')}
                    {pendingFilters.type.includes(type) && (
                      <X className='h-3 w-3 ml-1' />
                    )}
                  </Button>
                ))}
              </div>
            </div>

            {/* Manufacturer Filter */}
            {filterOptions.manufacturers.length > 0 && (
              <div>
                <h4 className='text-sm font-medium mb-3'>Manufacturer</h4>
                <div className='flex flex-wrap gap-2'>
                  {filterOptions.manufacturers.map(manufacturer => (
                    <Button
                      key={manufacturer}
                      variant={pendingFilters.manufacturer.includes(manufacturer) ? 'default' : 'outline'}
                      size='sm'
                      onClick={() => toggleFilterValue('manufacturer', manufacturer)}
                    >
                      {manufacturer}
                      {pendingFilters.manufacturer.includes(manufacturer) && (
                        <X className='h-3 w-3 ml-1' />
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Department Filter */}
            {filterOptions.departments.length > 0 && (
              <div>
                <h4 className='text-sm font-medium mb-3'>Department</h4>
                <div className='flex flex-wrap gap-2'>
                  {filterOptions.departments.map(department => (
                    <Button
                      key={department}
                      variant={pendingFilters.department.includes(department) ? 'default' : 'outline'}
                      size='sm'
                      onClick={() => toggleFilterValue('department', department)}
                      className='capitalize'
                    >
                      {department}
                      {pendingFilters.department.includes(department) && (
                        <X className='h-3 w-3 ml-1' />
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className='flex-row gap-2'>
            <Button
              variant='ghost'
              onClick={clearAllFilters}
              className='mr-auto'
            >
              Clear All
            </Button>
            <Button variant='outline' onClick={() => setFilterModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyFilters}>
              Apply Filters
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
