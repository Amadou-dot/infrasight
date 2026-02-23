'use client';

import { useMemo, useState } from 'react';
import { ArchiveX, ShieldAlert } from 'lucide-react';
import { toast } from 'react-toastify';
import { useQueryClient } from '@tanstack/react-query';
import { useDevicesList } from '@/lib/query/hooks';
import { queryKeys } from '@/lib/query/queryClient';
import { useRbac } from '@/lib/auth/rbac-client';
import DeviceInventoryCard from '@/components/DeviceInventoryCard';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import DeviceSearchBar from '../_components/DeviceSearchBar';
import Pagination from '@/components/Pagination';
import { Button } from '@/components/ui/button';
import { v2Api } from '@/lib/api/v2-client';

const DEVICES_PER_PAGE = 16;

export default function DeletedDevicesPage() {
  const { isAdmin, isLoaded } = useRbac();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: devices = [], isLoading, error: fetchError } = useDevicesList(
    { only_deleted: true } as { only_deleted: true }
  );

  const error = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : 'Failed to load deleted devices'
    : null;

  const floors = useMemo(() => {
    const uniqueFloors = new Set(devices.map(d => d.location.floor));
    return Array.from(uniqueFloors).sort((a, b) => a - b);
  }, [devices]);

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

    return filtered;
  }, [devices, selectedFloor, searchQuery]);

  const totalPages = Math.ceil(filteredDevices.length / DEVICES_PER_PAGE);
  const paginatedDevices = useMemo(() => {
    const startIndex = (currentPage - 1) * DEVICES_PER_PAGE;
    return filteredDevices.slice(startIndex, startIndex + DEVICES_PER_PAGE);
  }, [filteredDevices, currentPage]);

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  const handleRestoreDevice = async (deviceId: string) => {
    setRestoringId(deviceId);
    try {
      await v2Api.devices.restore(deviceId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
      toast.success(`Device ${deviceId} restored`, { autoClose: 3000 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restore device';
      toast.error(message);
    } finally {
      setRestoringId(null);
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  };

  const handleFloorChange = (floor: number | 'all') => {
    setSelectedFloor(floor);
    setCurrentPage(1);
  };

  if (!isLoaded)
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );

  if (!isAdmin)
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="max-w-md text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Admin access required</h1>
          <p className="text-sm text-muted-foreground">
            This page is restricted to administrators.
          </p>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <ArchiveX className="h-8 w-8 text-destructive" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Deleted Devices</h1>
        </div>
        <p className="text-muted-foreground">
          View devices that were soft deleted from the system.
        </p>
      </header>

      <DeviceSearchBar
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        selectedFloor={selectedFloor}
        onFloorChange={handleFloorChange}
        floors={floors}
        activeFilterCount={0}
        onOpenFilterModal={() => undefined}
      />

      {error && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={`deleted-device-skeleton-${index}`}
              className="h-44 rounded-lg border border-border bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      )}

      {!isLoading && (
        <>
          {filteredDevices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No deleted devices match your filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {paginatedDevices.map(device => (
                <div key={device._id} className="space-y-2">
                  <DeviceInventoryCard
                    device={device}
                    onClick={() => handleDeviceClick(device._id)}
                    showActions={false}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={event => {
                      event.stopPropagation();
                      void handleRestoreDevice(device._id);
                    }}
                    disabled={restoringId === device._id}
                  >
                    {restoringId === device._id ? 'Restoring...' : 'Restore Device'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!isLoading && filteredDevices.length > 0 && totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredDevices.length}
          itemsPerPage={DEVICES_PER_PAGE}
          onPageChange={setCurrentPage}
          className="mt-6"
        />
      )}

      <DeviceDetailModal
        deviceId={selectedDeviceId}
        isOpen={deviceModalOpen}
        onClose={() => {
          setDeviceModalOpen(false);
          setSelectedDeviceId(null);
        }}
      />
    </div>
  );
}
