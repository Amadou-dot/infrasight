'use client';

import { useMemo } from 'react';
import { usePusherReadings } from '@/lib/pusher-context';
import { useEnergyAnalytics } from '@/lib/query/hooks';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { AlertCircle, Loader2 } from 'lucide-react';

interface AnomalyChartProps {
  selectedFloor: number | 'all';
}

interface ChartDataPoint {
  time: string;
  value: number;
  timestamp: string;
}

export default function EnergyUsageChart({ selectedFloor }: AnomalyChartProps) {
  // Fetch energy data with React Query
  const {
    data: energyData,
    isLoading,
    error: fetchError,
    refetch,
  } = useEnergyAnalytics({
    period: '24h',
    granularity: 'hour',
    aggregationType: 'avg',
    deviceType: 'power',
    floor: selectedFloor !== 'all' ? selectedFloor : undefined,
  });

  const error = fetchError ? 'Failed to load energy data' : null;

  // Process chart data
  const data = useMemo(() => {
    if (!energyData) return [];

    // Handle the v2 API response structure - can have either timestamp or time_bucket
    interface RawDataPoint {
      time_bucket?: string;
      timestamp?: string;
      value?: number;
    }

    let rawResults: RawDataPoint[];

    if (Array.isArray(energyData))
      // Direct array of data points
      rawResults = energyData.map((d: unknown) => {
        const dataPoint = d as RawDataPoint;
        return {
          timestamp: dataPoint.timestamp,
          value: dataPoint.value,
        };
      });
    else {
      // Nested structure with results array
      const nestedData = energyData as { results?: RawDataPoint[] };
      rawResults = nestedData.results || [];
    }

    const formatted: ChartDataPoint[] = rawResults.map(d => ({
      timestamp: d.time_bucket || d.timestamp || '',
      value: d.value || 0,
      time: new Date(d.time_bucket || d.timestamp || '').toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

    return formatted;
  }, [energyData]);

  // Check for spike (current > 1.2 * average) - derived state
  const isSpiking = useMemo(() => {
    if (data.length === 0) return false;
    const values = data.map(d => d.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const current = values[values.length - 1];
    return current > avg * 1.2;
  }, [data]);

  // Real-time updates via centralized Pusher context
  usePusherReadings((newReadings) => {
    // Only proceed if there's a power reading in the batch
    const hasPowerReadings = newReadings.some(r => r.metadata.type === 'power');
    if (hasPowerReadings)
      // Re-fetch data to keep it consistent with the aggregation logic
      refetch();
  });

  const primaryColor = isSpiking ? '#f97316' : '#6366f1'; // Orange-500 vs Indigo-500
  const gradientColor = isSpiking ? '#fb923c' : '#818cf8'; // Orange-400 vs Indigo-400

  return (
    <div className="w-full bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm h-[600px] flex flex-col">
      <div className="flex justify-between items-start mb-1">
        <h3 className="text-lg font-semibold">
          Energy Usage
          {selectedFloor !== 'all' ? ` - Floor ${selectedFloor}` : ''}
        </h3>
        {isSpiking && (
          <span className="bg-orange-100 text-orange-700 text-xs font-medium px-2 py-1 rounded-full animate-pulse">
            High Usage Detected
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-6">Last 24 Hours</p>

      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500">
            <AlertCircle className="h-8 w-8 mb-2" />
            <p className="text-sm">{error}</p>
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <AlertCircle className="h-8 w-8 mb-2" />
            <p className="text-sm">No energy data available</p>
            <p className="text-xs mt-1">Power readings will appear here once collected</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={gradientColor} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={gradientColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#9ca3af' }}
                minTickGap={30}
              />
              <YAxis
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#9ca3af' }}
                domain={['dataMin - 5', 'dataMax + 5']}
                label={{
                  value: 'kWh',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: '#9ca3af', fontSize: '12px' },
                }}
              />
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length)
                    return (
                      <div className="bg-white dark:bg-zinc-800 p-3 border border-gray-200 dark:border-gray-700 shadow-lg rounded-lg">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {label}
                        </p>
                        <p className="text-sm text-indigo-600 dark:text-indigo-400 font-semibold">
                          {payload[0].value} kWh
                        </p>
                      </div>
                    );

                  return null;
                }}
              />
              <ReferenceLine y={100} label="CRITICAL" stroke="red" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="value"
                stroke={primaryColor}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorValue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
