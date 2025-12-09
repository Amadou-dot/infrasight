'use client';

import { useEffect, useState } from 'react';
import FloorPlan from '@/components/FloorPlan';
import AnomalyChart from '@/components/AnomalyChart';
import DeviceGrid from '@/components/DeviceGrid';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { ModeToggle } from '@/components/mode-toggle';
import { Logo } from '@/components/logo';

export default function Home() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [selectedRoom, setSelectedRoom] = useState<string | 'all'>('all');
  const [floors, setFloors] = useState<number[]>([]);

  useEffect(() => {
    fetch('/api/metadata')
      .then(res => res.json())
      .then(data => {
        if (data.floors) setFloors(data.floors);
      });
  }, []);

  // Reset room selection when floor changes
  useEffect(() => {
    setSelectedRoom('all');
  }, [selectedFloor]);

  return (
    <main className='min-h-screen bg-gray-50 dark:bg-black p-4 md:p-8 font-sans'>
      <ToastContainer
        position='bottom-center'
        autoClose={false}
        pauseOnFocusLoss
        pauseOnHover
        theme='colored'
      />

      <header className='mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4'>
        <div>
          <h1 className='text-3xl font-bold text-gray-900 tracking-tight'>
            IoT Building Monitor
          </h1>
          <p className='text-gray-500 mt-1'>
            Real-time sensor data and analytics for Denver HQ
          </p>
        </div>

        <div className='flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200 shadow-sm'>
          <span className='text-sm font-medium text-gray-600 px-2'>Floor:</span>
          <select
            value={selectedFloor}
            onChange={e =>
              setSelectedFloor(
                e.target.value === 'all' ? 'all' : parseInt(e.target.value)
              )
            }
            className='bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block p-2'>
            <option value='all'>All Floors</option>
            {floors.map(f => (
              <option key={f} value={f}>
                Floor {f}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className='grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8'>
        <FloorPlan
          selectedFloor={selectedFloor}
          onDeviceClick={room => setSelectedRoom(room)}
        />
        <AnomalyChart selectedFloor={selectedFloor} />
      </div>

      <div className='w-full'>
        <DeviceGrid
          selectedFloor={selectedFloor}
          selectedRoom={selectedRoom}
          onClearRoomFilter={() => setSelectedRoom('all')}
        />{' '}
      </div>
    </main>
  );
}
