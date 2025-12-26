'use client';

import { useState } from 'react';
import MaintenanceForecastWidget from '@/components/MaintenanceForecastWidget';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Wrench } from 'lucide-react';

export default function MaintenancePage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black p-4 md:p-8">
      <ToastContainer
        position='bottom-center'
        autoClose={false}
        pauseOnFocusLoss
        pauseOnHover
        theme='colored'
      />

      {/* Header */}
      <header className="mb-6 md:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Wrench className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
            Maintenance Schedule
          </h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          Track device maintenance schedules and upcoming service needs
        </p>
      </header>

      {/* Maintenance Forecast - Full Width with more days */}
      <div className="grid grid-cols-1 gap-6">
        <MaintenanceForecastWidget
          onDeviceClick={handleDeviceClick}
          daysAhead={30}
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
