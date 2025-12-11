'use client';

import { useEffect, useState } from 'react';
import { getPusherClient } from '@/lib/pusher-client';
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

export default function AnomalyChart({ selectedFloor }: AnomalyChartProps) {
  const [data, setData] = useState<{ time: string; value: number }[]>([]);
  const [isSpiking, setIsSpiking] = useState(false);

  useEffect(() => {
    const url = `/api/analytics/energy?period=24h${
      selectedFloor !== 'all' ? `&floor=${selectedFloor}` : ''
    }`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        const formatted = data.map(
          (d: { timestamp: string; value: number }) => ({
            ...d,
            time: new Date(d.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          })
        );
        setData(formatted);

        // Check for spike (current > 1.2 * average)
        if (formatted.length > 0) {
          const values = formatted.map((d: { value: number }) => d.value);
          const avg =
            values.reduce((a: number, b: number) => a + b, 0) / values.length;
          const current = values[values.length - 1];
          setIsSpiking(current > avg * 1.2);
        }
      });
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
        const url = `/api/analytics/energy?period=24h${
          selectedFloor !== 'all' ? `&floor=${selectedFloor}` : ''
        }`;
        fetch(url)
          .then(res => res.json())
          .then(data => {
            const formatted = data.map(
              (d: { timestamp: string; value: number }) => ({
                ...d,
                time: new Date(d.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })
            );
            setData(formatted);
            if (formatted.length > 0) {
              const values = formatted.map((d: { value: number }) => d.value);
              const avg =
                values.reduce((a: number, b: number) => a + b, 0) /
                values.length;
              const current = values[values.length - 1];
              setIsSpiking(current > avg * 1.2);
            }
          });
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
        <ResponsiveContainer width='100%' height='100%'>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id='colorValue' x1='0' y1='0' x2='0' y2='1'>
                <stop offset='5%' stopColor={gradientColor} stopOpacity={0.8} />
                <stop offset='95%' stopColor={gradientColor} stopOpacity={0} />
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
      </div>
    </div>
  );
}
