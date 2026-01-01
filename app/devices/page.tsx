'use client';

import { useState, useEffect, useMemo } from 'react';
import { Monitor, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Pagination from '@/components/Pagination';
import DeviceInventoryCard from '@/components/DeviceInventoryCard';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { v2Api } from '@/lib/api/v2-client';
import type { DeviceV2Response } from '@/types/v2';

import {
  DeviceStatusCards,
  DeviceCardSkeleton,
  DeviceSearchBar,
  DeviceFilterModal,
  INITIAL_FILTERS,
  type DeviceFilters,
} from './_components';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEVICES_PER_PAGE = 16;
/** Maximum pages to fetch when loading all devices (100 per page = 2000 max devices) */
const MAX_PAGINATION_PAGES = 20;

// ============================================================================
// COMPONENT
// ============================================================================

export default function DevicesPage() {
  // Device selection state
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  
  // Data state
  const [devices, setDevices] = useState<DeviceV2Response[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Search and floor filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  
  // Filter modal state
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filters, setFilters] = useState<DeviceFilters>(INITIAL_FILTERS);
  const [pendingFilters, setPendingFilters] = useState<DeviceFilters>(INITIAL_FILTERS);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  useEffect(() => {
    const fetchAllDevices = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch all devices by paginating through all pages
        const allDevices: DeviceV2Response[] = [];
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
          const response = await v2Api.devices.list({ limit: 100, page });
          allDevices.push(...response.data);
          
          // Check if there are more pages
          hasMore = response.pagination?.hasNext ?? false;
          page++;
          
          // Safety limit to prevent infinite loops (max 2000 devices)
          if (page > MAX_PAGINATION_PAGES) break;
        }
        
        setDevices(allDevices);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load devices');
        console.error('Devices fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllDevices();
  }, []);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

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

    if (selectedFloor !== 'all') 
      filtered = filtered.filter(d => d.location.floor === selectedFloor);
    

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
    if (filters.status.length > 0) 
      filtered = filtered.filter(d => filters.status.includes(d.status));
    
    if (filters.type.length > 0) 
      filtered = filtered.filter(d => filters.type.includes(d.type));
    
    if (filters.manufacturer.length > 0) 
      filtered = filtered.filter(d => filters.manufacturer.includes(d.manufacturer));
    
    if (filters.department.length > 0) 
      filtered = filtered.filter(d => filters.department.includes(d.metadata?.department || ''));
    

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
  const statusCounts = useMemo(() => {
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

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

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

  const toggleFilterValue = (category: keyof DeviceFilters, value: string) => {
    setPendingFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value],
    }));
  };

  // ============================================================================
  // RENDER
  // ============================================================================

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
      <DeviceStatusCards loading={loading} {...statusCounts} />

      {/* Search & Filters */}
      <DeviceSearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedFloor={selectedFloor}
        onFloorChange={setSelectedFloor}
        floors={floors}
        activeFilterCount={activeFilterCount}
        onOpenFilterModal={openFilterModal}
      />

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
      {loading && <DeviceCardSkeleton count={8} />}

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
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredDevices.length}
          itemsPerPage={DEVICES_PER_PAGE}
          onPageChange={setCurrentPage}
          className='mt-6'
        />
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
      <DeviceFilterModal
        isOpen={filterModalOpen}
        onOpenChange={setFilterModalOpen}
        pendingFilters={pendingFilters}
        filterOptions={filterOptions}
        onToggleFilterValue={toggleFilterValue}
        onClearAll={clearAllFilters}
        onApply={applyFilters}
      />
    </div>
  );
}
