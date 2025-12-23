'use client';

import { useEffect, useState } from 'react';
import FloorPlan from '@/components/FloorPlan';
import AnomalyChart from '@/components/AnomalyChart';
import DeviceGrid from '@/components/DeviceGrid';
import DeviceHealthWidget from '@/components/DeviceHealthWidget';
import AlertsPanel from '@/components/AlertsPanel';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { ModeToggle } from '@/components/mode-toggle';
import { Logo } from '@/components/logo';
import { v2Api } from '@/lib/api/v2-client';
import { Activity } from 'lucide-react';

export default function Home() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [selectedRoom, setSelectedRoom] = useState<string | 'all'>('all');
  const [floors, setFloors] = useState<number[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [deviceFilter, setDeviceFilter] = useState<{ status?: string; hasIssues?: boolean } | null>(null);

  // Fetch metadata from v2 API
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await v2Api.metadata.get();
        if (response.success && response.data.floors) {
          setFloors(response.data.floors);
        }
      } catch (error) {
        console.error('Error fetching metadata:', error);
        // Fallback to v1 API if v2 is not available
        fetch('/api/metadata')
          .then(res => res.json())
          .then(data => {
            if (data.floors) setFloors(data.floors);
          });
      }
    };

    fetchMetadata();
  }, []);

  // Fetch health score for header
  useEffect(() => {
    const fetchHealthScore = async () => {
      try {
        const response = await v2Api.analytics.health();
        if (response.success) {
          setHealthScore(response.data.summary?.health_score ?? null);
          console.log(response.data);
        }
      } catch (error) {
        console.error('Error fetching health score:', error);
      }
    };

    fetchHealthScore();
    // Refresh every 30 seconds
    const interval = setInterval(fetchHealthScore, 30000);
    return () => clearInterval(interval);
  }, []);

  // Reset room selection when floor changes
  useEffect(() => {
    setSelectedRoom('all');
  }, [selectedFloor]);

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  const handleFilterDevices = (filter: { status?: string; hasIssues?: boolean }) => {
    setDeviceFilter(filter);
  };

  const healthScoreColor =
    healthScore === null
      ? 'text-gray-600 dark:text-gray-400'
      : healthScore >= 90
      ? 'text-green-600 dark:text-green-400'
      : healthScore >= 70
      ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-red-600 dark:text-red-400';

  return (
    <main className='min-h-screen bg-gray-50 dark:bg-black p-4 md:p-8 font-sans'>
      <ToastContainer
        position='bottom-center'
        autoClose={false}
        pauseOnFocusLoss
        pauseOnHover
        theme='colored'
      />

      <header className='mb-8'>
        <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
          <div>
            <div className='flex items-center gap-3'>
              <Logo className='h-10 w-10 text-blue-600 dark:text-blue-400' />
              <h1 className='text-3xl font-bold text-gray-900 dark:text-white tracking-tight'>
                Infrasight
              </h1>
            </div>
            <p className='text-gray-500 dark:text-gray-400 mt-1'>
              Real-time sensor data and analytics for Denver HQ
            </p>
          </div>

          <div className='flex items-center gap-2'>
            {healthScore !== null && (
              <div className='flex items-center gap-2 bg-white dark:bg-gray-800 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm'>
                <Activity className={`h-5 w-5 ${healthScoreColor}`} />
                <div className='flex flex-col'>
                  <span className='text-xs text-gray-500 dark:text-gray-400'>System Health</span>
                  <span className={`text-sm font-bold ${healthScoreColor}`}>
                    {healthScore.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
            <ModeToggle />
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
        </div>
      </header>

      {/* Health Widget and Alerts Panel Row */}
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8'>
        <DeviceHealthWidget onFilterDevices={handleFilterDevices} />
        <AlertsPanel onDeviceClick={handleDeviceClick} maxAlerts={5} />
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8'>
        <FloorPlan
          selectedFloor={selectedFloor}
          onDeviceClick={room => setSelectedRoom(room)}
          onDeviceDetailClick={handleDeviceClick}
        />
        <AnomalyChart selectedFloor={selectedFloor} />
      </div>

      <div className='w-full'>
        <DeviceGrid
          selectedFloor={selectedFloor}
          selectedRoom={selectedRoom}
          onClearRoomFilter={() => setSelectedRoom('all')}
          onDeviceClick={handleDeviceClick}
          externalFilter={deviceFilter}
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
    </main>
  );
}
