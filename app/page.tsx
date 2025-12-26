'use client';

import { useEffect, useState } from 'react';
import PrioritySummaryCards, {
  type CardFilter,
} from '@/components/PrioritySummaryCards';
import CriticalDevicesList from '@/components/CriticalDevicesList';
import AlertsPanel from '@/components/AlertsPanel';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { v2Api } from '@/lib/api/v2-client';
import {
  Activity,
} from 'lucide-react';

export default function Home() {
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

  // Fetch health score for header
  useEffect(() => {
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

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  const handleCardClick = (filter: CardFilter) => {
    // Navigate to devices page with filters in the future
    console.log('Card clicked:', filter);
  };

  const healthScoreColor =
    healthScore === null
      ? 'text-gray-600 dark:text-gray-400'
      : healthScore >= 90
      ? 'text-green-600 dark:text-green-400'
      : healthScore >= 70
      ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-red-600 dark:text-red-400';

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
            <h1 className='text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-1'>
              Dashboard
            </h1>
            <p className='text-gray-500 dark:text-gray-400'>
              System overview for Denver HQ
            </p>
          </div>

          {healthScore !== null && (
            <div className='flex items-center gap-2 bg-white dark:bg-gray-800 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm'>
              <Activity className={`h-5 w-5 ${healthScoreColor}`} />
              <div className='flex flex-col'>
                <span className='text-xs text-gray-500 dark:text-gray-400'>
                  System Health
                </span>
                <span className={`text-lg font-bold ${healthScoreColor}`}>
                  {healthScore.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Priority Summary Cards */}
      <section className='mb-6 md:mb-8'>
        <PrioritySummaryCards onCardClick={handleCardClick} />
      </section>

      {/* Main Content: Critical Devices + Alerts */}
      <section className='grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 md:mb-8'>
        <CriticalDevicesList onDeviceClick={handleDeviceClick} maxItems={8} />
        <AlertsPanel onDeviceClick={handleDeviceClick} maxAlerts={5} />
      </section>

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
