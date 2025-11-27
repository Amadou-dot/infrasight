'use client';

import { useEffect, useState } from 'react';
import { IDevice } from '@/models/Device';

interface Reading {
  _id: string; // device_id
  value: number;
  timestamp: string;
  type: string;
}

export default function FloorPlan() {
  const [devices, setDevices] = useState<IDevice[]>([]);
  const [readings, setReadings] = useState<Record<string, Reading>>({});

  useEffect(() => {
    fetch('/api/devices')
      .then(res => res.json())
      .then(setDevices);
  }, []);

  useEffect(() => {
    const fetchReadings = async () => {
      try {
        const res = await fetch('/api/readings/latest');
        const data = await res.json();
        const readingMap = data.reduce(
          (acc: Record<string, Reading>, curr: Reading) => {
            acc[curr._id] = curr;
            return acc;
          },
          {} as Record<string, Reading>
        );
        setReadings(readingMap);
      } catch (e) {
        console.error(e);
      }
    };

    fetchReadings();
    const interval = setInterval(fetchReadings, 2000);
    return () => clearInterval(interval);
  }, []);

  const getColor = (device: IDevice | undefined) => {
    if (!device) return 'fill-gray-200';
    const reading = readings[device._id];
    if (!reading) return 'fill-gray-200';

    if (device.type === 'temperature') {
      if (reading.value > device.configuration.threshold_critical)
        return 'fill-red-500';
      if (reading.value > device.configuration.threshold_warning)
        return 'fill-yellow-400';
      return 'fill-green-400';
    }
    return 'fill-blue-200';
  };

  const serverRoom = devices.find(d => d.room_name === 'Server Room B');
  const otherDevices = devices
    .filter(d => d.room_name !== 'Server Room B')
    .slice(0, 6);

  return (
    <div className='w-full bg-white rounded-xl border border-gray-200 p-6 shadow-sm'>
      <h3 className='text-lg font-semibold mb-4'>Live Floor Plan (Floor 2)</h3>
      <div className='aspect-video w-full'>
        <svg
          viewBox='0 0 800 400'
          className='w-full h-full bg-gray-50 rounded-lg border border-gray-100'>
          {/* Server Room B */}
          <g>
            <rect
              x='50'
              y='50'
              width='200'
              height='300'
              className={`transition-colors duration-500 ${getColor(
                serverRoom
              )} stroke-gray-300 stroke-2`}
              rx='4'
            />
            <text
              x='150'
              y='200'
              textAnchor='middle'
              className='text-sm font-bold fill-gray-700 pointer-events-none'>
              Server Room B
            </text>
            <text
              x='150'
              y='220'
              textAnchor='middle'
              className='text-lg font-mono fill-gray-800 pointer-events-none'>
              {serverRoom && readings[serverRoom._id]?.value
                ? `${readings[serverRoom._id].value}°F`
                : '--'}
            </text>
          </g>

          {/* Other rooms */}
          {otherDevices.map((device, i) => {
            const x = 300 + (i % 3) * 150;
            const y = 50 + Math.floor(i / 3) * 160;
            return (
              <g key={device._id}>
                <rect
                  x={x}
                  y={y}
                  width='120'
                  height='120'
                  className={`transition-colors duration-500 ${getColor(
                    device
                  )} stroke-gray-300 stroke-2`}
                  rx='4'
                />
                <text
                  x={x + 60}
                  y={y + 50}
                  textAnchor='middle'
                  className='text-xs font-medium fill-gray-700 pointer-events-none'>
                  {device.room_name}
                </text>
                <text
                  x={x + 60}
                  y={y + 70}
                  textAnchor='middle'
                  className='text-sm font-mono fill-gray-800 pointer-events-none'>
                  {readings[device._id]?.value ?? '--'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
