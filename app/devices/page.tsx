'use client';

import { useState, useEffect, useMemo } from 'react';
import { Monitor, Plus, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import Pagination from '@/components/Pagination';
import DeviceInventoryCard from '@/components/DeviceInventoryCard';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { CreateDeviceModal } from '@/components/devices/CreateDeviceModal';
import { toast } from 'react-toastify';
import { useDevicesList } from '@/lib/query/hooks';
import { queryKeys } from '@/lib/query/queryClient';
import { v2Api } from '@/lib/api/v2-client';
import { useRbac } from '@/lib/auth/rbac-client';

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

// ============================================================================
// COMPONENT
// ============================================================================

export default function DevicesPage() {
  const queryClient = useQueryClient();

  // Device selection state
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

  // Create device modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { isAdmin } = useRbac();

  // Fetch all devices with React Query (cached, shared across components)
  const { data: devices = [], isLoading, error: fetchError } = useDevicesList();
  const error = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : 'Failed to load devices'
    : null;

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

    if (filters.type.length > 0) filtered = filtered.filter(d => filters.type.includes(d.type));

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

  // Reset to page 1 when filters change - intentional state reset on filter change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: reset pagination when filters change
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

  const handleDeviceCreated = () => {
    // Invalidate devices cache to refresh the list
    queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
  };

  const handleDeleteRequest = (deviceId: string) => {
    setDeviceToDelete(deviceId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async (e: React.MouseEvent) => {
    // Prevent AlertDialogAction's default close behavior
    e.preventDefault();

    if (!deviceToDelete) return;

    setIsDeleting(true);
    const deletedDeviceId = deviceToDelete;

    try {
      await v2Api.devices.delete(deletedDeviceId);

      // Refresh the list and wait for it to complete
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });

      // Only close dialog after list is refreshed
      setDeleteDialogOpen(false);
      setDeviceToDelete(null);
      toast.success(`Device ${deletedDeviceId} deleted successfully`, { autoClose: 3000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete device';
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setDeviceToDelete(null);
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Monitor className="h-8 w-8 text-primary" />
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">Device Inventory</h1>
            </div>
            <p className="text-muted-foreground">
              Manage connected IoT endpoints across all zones.
            </p>
          </div>
          {isAdmin && (
            <Button
              className='w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white'
              onClick={() => setCreateModalOpen(true)}
            >
              <Plus className='h-4 w-4 mr-2' />
              Add Device
            </Button>
          )}
        </div>
      </header>

      {/* Status Cards */}
      <DeviceStatusCards loading={isLoading} {...statusCounts} />

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
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
          {error}
          <Button
            variant="outline"
            size="sm"
            className="ml-4"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && <DeviceCardSkeleton count={8} />}

      {/* Device Grid */}
      {!isLoading && (
        <>
          {filteredDevices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No devices found matching your filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {paginatedDevices.map(device => (
                <DeviceInventoryCard
                  key={device._id}
                  device={device}
                  onClick={() => handleDeviceClick(device._id)}
                  onDelete={isAdmin ? handleDeleteRequest : undefined}
                  showActions={isAdmin}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Pagination */}
      {!isLoading && filteredDevices.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredDevices.length}
          itemsPerPage={DEVICES_PER_PAGE}
          onPageChange={setCurrentPage}
          className="mt-6"
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

      {/* Create Device Modal */}
      {isAdmin && (
        <CreateDeviceModal
          isOpen={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onSuccess={handleDeviceCreated}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {isAdmin && (
        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            // Prevent closing while deletion is in progress
            if (!isDeleting) {
              setDeleteDialogOpen(open);
              if (!open) setDeviceToDelete(null);
            }
          }}
        >
          <AlertDialogContent onEscapeKeyDown={(e) => isDeleting && e.preventDefault()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Device</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete device <span className='font-semibold'>{deviceToDelete}</span>?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleDeleteCancel} disabled={isDeleting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className='bg-destructive text-white hover:bg-destructive/90'
              >
                {isDeleting ? (
                  <>
                    <Loader2 className='h-4 w-4 animate-spin' />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
