'use client';

import { useState } from 'react';
import DeviceHealthWidget from '@/components/DeviceHealthWidget';
import AnomalyChart from '@/components/AnomalyChart';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { BarChart3 } from 'lucide-react';

export default function AnalyticsPage() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');

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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
                Analytics & Monitoring
              </h1>
            </div>
            <p className="text-gray-500 dark:text-gray-400">
              System health metrics, anomalies, and performance analytics
            </p>
          </div>
          
          {/* Floor Filter - moved to header */}
          <div className="flex items-center gap-3 bg-white dark:bg-gray-900 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Floor:
            </span>
            <select
              value={selectedFloor}
              onChange={e => setSelectedFloor(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
              className="px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer"
            >
              <option value="all">All Floors</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(f => (
                <option key={f} value={f}>Floor {f}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Analytics Grid - Swapped: Energy/Anomaly first, then System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnomalyChart selectedFloor={selectedFloor} />
        <DeviceHealthWidget />
      </div>
    </div>
  );
}
