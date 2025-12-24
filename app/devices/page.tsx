'use client';

import { useState } from 'react';
import DeviceGrid from '@/components/DeviceGrid';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Monitor } from 'lucide-react';

export default function DevicesPage() {
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
          <Monitor className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
            Device Management
          </h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          View and manage all connected devices across all floors
        </p>
      </header>

      {/* Device Grid */}
      <DeviceGrid
        selectedFloor='all'
        onDeviceClick={handleDeviceClick}
      />

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
