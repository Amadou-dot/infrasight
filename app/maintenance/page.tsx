'use client';

import { useState, useMemo } from 'react';
import { Wrench, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MaintenanceStatusCards from '@/components/MaintenanceStatusCards';
import MaintenanceTimeline from '@/components/MaintenanceTimeline';
import MaintenanceTable from '@/components/MaintenanceTable';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useMaintenanceForecast, useDevicesList } from '@/lib/query/hooks';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum pages to fetch when loading all devices (100 per page = 2000 max devices) */
const _MAX_PAGINATION_PAGES = 20;

/** Days after which a device needs recalibration (90 days) */
const CALIBRATION_THRESHOLD_DAYS = 90;

/** Milliseconds per day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default function MaintenancePage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

  // Data fetching with React Query
  const {
    data: forecast,
    isLoading: forecastLoading,
    error: forecastError,
  } = useMaintenanceForecast({ days_ahead: 30 });
  const {
    data: allDevices = [],
    isLoading: devicesLoading,
    error: devicesError,
  } = useDevicesList();

  const loading = forecastLoading || devicesLoading;
  const error = forecastError
    ? forecastError instanceof Error
      ? forecastError.message
      : 'Failed to load forecast'
    : devicesError
      ? devicesError instanceof Error
        ? devicesError.message
        : 'Failed to load devices'
      : null;

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  // Calculate status counts
  const { criticalCount, dueForServiceCount, healthyCount } = useMemo(() => {
    if (!forecast) return { criticalCount: 0, dueForServiceCount: 0, healthyCount: 0 };

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

  // Convert forecast data to timeline tasks
  const timelineTasks = useMemo(() => {
    if (!forecast) return [];

    const tasks: Array<{
      id: string;
      deviceId: string;
      deviceName: string;
      taskType: 'emergency' | 'firmware' | 'calibration' | 'routine';
      startDate: Date;
      endDate: Date;
      label: string;
    }> = [];

    const today = new Date();

    // Add critical devices as emergency tasks
    forecast.critical.forEach(device => {
      const nextMaint = device.metadata?.next_maintenance
        ? new Date(device.metadata.next_maintenance)
        : today;
      tasks.push({
        id: `critical-${device._id}`,
        deviceId: device._id,
        deviceName: device.serial_number || device._id,
        taskType: 'emergency',
        startDate: nextMaint,
        endDate: new Date(nextMaint.getTime() + 2 * MS_PER_DAY),
        label: 'EMERGENCY FIX',
      });
    });

    // Add warning devices as firmware/calibration tasks
    forecast.warning.forEach(device => {
      const nextMaint = device.metadata?.next_maintenance
        ? new Date(device.metadata.next_maintenance)
        : new Date(today.getTime() + 7 * MS_PER_DAY);
      const needsCalibration = device.configuration?.calibration_date
        ? new Date(device.configuration.calibration_date).getTime() <
          today.getTime() - CALIBRATION_THRESHOLD_DAYS * MS_PER_DAY
        : false;
      tasks.push({
        id: `warning-${device._id}`,
        deviceId: device._id,
        deviceName: device.serial_number || device._id,
        taskType: needsCalibration ? 'calibration' : 'firmware',
        startDate: nextMaint,
        endDate: new Date(nextMaint.getTime() + 1 * MS_PER_DAY),
        label: needsCalibration ? 'CALIBRATION' : 'FW UPDATE',
      });
    });

    // Add watch devices as routine tasks
    forecast.watch.forEach(device => {
      const nextMaint = device.metadata?.next_maintenance
        ? new Date(device.metadata.next_maintenance)
        : new Date(today.getTime() + 14 * MS_PER_DAY);
      tasks.push({
        id: `watch-${device._id}`,
        deviceId: device._id,
        deviceName: device.serial_number || device._id,
        taskType: 'routine',
        startDate: nextMaint,
        endDate: new Date(nextMaint.getTime() + 1 * MS_PER_DAY),
        label: 'ROUTINE CHECK',
      });
    });

    // Sort by start date
    return tasks.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [forecast]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <ToastContainer
        position="bottom-center"
        autoClose={false}
        pauseOnFocusLoss
        pauseOnHover
        theme="colored"
      />

      {/* Header */}
      <header className="mb-6 md:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Wrench className="h-8 w-8 text-primary" />
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">
                Maintenance Schedule
              </h1>
            </div>
            <p className="text-muted-foreground">
              Track device maintenance schedules, health status, and upcoming service needs.
            </p>
          </div>
          <Button className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="h-4 w-4 mr-2" />
            Schedule Service
          </Button>
        </div>
      </header>

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

      {/* Status Cards */}
      <section className="mb-6">
        <MaintenanceStatusCards
          criticalCount={criticalCount}
          dueForServiceCount={dueForServiceCount}
          healthyCount={healthyCount}
          criticalNew={forecast?.critical.length ? Math.min(2, forecast.critical.length) : 0}
          uptimePercentage={uptimePercentage}
          loading={loading}
        />
      </section>

      {/* Timeline */}
      <section className="mb-6">
        <MaintenanceTimeline tasks={timelineTasks} loading={loading} />
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
