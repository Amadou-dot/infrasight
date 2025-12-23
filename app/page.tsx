'use client';

import { useEffect, useState } from 'react';
import FloorPlan from '@/components/FloorPlan';
import AnomalyChart from '@/components/AnomalyChart';
import DeviceGrid from '@/components/DeviceGrid';
import DeviceHealthWidget from '@/components/DeviceHealthWidget';
import AlertsPanel from '@/components/AlertsPanel';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import PrioritySummaryCards, { type CardFilter } from '@/components/PrioritySummaryCards';
import MaintenanceForecastWidget from '@/components/MaintenanceForecastWidget';
import { Button } from '@/components/ui/button';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { ModeToggle } from '@/components/mode-toggle';
import { Logo } from '@/components/logo';
import { v2Api } from '@/lib/api/v2-client';
import { Activity, Search, Filter, X, ChevronDown, ChevronUp } from 'lucide-react';

export default function Home() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [selectedRoom, setSelectedRoom] = useState<string | 'all'>('all');
  const [floors, setFloors] = useState<number[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [deviceFilter, setDeviceFilter] = useState<any>(null);
  
  // Global filtering and search state
  const [searchTerm, setSearchTerm] = useState('');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d'>('24h');
  const [showFilters, setShowFilters] = useState(false);
  const [sectionsCollapsed, setSectionsCollapsed] = useState({
    widgets: false,
    charts: false,
    floorPlan: false,
  });

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

  const handleFilterDevices = (filter: any) => {
    setDeviceFilter(filter);
  };

  const handleCardClick = (filter: CardFilter) => {
    switch (filter.type) {
      case 'critical':
        setDeviceFilter({ severity: 'critical' });
        setShowCriticalOnly(true);
        break;
      case 'maintenance':
        setDeviceFilter({ maintenanceDue: true });
        break;
      case 'health':
        // Scroll to health section or reset filters
        setDeviceFilter(null);
        setShowCriticalOnly(false);
        break;
      case 'anomalies':
        setDeviceFilter({ hasAnomalies: true });
        break;
    }
  };

  const handleSeverityFilter = (severity: 'critical' | 'warning' | 'watch') => {
    setDeviceFilter({ severity });
  };

  const resetFilters = () => {
    setDeviceFilter(null);
    setShowCriticalOnly(false);
    setSearchTerm('');
    setSelectedFloor('all');
    setSelectedRoom('all');
  };

  const toggleSection = (section: 'widgets' | 'charts' | 'floorPlan') => {
    setSectionsCollapsed(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
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

      {/* Header */}
      <header className='mb-6 md:mb-8'>
        <div className='flex flex-col gap-4'>
          {/* Top Row: Logo and Controls */}
          <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
            <div>
              <div className='flex items-center gap-3'>
                <Logo className='h-8 w-8 md:h-10 md:w-10 text-blue-600 dark:text-blue-400' />
                <h1 className='text-2xl md:text-3xl font-bold text-gray-900 dark:text-white tracking-tight'>
                  Infrasight
                </h1>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
                Real-time sensor data and analytics for Denver HQ
              </p>
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              {healthScore !== null && (
                <div className='flex items-center gap-2 bg-white dark:bg-gray-800 px-3 md:px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm'>
                  <Activity className={`h-4 w-4 md:h-5 md:w-5 ${healthScoreColor}`} />
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

          {/* Filters Row */}
          <div className='flex flex-col sm:flex-row gap-2'>
            {/* Search */}
            <div className='relative flex-1'>
              <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400' />
              <input
                type='text'
                placeholder='Search devices, serial numbers, rooms...'
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className='w-full pl-10 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className='absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'>
                  <X className='h-4 w-4' />
                </button>
              )}
            </div>

            {/* Quick Filters */}
            <div className='flex gap-2'>
              <Button
                variant={showCriticalOnly ? 'default' : 'outline'}
                size='sm'
                onClick={() => {
                  setShowCriticalOnly(!showCriticalOnly);
                  if (!showCriticalOnly) {
                    setDeviceFilter({ severity: 'critical' });
                  } else {
                    setDeviceFilter(null);
                  }
                }}
                className='whitespace-nowrap'>
                <Filter className='h-4 w-4 mr-1' />
                {showCriticalOnly ? 'Critical Only' : 'Show All'}
              </Button>

              <select
                value={timeRange}
                onChange={e => setTimeRange(e.target.value as '1h' | '24h' | '7d')}
                className='px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 cursor-pointer'>
                <option value='1h'>Last 1h</option>
                <option value='24h'>Last 24h</option>
                <option value='7d'>Last 7d</option>
              </select>

              {(deviceFilter || searchTerm || showCriticalOnly) && (
                <Button variant='ghost' size='sm' onClick={resetFilters}>
                  <X className='h-4 w-4 mr-1' />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* NEW: Priority Summary Cards (Hero Section) */}
      <div className='mb-6 md:mb-8'>
        <PrioritySummaryCards onCardClick={handleCardClick} />
      </div>

      {/* Row 1: Maintenance Forecast + Device Health Widget */}
      <div className='mb-6 md:mb-8'>
        <div className='flex items-center justify-between mb-3'>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
            System Overview
          </h2>
          <button
            onClick={() => toggleSection('widgets')}
            className='text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors'>
            {sectionsCollapsed.widgets ? (
              <ChevronDown className='h-5 w-5' />
            ) : (
              <ChevronUp className='h-5 w-5' />
            )}
          </button>
        </div>
        {!sectionsCollapsed.widgets && (
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6'>
            <MaintenanceForecastWidget
              onDeviceClick={handleDeviceClick}
              onFilterBySeverity={handleSeverityFilter}
              daysAhead={7}
            />
            <DeviceHealthWidget onFilterDevices={handleFilterDevices} />
          </div>
        )}
      </div>

      {/* Row 2: Alerts Panel + Anomaly Chart */}
      <div className='mb-6 md:mb-8'>
        <div className='flex items-center justify-between mb-3'>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
            Alerts & Analytics
          </h2>
          <button
            onClick={() => toggleSection('charts')}
            className='text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors'>
            {sectionsCollapsed.charts ? (
              <ChevronDown className='h-5 w-5' />
            ) : (
              <ChevronUp className='h-5 w-5' />
            )}
          </button>
        </div>
        {!sectionsCollapsed.charts && (
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6'>
            <AlertsPanel onDeviceClick={handleDeviceClick} maxAlerts={5} />
            <AnomalyChart selectedFloor={selectedFloor} />
          </div>
        )}
      </div>

      {/* Row 3: Floor Plan (Full Width, Collapsible) */}
      <div className='mb-6 md:mb-8'>
        <div className='flex items-center justify-between mb-3'>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
            Floor Plan
          </h2>
          <button
            onClick={() => toggleSection('floorPlan')}
            className='text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors'>
            {sectionsCollapsed.floorPlan ? (
              <ChevronDown className='h-5 w-5' />
            ) : (
              <ChevronUp className='h-5 w-5' />
            )}
          </button>
        </div>
        {!sectionsCollapsed.floorPlan && (
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6'>
            <FloorPlan
              selectedFloor={selectedFloor}
              onDeviceClick={room => setSelectedRoom(room)}
              onDeviceDetailClick={handleDeviceClick}
            />
            {/* Spacer for symmetry on desktop, hidden on mobile */}
            <div className='hidden lg:block' />
          </div>
        )}
      </div>

      {/* Row 4: Device Grid */}
      <div className='mb-6'>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-white mb-3'>
          Device Overview
        </h2>
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
