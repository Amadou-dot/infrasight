'use client';

import { useState, useEffect, useMemo } from 'react';
import { Wrench, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MaintenanceStatusCards from '@/components/MaintenanceStatusCards';
import MaintenanceTimeline from '@/components/MaintenanceTimeline';
import MaintenanceTable from '@/components/MaintenanceTable';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { v2Api } from '@/lib/api/v2-client';
import type { MaintenanceForecastResponse, DeviceV2Response } from '@/types/v2';

export default function MaintenancePage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [forecast, setForecast] = useState<MaintenanceForecastResponse | null>(
    null
  );
  const [allDevices, setAllDevices] = useState<DeviceV2Response[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [forecastRes, devicesRes] = await Promise.all([
          v2Api.analytics.maintenanceForecast({ days_ahead: 30 }),
          v2Api.devices.list({ limit: 100 }),
        ]);

        setForecast(forecastRes.data);
        setAllDevices(devicesRes.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        console.error('Maintenance page error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Calculate status counts
  const { criticalCount, dueForServiceCount, healthyCount } = useMemo(() => {
    if (!forecast) {
      return { criticalCount: 0, dueForServiceCount: 0, healthyCount: 0 };
    }

    return {
      criticalCount: forecast.critical.length,
      dueForServiceCount: forecast.warning.length + forecast.watch.length,
      healthyCount:
        allDevices.length -
        forecast.critical.length -
        forecast.warning.length -
        forecast.watch.length,
    };
  }, [forecast, allDevices]);

  // Get uptime percentage
  const uptimePercentage = useMemo(() => {
    if (allDevices.length === 0) return undefined;
    const activeDevices = allDevices.filter(d => d.status === 'active').length;
    return Math.round((activeDevices / allDevices.length) * 100);
  }, [allDevices]);

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
      <header className='mb-6 md:mb-8'>
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
          <div>
            <div className='flex items-center gap-3 mb-2'>
              <Wrench className='h-8 w-8 text-primary' />
              <h1 className='text-2xl md:text-3xl font-bold text-foreground'>
                Maintenance Schedule
              </h1>
            </div>
            <p className='text-muted-foreground'>
              Track device maintenance schedules, health status, and upcoming
              service needs.
            </p>
          </div>
          <Button className='w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white'>
            <Plus className='h-4 w-4 mr-2' />
            Schedule Service
          </Button>
        </div>
      </header>

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

      {/* Status Cards */}
      <section className='mb-6'>
        <MaintenanceStatusCards
          criticalCount={criticalCount}
          dueForServiceCount={dueForServiceCount}
          healthyCount={healthyCount}
          criticalNew={
            forecast?.critical.length
              ? Math.min(2, forecast.critical.length)
              : 0
          }
          uptimePercentage={uptimePercentage}
          loading={loading}
        />
      </section>

      {/* Timeline */}
      <section className='mb-6'>
        <MaintenanceTimeline loading={loading} />
      </section>

      {/* Data Table */}
      <section>
        <MaintenanceTable
          devices={allDevices}
          onDeviceClick={handleDeviceClick}
          loading={loading}
        />
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
