'use client';

import { useState, useEffect } from 'react';
import FloorPlan from '@/components/FloorPlan';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Map } from 'lucide-react';
import { v2Api } from '@/lib/api/v2-client';

export default function FloorPlanPage() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [floors, setFloors] = useState<number[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

  // Fetch available floors
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await v2Api.metadata.get();
        if (response.success && response.data.floors) 
          setFloors(response.data.floors);
        
      } catch (error) {
        console.error('Error fetching metadata:', error);
      }
    };
    fetchMetadata();
  }, []);

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

          {/* Floor Selector */}
          <div className='flex items-center gap-2 bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm'>
            <span className='text-sm font-medium text-gray-600 dark:text-gray-300 px-2'>
              Floor:
            </span>
            <select
              value={selectedFloor}
              onChange={e =>
                setSelectedFloor(
                  e.target.value === 'all' ? 'all' : parseInt(e.target.value)
                )
              }
              className='bg-transparent border-none text-gray-900 dark:text-white text-sm focus:ring-0 cursor-pointer outline-none'>
              <option value='all'>All Floors</option>
              {floors.map(f => (
                <option key={f} value={f}>
                  Floor {f}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Floor Plan - Full Width */}
      <div className='grid grid-cols-1 gap-6'>
        <FloorPlan
          selectedFloor={selectedFloor}
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
