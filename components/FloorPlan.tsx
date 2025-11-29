'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { IDevice } from '@/models/Device';
import { toast } from 'react-toastify';
import {
  Thermometer,
  Droplet,
  Zap,
  Users,
  Activity,
  Server,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

interface Reading {
  _id: string; // device_id
  value: number;
  timestamp: string;
  type: string;
}

interface FloorPlanProps {
  selectedFloor: number | 'all';
  onDeviceClick?: (roomName: string) => void;
}

export default function FloorPlan({
  selectedFloor,
  onDeviceClick,
}: FloorPlanProps) {
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

  const getDeviceIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'temperature':
        return <Thermometer className='w-5 h-5' />;
      case 'humidity':
        return <Droplet className='w-5 h-5' />;
      case 'power':
        return <Zap className='w-5 h-5' />;
      case 'occupancy':
        return <Users className='w-5 h-5' />;
      default:
        return <Activity className='w-5 h-5' />;
    }
  };

  const getFormattedValue = (device: IDevice, value: number) => {
    if (device.type === 'temperature') return `${value}°F`;
    if (device.type === 'humidity') return `${value}%`;
    if (device.type === 'power') return `${value} kW`;
    if (device.type === 'occupancy') return `${value}`;
    return `${value}`;
  };

  const getStatusInfo = (device: IDevice, value: number | undefined) => {
    if (value === undefined)
      return {
        color: 'bg-gray-100 border-gray-200',
        icon: null,
        text: 'Offline',
      };

    // Default thresholds if not temp (simplified logic)
    const isCritical =
      value > (device.configuration.threshold_critical || 9999);
    const isWarning = value > (device.configuration.threshold_warning || 9999);

    if (isCritical) {
      return {
        color: 'bg-red-50 border-red-200 ring-1 ring-red-200',
        icon: <AlertTriangle className='w-4 h-4 text-red-500' />,
        text: 'Critical',
        textColor: 'text-red-700',
      };
    }
    if (isWarning) {
      return {
        color: 'bg-yellow-50 border-yellow-200 ring-1 ring-yellow-200',
        icon: <AlertTriangle className='w-4 h-4 text-yellow-500' />,
        text: 'Warning',
        textColor: 'text-yellow-700',
      };
    }
    return {
      color: 'bg-white border-gray-200 hover:border-blue-300',
      icon: <CheckCircle className='w-4 h-4 text-green-500' />,
      text: 'Normal',
      textColor: 'text-gray-600',
    };
  };

  const groupedDevices = useMemo(() => {
    const filtered =
      selectedFloor === 'all'
        ? devices
        : devices.filter(d => d.floor === selectedFloor);

    const grouped: Record<number, IDevice[]> = {};
    filtered.forEach(d => {
      if (!grouped[d.floor]) grouped[d.floor] = [];
      grouped[d.floor].push(d);
    });
    return grouped;
  }, [devices, selectedFloor]);

  const sortedFloors = Object.keys(groupedDevices)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className='w-full bg-white rounded-xl border border-gray-200 p-6 shadow-sm h-[600px] flex flex-col'>
      <div className='flex justify-between items-center mb-4'>
        <h3 className='text-lg font-semibold'>Live Device Status</h3>
        <span className='text-xs text-gray-400'>
          {Object.keys(readings).length > 0 ? 'Live' : 'Connecting...'}
        </span>
      </div>

      <div className='flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar'>
        {sortedFloors.map(floor => (
          <div key={floor}>
            {selectedFloor === 'all' && (
              <h4 className='text-sm font-medium text-gray-500 mb-3 sticky top-0 bg-white py-2 z-10'>
                Floor {floor}
              </h4>
            )}
            <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3'>
              {groupedDevices[floor].map(device => {
                const reading = readings[device._id];
                const status = getStatusInfo(device, reading?.value);

                return (
                  <div
                    key={device._id}
                    onClick={() => onDeviceClick?.(device.room_name)}
                    className={`p-3 rounded-lg border transition-all duration-200 ${status.color} flex flex-col gap-2 cursor-pointer hover:shadow-md`}>
                    <div className='flex justify-between items-start'>
                      <div className='flex items-center gap-2 text-gray-600'>
                        {getDeviceIcon(device.type)}
                        <span className='text-xs font-medium truncate max-w-[80px]'>
                          {device.room_name}
                        </span>
                      </div>
                      {status.icon}
                    </div>

                    <div className='mt-1'>
                      <div className='text-2xl font-bold text-gray-900'>
                        {reading
                          ? getFormattedValue(device, reading.value)
                          : '--'}
                      </div>
                      <div
                        className={`text-xs ${status.textColor} font-medium`}>
                        {device.type}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {sortedFloors.length === 0 && (
          <div className='flex items-center justify-center h-full text-gray-400'>
            No devices found.
          </div>
        )}
      </div>
    </div>
  );
}
