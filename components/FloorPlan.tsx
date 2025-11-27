'use client';

import { useEffect, useState, useRef } from 'react';
import { IDevice } from '@/models/Device';
import { toast } from 'react-toastify';

interface Reading {
  _id: string; // device_id
  value: number;
  timestamp: string;
  type: string;
}

interface FloorPlanProps {
  selectedFloor: number | 'all';
}

export default function FloorPlan({ selectedFloor }: FloorPlanProps) {
  const [devices, setDevices] = useState<IDevice[]>([]);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const alertedDevices = useRef<Set<string>>(new Set());

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

        // Check for alerts
        devices.forEach(device => {
          const reading = readingMap[device._id];
          if (reading && device.type === 'temperature') {
            if (reading.value > device.configuration.threshold_critical) {
              if (!alertedDevices.current.has(device._id + '_critical')) {
                toast.error(
                  `CRITICAL: ${device.room_name} is ${reading.value}°F!`
                );
                alertedDevices.current.add(device._id + '_critical');
                // Clear warning alert if it exists so we don't have double
                alertedDevices.current.delete(device._id + '_warning');
              }
            } else if (reading.value > device.configuration.threshold_warning) {
              if (
                !alertedDevices.current.has(device._id + '_warning') &&
                !alertedDevices.current.has(device._id + '_critical')
              ) {
                toast.warn(
                  `WARNING: ${device.room_name} is ${reading.value}°F`
                );
                alertedDevices.current.add(device._id + '_warning');
              }
            } else {
              // Reset alerts if back to normal
              alertedDevices.current.delete(device._id + '_critical');
              alertedDevices.current.delete(device._id + '_warning');
            }
          }
        });
      } catch (e) {
        console.error(e);
      }
    };

    if (devices.length > 0) {
      fetchReadings();
      const interval = setInterval(fetchReadings, 2000);
      return () => clearInterval(interval);
    }
  }, [devices]);

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

  // Filter devices by floor
  const filteredDevices =
    selectedFloor === 'all'
      ? devices
      : devices.filter(d => d.floor === selectedFloor);

  // For the visual floor plan, if 'all' is selected, we might just show the first available floor
  // or a specific floor to avoid clutter. Let's show the floor with the most devices or just Floor 2 as default if 'all'.
  // Or better, just show the devices in a grid if 'all' is selected, but the SVG is hardcoded for a layout.
  // Let's assume the SVG represents a generic floor layout and we just map devices to slots.

  // If 'all' is selected, let's just show devices from Floor 2 (as a demo) or the first floor found.
  // But the requirement says "The device health grid and Energy usage chart should update accordingly."
  // For the floor plan, it says "View 1: The 'Live' Floor Plan".
  // If I select Floor 1, I should see Floor 1 devices.

  const displayDevices = filteredDevices.slice(0, 10); // Limit to what fits in our simple SVG

  return (
    <div className='w-full bg-white rounded-xl border border-gray-200 p-6 shadow-sm h-[600px]'>
      <h3 className='text-lg font-semibold mb-4'>
        Live Floor Plan{' '}
        {selectedFloor !== 'all'
          ? `(Floor ${selectedFloor})`
          : '(All Floors - Preview)'}
      </h3>
      <div className='w-full h-[calc(100%-3rem)]'>
        <svg
          viewBox='0 0 800 600'
          className='w-full h-full bg-gray-50 rounded-lg border border-gray-100'>
          {displayDevices.map((device, i) => {
            // Simple layout algorithm for demo
            const isServerRoom = device.room_name.includes('Server');
            if (isServerRoom && i === 0) {
              return (
                <g key={device._id}>
                  <rect
                    x='50'
                    y='50'
                    width='200'
                    height='300'
                    className={`transition-colors duration-500 ${getColor(
                      device
                    )} stroke-gray-300 stroke-2`}
                    rx='4'
                  />
                  <text
                    x='150'
                    y='200'
                    textAnchor='middle'
                    className='text-sm font-bold fill-gray-700 pointer-events-none'>
                    {device.room_name}
                  </text>
                  <text
                    x='150'
                    y='220'
                    textAnchor='middle'
                    className='text-lg font-mono fill-gray-800 pointer-events-none'>
                    {readings[device._id]?.value
                      ? `${readings[device._id].value}${
                          device.type === 'temperature' ? '°F' : ''
                        }`
                      : '--'}
                  </text>
                </g>
              );
            }

            const x =
              300 +
              ((i - (displayDevices[0]?.room_name.includes('Server') ? 1 : 0)) %
                3) *
                150;
            const y =
              50 +
              Math.floor(
                (i -
                  (displayDevices[0]?.room_name.includes('Server') ? 1 : 0)) /
                  3
              ) *
                140;

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
          {displayDevices.length === 0 && (
            <text
              x='400'
              y='200'
              textAnchor='middle'
              className='text-gray-400 text-lg'>
              No devices on this floor
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
