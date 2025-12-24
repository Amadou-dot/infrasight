'use client';

import { useEffect, useState } from 'react';
import { getPusherClient } from '@/lib/pusher-client';
import { v2Api } from '@/lib/api/v2-client';
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

interface PusherReading {
  metadata: {
    device_id: string;
    type: 'temperature' | 'humidity' | 'occupancy' | 'power';
  };
  timestamp: string;
  value: number;
}

interface ChartDataPoint {
  time: string;
  value: number;
  timestamp: string;
}

export default function AnomalyChart({ selectedFloor }: AnomalyChartProps) {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSpiking, setIsSpiking] = useState(false);

  const fetchEnergyData = async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);

      // Calculate date range for last 24 hours
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

      const response = await v2Api.analytics.energy({
        period: '24h',
        granularity: 'hour',
        aggregationType: 'avg',
        deviceType: 'power',
        floor: selectedFloor !== 'all' ? selectedFloor : undefined,
      });

      if (response.success && response.data) {
        // Handle the v2 API response structure - can have either timestamp or time_bucket
        interface RawDataPoint {
          time_bucket?: string;
          timestamp?: string;
          value?: number;
        }

        let rawResults: RawDataPoint[];

        if (Array.isArray(response.data)) {
          // Direct array of data points
          rawResults = response.data.map(d => ({
            timestamp: d.timestamp,
            value: d.value,
          }));
        } else {
          // Nested structure with results array
          const nestedData = response.data as { results?: RawDataPoint[] };
          rawResults = nestedData.results || [];
        }

        const formatted: ChartDataPoint[] = rawResults.map(d => ({
          timestamp: d.time_bucket || d.timestamp || '',
          value: d.value || 0,
          time: new Date(d.time_bucket || d.timestamp || '').toLocaleTimeString(
            [],
            {
              hour: '2-digit',
              minute: '2-digit',
            }
          ),
        }));
        setData(formatted);

        // Check for spike (current > 1.2 * average)
        if (formatted.length > 0) {
          const values = formatted.map(d => d.value);
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          const current = values[values.length - 1];
          setIsSpiking(current > avg * 1.2);
        }
      } else {
        setData([]);
      }
    } catch (err) {
      console.error('Error fetching energy data:', err);
      setError('Failed to load energy data');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchEnergyData(true);
  }, [selectedFloor]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchEnergyData(false), 60000);
    return () => clearInterval(interval);
  }, [selectedFloor]);

  // Real-time updates
  useEffect(() => {
    const pusher = getPusherClient();
    const channel = pusher.subscribe('InfraSight');

    channel.bind('new-readings', (newReadings: PusherReading[]) => {
      // Only proceed if there's a power reading in the batch
      const hasPowerReadings = newReadings.some(
        r => r.metadata.type === 'power'
      );
      if (hasPowerReadings) {
        // Re-fetch data to keep it consistent with the aggregation logic
        fetchEnergyData(false);
      }
    });

    return () => {
      pusher.unsubscribe('InfraSight');
    };
  }, [selectedFloor]);

  const primaryColor = isSpiking ? '#f97316' : '#6366f1'; // Orange-500 vs Indigo-500
  const gradientColor = isSpiking ? '#fb923c' : '#818cf8'; // Orange-400 vs Indigo-400

  return (
    <div className='w-full bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm h-[600px] flex flex-col'>
      <div className='flex justify-between items-start mb-1'>
        <h3 className='text-lg font-semibold'>
          Energy Usage
          {selectedFloor !== 'all' ? ` - Floor ${selectedFloor}` : ''}
        </h3>
        {isSpiking && (
          <span className='bg-orange-100 text-orange-700 text-xs font-medium px-2 py-1 rounded-full animate-pulse'>
            High Usage Detected
          </span>
        )}
      </div>
      <p className='text-sm text-gray-500 mb-6'>Last 24 Hours</p>

      <div className='flex-1 min-h-0'>
        {loading ? (
          <div className='flex items-center justify-center h-full'>
            <Loader2 className='h-8 w-8 animate-spin text-gray-400' />
          </div>
        ) : error ? (
          <div className='flex flex-col items-center justify-center h-full text-red-500'>
            <AlertCircle className='h-8 w-8 mb-2' />
            <p className='text-sm'>{error}</p>
          </div>
        ) : data.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-gray-400'>
            <AlertCircle className='h-8 w-8 mb-2' />
            <p className='text-sm'>No energy data available</p>
            <p className='text-xs mt-1'>
              Power readings will appear here once collected
            </p>
          </div>
        ) : (
          <ResponsiveContainer width='100%' height='100%'>
            <AreaChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id='colorValue' x1='0' y1='0' x2='0' y2='1'>
                  <stop
                    offset='5%'
                    stopColor={gradientColor}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset='95%'
                    stopColor={gradientColor}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey='time'
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
              <CartesianGrid
                strokeDasharray='3 3'
                vertical={false}
                stroke='#E5E7EB'
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length)
                    return (
                      <div className='bg-white dark:bg-zinc-800 p-3 border border-gray-200 dark:border-gray-700 shadow-lg rounded-lg'>
                        <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {label}
                        </p>
                        <p className='text-sm text-indigo-600 dark:text-indigo-400 font-semibold'>
                          {payload[0].value} kWh
                        </p>
                      </div>
                    );

                  return null;
                }}
              />
              <ReferenceLine
                y={100}
                label='CRITICAL'
                stroke='red'
                strokeDasharray='3 3'
              />
              <Area
                type='monotone'
                dataKey='value'
                stroke={primaryColor}
                strokeWidth={2}
                fillOpacity={1}
                fill='url(#colorValue)'
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
