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
    <div className='w-full bg-white rounded-xl border border-gray-200 p-6 shadow-sm h-[600px]'>
      <h3 className='text-lg font-semibold mb-4'>
        Energy Usage (Last 24h){' '}
        {selectedFloor !== 'all' ? `- Floor ${selectedFloor}` : ''}
      </h3>
      <div className='h-[500px] w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id='colorValue' x1='0' y1='0' x2='0' y2='1'>
                <stop offset='5%' stopColor='#6366f1' stopOpacity={0.8} />
                <stop offset='95%' stopColor='#6366f1' stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey='time'
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis fontSize={12} tickLine={false} axisLine={false} />
            <CartesianGrid
              strokeDasharray='3 3'
              vertical={false}
              stroke='#e5e7eb'
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
              itemStyle={{ color: '#6366f1' }}
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
