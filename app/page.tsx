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
  Monitor,
  Wrench,
  BarChart3,
  Map,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

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

  const quickLinks = [
    {
      href: '/devices',
      label: 'All Devices',
      icon: Monitor,
      color: 'text-blue-600 dark:text-blue-400',
    },
    {
      href: '/maintenance',
      label: 'Maintenance',
      icon: Wrench,
      color: 'text-amber-600 dark:text-amber-400',
    },
    {
      href: '/analytics',
      label: 'Analytics',
      icon: BarChart3,
      color: 'text-purple-600 dark:text-purple-400',
    },
    {
      href: '/floor-plan',
      label: 'Floor Plan',
      icon: Map,
      color: 'text-green-600 dark:text-green-400',
    },
  ];

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

      {/* Quick Links */}
      <section>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-white mb-4'>
          Quick Access
        </h2>
        <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
          {quickLinks.map(link => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className='flex items-center gap-3 p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-md transition-all group'>
                <div
                  className={`p-2 rounded-lg bg-gray-100 dark:bg-gray-800 ${link.color}`}>
                  <Icon className='h-5 w-5' />
                </div>
                <span className='font-medium text-gray-900 dark:text-white flex-1'>
                  {link.label}
                </span>
                <ChevronRight className='h-4 w-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors' />
              </Link>
            );
          })}
        </div>
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
