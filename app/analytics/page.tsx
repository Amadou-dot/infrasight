'use client';

import { useState, useEffect, useMemo } from 'react';
import DeviceHealthWidget from '@/components/DeviceHealthWidget';
import EnergyUsageChart from '@/components/AnomalyChart';
import { Select } from '@/components/ui/select';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { BarChart3 } from 'lucide-react';
import { v2Api, type MetadataBuilding } from '@/lib/api/v2-client';

export default function AnalyticsPage() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [buildings, setBuildings] = useState<MetadataBuilding[]>([]);

  // Fetch available floors from metadata API
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await v2Api.metadata.get();
        if (response.success && response.data.buildings) setBuildings(response.data.buildings);
      } catch (error) {
        console.error('Error fetching metadata:', error);
      }
    };
    fetchMetadata();
  }, []);

  // Extract all unique floors from all buildings
  const availableFloors = useMemo(() => {
    const allFloors = new Set<number>();
    buildings.forEach(b => b.floors.forEach(f => allFloors.add(f.floor)));
    return Array.from(allFloors).sort((a, b) => a - b);
  }, [buildings]);

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
          
          {/* Floor Filter */}
          <Select
            label='Floor'
            value={String(selectedFloor)}
            onValueChange={(val) =>
              setSelectedFloor(val === 'all' ? 'all' : parseInt(val))
            }
            options={[
              { value: 'all', label: 'All Floors' },
              ...availableFloors.map(f => ({
                value: String(f),
                label: `Floor ${f}`,
              })),
            ]}
          />
        </div>
      </header>

      {/* Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EnergyUsageChart selectedFloor={selectedFloor} />
        <DeviceHealthWidget />
      </div>
    </div>
  );
}
