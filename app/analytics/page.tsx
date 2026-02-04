'use client';

import { useState, useMemo } from 'react';
import DeviceHealthWidget from '@/components/DeviceHealthWidget';
import EnergyUsageChart from '@/components/AnomalyChart';
import GenerateReportModal from '@/components/GenerateReportModal';
import { Select } from '@/components/ui/select';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { BarChart3, FileText } from 'lucide-react';
import { useMetadata } from '@/lib/query/hooks';
import { useRbac } from '@/lib/auth/rbac-client';

export default function AnalyticsPage() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const { isAdmin } = useRbac();

  // Fetch metadata with React Query
  const { data: metadata } = useMetadata();
  const buildings = useMemo(() => metadata?.buildings || [], [metadata?.buildings]);

  // Extract all unique floors from all buildings
  const availableFloors = useMemo(() => {
    const allFloors = new Set<number>();
    buildings.forEach(b => b.floors.forEach(f => allFloors.add(f.floor)));
    return Array.from(allFloors).sort((a, b) => a - b);
  }, [buildings]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black p-4 md:p-8">
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
              <BarChart3 className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
                Analytics & Monitoring
              </h1>
            </div>
            <p className="text-gray-500 dark:text-gray-400">
              System health metrics, anomalies, and performance analytics
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Generate Report button (admin only) */}
            {isAdmin && (
              <button
                onClick={() => setReportModalOpen(true)}
                className="flex gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <FileText className="h-4 w-4" />
                Generate Report
              </button>
            )}

            {/* Floor Filter */}
            <Select
              label="Floor"
              value={String(selectedFloor)}
              onValueChange={val => setSelectedFloor(val === 'all' ? 'all' : parseInt(val))}
              options={[
                { value: 'all', label: 'All Floors' },
                ...availableFloors.map(f => ({
                  value: String(f),
                  label: `Floor ${f}`,
                })),
              ]}
            />
          </div>
        </div>
      </header>

      {/* Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EnergyUsageChart selectedFloor={selectedFloor} />
        <DeviceHealthWidget selectedFloor={selectedFloor} />
      </div>

      {/* Generate Report Modal */}
      <GenerateReportModal isOpen={reportModalOpen} onClose={() => setReportModalOpen(false)} />
    </div>
  );
}
