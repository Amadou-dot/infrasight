'use client';

import { useState, useMemo, useEffect } from 'react';
import FloorPlan from '@/components/FloorPlan';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { Select } from '@/components/ui/select';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Map } from 'lucide-react';
import { useMetadata } from '@/lib/query/hooks';

export default function FloorPlanPage() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [selectedBuilding, setSelectedBuilding] = useState<string | 'all'>('all');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

  // Fetch metadata with React Query
  const { data: metadata } = useMetadata();
  const buildings = metadata?.buildings || [];

  // Auto-select first building if available
  useEffect(() => {
    if (buildings.length > 0 && selectedBuilding === 'all') {
      setSelectedBuilding(buildings[0].building);
    }
  }, [buildings, selectedBuilding]);

  // Get floors for the selected building
  const availableFloors = useMemo(() => {
    if (selectedBuilding === 'all') {
      // Combine all floors from all buildings, deduplicated and sorted
      const allFloors = new Set<number>();
      buildings.forEach(b => b.floors.forEach(f => allFloors.add(f.floor)));
      return Array.from(allFloors).sort((a, b) => a - b);
    }
    const building = buildings.find(b => b.building === selectedBuilding);
    return building ? building.floors.map(f => f.floor).sort((a, b) => a - b) : [];
  }, [buildings, selectedBuilding]);

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  return (
    <div className='min-h-screen bg-gray-50 dark:bg-black p-4 md:p-8'>
      <ToastContainer
        position='bottom-center'
        autoClose={false}
        pauseOnFocusLoss
        pauseOnHover
        theme='colored'
      />

      {/* Header */}
      <header className='mb-6 md:mb-8'>
        <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
          <div>
            <div className='flex items-center gap-3 mb-2'>
              <Map className='h-8 w-8 text-green-600 dark:text-green-400' />
              <h1 className='text-2xl md:text-3xl font-bold text-gray-900 dark:text-white'>
                Floor Plan
              </h1>
            </div>
            <p className='text-gray-500 dark:text-gray-400'>
              Spatial view of devices across building floors
            </p>
          </div>

          {/* Building & Floor Selectors */}
          <div className='flex items-center gap-4'>
            {/* Building Selector */}
            <Select
              label='Building'
              value={selectedBuilding as string}
              onValueChange={(val) => {
                setSelectedBuilding(val);
                setSelectedFloor('all');
              }}
              options={[
                { value: 'all', label: 'All Buildings' },
                ...buildings.map(b => ({
                  value: b.building,
                  label: `${b.building} (${b.device_count})`,
                })),
              ]}
            />

            {/* Floor Selector */}
            <Select
              label='Floor'
              value={String(selectedFloor)}
              onValueChange={(val) =>
                setSelectedFloor(val === 'all' ? 'all' : parseInt(val))
              }
              options={[
                { value: 'all', label: 'All Floors' },
                ...availableFloors.map(f => ({
                  value: String(f),
                  label: `Floor ${f}`,
                })),
              ]}
            />
          </div>
        </div>
      </header>

      {/* Floor Plan - Full Width */}
      <div className='grid grid-cols-1 gap-6'>
        <FloorPlan
          selectedFloor={selectedFloor}
          selectedBuilding={selectedBuilding}
          onDeviceDetailClick={handleDeviceClick}
        />
      </div>

      {/* Device Detail Modal */}
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
