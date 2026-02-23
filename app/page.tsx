'use client';

import DeviceDetailModal from '@/components/DeviceDetailModal';
import GenerateReportModal from '@/components/GenerateReportModal';
import {
  AnomalyDetectionChart,
  CriticalIssuesPanel,
  MaintenanceWidget,
  StatCard,
  SystemHealthWidget,
} from '@/components/dashboard';
import { useHealthAnalytics, useMaintenanceForecast, useAnomalies } from '@/lib/query/hooks';
import { AlertTriangle, FileText, Gauge, Monitor, Zap } from 'lucide-react';
import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRbac } from '@/lib/auth/rbac-client';

export default function Home() {
  // User info from Clerk
  const { user } = useUser();
  const { isAdmin } = useRbac();

  // Data fetching with React Query (automatic caching, deduplication)
  const { data: health, isLoading } = useHealthAnalytics();
  const { data: forecast } = useMaintenanceForecast({ days_ahead: 7 });
  const { data: _anomalies } = useAnomalies({ limit: 100 });

  // Modal state
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  // Calculate metrics
  const totalDevices = health?.summary?.total_devices ?? 0;
  const activeAlerts =
    (health?.alerts?.offline_devices?.count ?? 0) +
    (health?.alerts?.error_devices?.count ?? 0) +
    (health?.alerts?.low_battery_devices?.count ?? 0) +
    (forecast?.summary?.maintenance_overdue?.length ?? 0);
  const healthScore = health?.summary?.health_score ?? 0;

  // Calculate energy usage (mock for now since we don't have real aggregated energy data)
  // In a real scenario, this would come from an energy analytics endpoint
  const energyUsage = '4.2 MWh';

  // Calculate trends (mock - would need historical data for real trends)
  const devicesTrend = { value: 12, isPositive: true };
  const alertsTrend = { value: 2, isPositive: false };
  const efficiencyTrend = { value: 1, isPositive: false };
  const energyTrend = { value: 5, isPositive: false };

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Title section */}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1">System Overview</h1>
            <p className="text-muted-foreground">
              {getGreeting()}
              {user?.firstName ? `, ${user.firstName}` : ''}.{' '}
              {activeAlerts > 0 && (
                <span>
                  You have{' '}
                  <span className="text-red-400 font-medium">
                    {activeAlerts} critical issue{activeAlerts !== 1 ? 's' : ''}
                  </span>{' '}
                  requiring attention.
                </span>
              )}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            {/* Generate Report button */}
            {isAdmin && (
              <button
                onClick={() => setReportModalOpen(true)}
                className="flex gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <FileText className="h-4 w-4" />
                Generate Report
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Stat Cards Row */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Devices"
          value={isLoading ? '—' : totalDevices.toLocaleString()}
          icon={Monitor}
          iconColor="text-cyan-400"
          iconBgColor="bg-cyan-500/20"
          trend={devicesTrend}
        />
        <StatCard
          title="Active Alerts"
          value={isLoading ? '—' : activeAlerts.toString()}
          icon={AlertTriangle}
          iconColor="text-red-400"
          iconBgColor="bg-red-500/20"
          trend={alertsTrend}
        />
        <StatCard
          title="Efficiency Score"
          value={isLoading ? '—' : `${healthScore}%`}
          icon={Gauge}
          iconColor="text-green-400"
          iconBgColor="bg-green-500/20"
          trend={efficiencyTrend}
        />
        <StatCard
          title="Energy Usage"
          value={energyUsage}
          icon={Zap}
          iconColor="text-yellow-400"
          iconBgColor="bg-yellow-500/20"
          trend={energyTrend}
        />
      </section>

      {/* Main Content Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Critical Issues + Anomaly Chart */}
        <div className="lg:col-span-2 space-y-6">
          {/* Critical Issues Panel */}
          <div className="min-h-75">
            <CriticalIssuesPanel onIssueClick={handleDeviceClick} maxItems={5} />
          </div>

          {/* Anomaly Detection Chart */}
          <div className="min-h-80">
            <AnomalyDetectionChart hours={6} />
          </div>
        </div>

        {/* Right Column - System Health + Maintenance */}
        <div className="space-y-6">
          {/* System Health Widget */}
          <div className="min-h-80">
            <SystemHealthWidget />
          </div>

          {/* Maintenance Widget */}
          <div className="min-h-70">
            <MaintenanceWidget onItemClick={handleDeviceClick} maxItems={4} />
          </div>
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

      {/* Generate Report Modal */}
      <GenerateReportModal isOpen={reportModalOpen} onClose={() => setReportModalOpen(false)} />
    </div>
  );
}
