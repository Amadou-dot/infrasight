'use client';

import { getPusherClient } from '@/lib/pusher-client';
import type { IDevice } from '@/models/Device';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Droplet,
  Thermometer,
  Users,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';

interface Reading {
  _id: string; // device_id
  value: number;
  timestamp: string;
  type: string;
}

interface PusherReading {
  metadata: {
    device_id: string;
    type: 'temperature' | 'humidity' | 'occupancy' | 'power';
  };
  timestamp: string;
  value: number;
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

  // UI State
  const [collapsedFloors, setCollapsedFloors] = useState<Set<number>>(
    new Set()
  );
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [initializedCollapse, setInitializedCollapse] = useState(false);

  const toggleFloor = (floor: number) => {
    const newCollapsed = new Set(collapsedFloors);
    if (newCollapsed.has(floor)) 
      newCollapsed.delete(floor);
     else 
      newCollapsed.add(floor);
    
    setCollapsedFloors(newCollapsed);
  };

  useEffect(() => {
    fetch('/api/devices')
      .then(res => res.json())
      .then(setDevices);
  }, []);

  useEffect(() => {
    // Initial fetch
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
      } catch (error) {
        console.error('Error fetching latest readings:', error);
      }
    };

    if (devices.length > 0) 
      fetchReadings();
    
  }, [devices]);

  // Real-time updates with Pusher
  useEffect(() => {
    const pusher = getPusherClient();
    const channel = pusher.subscribe('InfraSight');

    channel.bind('new-readings', (newReadings: PusherReading[]) => {
      setReadings(prev => {
        const next = { ...prev };
        newReadings.forEach(reading => {
          const deviceId = reading.metadata.device_id;
          next[deviceId] = {
            _id: deviceId,
            value: reading.value,
            timestamp: reading.timestamp,
            type: reading.metadata.type,
          };
        });
        return next;
      });
    });

    return () => {
      pusher.unsubscribe('InfraSight');
    };
  }, []);

  // Check for alerts when readings change
  useEffect(() => {
    devices.forEach(device => {
      const reading = readings[device._id];
      if (reading && device.type === 'temperature') 
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
      
    });
  }, [devices, readings]);

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
    if (device.type === 'temperature')  return `${value}°F`; 
    if (device.type === 'humidity')  return `${value}%`; 
    if (device.type === 'power')  return `${value} kW`; 
    if (device.type === 'occupancy')  return `${value}`; 
    return `${value}`;
  };

  const getStatusInfo = (device: IDevice, value: number | undefined) => {
    if (value === undefined) 
      return {
        color:
          'bg-gray-100 border-gray-200 dark:bg-zinc-800 dark:border-zinc-700',
        icon: null,
        text: 'Offline',
      };
    

    // Default thresholds if not temp (simplified logic)
    const isCritical =
      value > (device.configuration.threshold_critical || 9999);
    const isWarning = value > (device.configuration.threshold_warning || 9999);

    if (isCritical) 
      return {
        color:
          'bg-red-50 border-red-200 ring-1 ring-red-200 dark:bg-red-950 dark:border-red-900 dark:ring-red-900',
        icon: (
          <AlertTriangle className='w-4 h-4 text-red-500 dark:text-red-400' />
        ),
        text: 'Critical',
        textColor: 'text-red-700 dark:text-red-200',
      };
    
    if (isWarning) 
      return {
        color:
          'bg-yellow-50 border-yellow-200 ring-1 ring-yellow-200 dark:bg-yellow-950 dark:border-yellow-900 dark:ring-yellow-900',
        icon: (
          <AlertTriangle className='w-4 h-4 text-yellow-500 dark:text-yellow-400' />
        ),
        text: 'Warning',
        textColor: 'text-yellow-700 dark:text-yellow-200',
      };
    
    return {
      color:
        'bg-white border-gray-200 hover:border-blue-300 dark:bg-zinc-800 dark:border-zinc-700 dark:hover:border-blue-500',
      icon: (
        <CheckCircle className='w-4 h-4 text-green-500 dark:text-green-400' />
      ),
      text: 'Normal',
      textColor: 'text-gray-600 dark:text-gray-300',
    };
  };

  const groupedDevices = useMemo(() => {
    const filtered =
      selectedFloor === 'all'
        ? devices
        : devices.filter(d => d.floor === selectedFloor);

    const grouped: Record<number, IDevice[]> = {};
    filtered.forEach(d => {
      if (!grouped[d.floor])  grouped[d.floor] = []; 
      grouped[d.floor].push(d);
    });
    return grouped;
  }, [devices, selectedFloor]);

  const sortedFloors = Object.keys(groupedDevices)
    .map(Number)
    .sort((a, b) => a - b);

  // Initialize collapsed floors (all except first)
  useEffect(() => {
    if (!initializedCollapse && sortedFloors.length > 0) {
      const floorsToCollapse = sortedFloors.slice(1); // All floors except first
      setCollapsedFloors(new Set(floorsToCollapse));
      setInitializedCollapse(true);
    }
  }, [sortedFloors, initializedCollapse]);

  return (
    <div className='w-full bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm h-[600px] flex flex-col'>
      <div className='flex justify-between items-center mb-4'>
        <div className='flex items-center gap-4'>
          <h3 className='text-lg font-semibold'>Live Device Status</h3>
          <label className='flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none'>
            <div className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                className='sr-only peer'
                checked={showIssuesOnly}
                onChange={e => setShowIssuesOnly(e.target.checked)}
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500" />
            </div>
            Show Issues Only
          </label>
        </div>
        <span className='text-xs text-gray-400'>
          {Object.keys(readings).length > 0 ? 'Live' : 'Connecting...'}
        </span>
      </div>

      <div className='flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar'>
        {sortedFloors.map(floor => {
          const floorDevices = groupedDevices[floor].filter(d => {
            if (!showIssuesOnly)  return true; 
            const reading = readings[d._id];
            const status = getStatusInfo(d, reading?.value);
            return status.text !== 'Normal' && status.text !== 'Offline';
          });

          if (showIssuesOnly && floorDevices.length === 0)  return null; 

          const isCollapsed = collapsedFloors.has(floor);

          return (
            <div
              key={floor}
              className='border border-gray-100 dark:border-none rounded-lg overflow-hidden'>
              <div
                className='bg-gray-50 dark:bg-zinc-950 px-4 py-2 flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-900 transition-colors'
                onClick={() => toggleFloor(floor)}>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-200'>
                  Floor {floor}{' '}
                  <span className='text-gray-400 font-normal ml-2'>
                    ({floorDevices.length} devices)
                  </span>
                </h4>
                <span
                  className={`text-gray-400 transform transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'
                    }`}>
                  ▼
                </span>
              </div>

              {!isCollapsed && (
                <div className='p-3 bg-white dark:bg-zinc-900'>
                  <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3'>
                    {floorDevices.map(device => {
                      const reading = readings[device._id];
                      const status = getStatusInfo(device, reading?.value);

                      return (
                        <div
                          key={device._id}
                          onClick={() => onDeviceClick?.(device.room_name)}
                          className={`p-3 rounded-lg border transition-all duration-200 ${status.color} flex flex-col gap-2 cursor-pointer hover:shadow-md`}>
                          <div className='flex justify-between items-start'>
                            <div className='flex items-center gap-2 text-gray-600 dark:text-gray-400'>
                              {getDeviceIcon(device.type)}
                              <span className='text-xs font-medium truncate max-w-20'>
                                {device.room_name}
                              </span>
                            </div>
                            {status.icon}
                          </div>

                          <div className='mt-1'>
                            <div className='text-2xl font-bold text-gray-900 dark:text-white'>
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
              )}
            </div>
          );
        })}

        {sortedFloors.length === 0 && (
          <div className='flex items-center justify-center h-full text-gray-400'>
            No devices found.
          </div>
        )}
      </div>
    </div>
  );
}
