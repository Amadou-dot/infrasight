'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface AnomalyChartProps {
  selectedFloor: number | 'all';
}

export default function AnomalyChart({ selectedFloor }: AnomalyChartProps) {
  const [data, setData] = useState([]);

  useEffect(() => {
    const url = `/api/analytics/energy?period=24h${
      selectedFloor !== 'all' ? `&floor=${selectedFloor}` : ''
    }`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        // Simulate 24h data if the API returns sparse data for demo purposes
        // In a real app, we'd trust the API.
        // For now, let's just format what we get.
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
      });
  }, [selectedFloor]);

  return (
    <div className='w-full bg-white rounded-xl border border-gray-200 p-6 shadow-sm h-[600px] flex flex-col'>
      <h3 className='text-lg font-semibold mb-1'>
        Energy Usage
        {selectedFloor !== 'all' ? ` - Floor ${selectedFloor}` : ''}
      </h3>
      <p className='text-sm text-gray-500 mb-6'>Last 24 Hours</p>

      <div className='flex-1 min-h-0'>
        <ResponsiveContainer width='100%' height='100%'>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id='colorValue' x1='0' y1='0' x2='0' y2='1'>
                <stop offset='5%' stopColor='#818cf8' stopOpacity={0.3} />
                <stop offset='95%' stopColor='#818cf8' stopOpacity={0} />
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
              stroke='#f3f4f6'
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
              itemStyle={{ color: '#6366f1' }}
              formatter={(value: number) => [`${value} kWh`, 'Energy']}
            />
            <Area
              type='monotone'
              dataKey='value'
              stroke='#6366f1'
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
