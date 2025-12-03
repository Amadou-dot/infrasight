'use client';

import { useEffect, useState, useMemo } from 'react';
import { getPusherClient } from '@/lib/pusher-client';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import { IDevice } from '@/models/Device';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Thermometer,
  Droplet,
  Zap,
  Users,
  Activity,
  Check,
  ChevronsUpDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const columnHelper = createColumnHelper<IDevice>();

interface DeviceGridProps {
  selectedFloor: number | 'all';
  selectedRoom?: string | 'all';
  onClearRoomFilter?: () => void;
}

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

export default function DeviceGrid({
  selectedFloor,
  selectedRoom = 'all',
  onClearRoomFilter,
}: DeviceGridProps) {
  const [data, setData] = useState<IDevice[]>([]);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  // Mobile state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [openRoomCombobox, setOpenRoomCombobox] = useState(false);

  // Reset filters when floor changes
  useEffect(() => {
    setFilterRoom('all');
    setFilterType('all');
  }, [selectedFloor]);

  // Sync selectedRoom prop with internal filter
  useEffect(() => {
    if (selectedRoom && selectedRoom !== 'all') {
      setFilterRoom(selectedRoom);
    } else if (selectedRoom === 'all') {
      setFilterRoom('all');
    }
  }, [selectedRoom]);

  // Advanced filters
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // Metadata options
  const rooms = useMemo(() => {
    const filtered =
      selectedFloor === 'all'
        ? data
        : data.filter(d => d.floor === selectedFloor);
    return Array.from(new Set(filtered.map(d => d.room_name))).sort();
  }, [data, selectedFloor]);

  const types = useMemo(() => {
    const filtered =
      selectedFloor === 'all'
        ? data
        : data.filter(d => d.floor === selectedFloor);
    return Array.from(new Set(filtered.map(d => d.type))).sort();
  }, [data, selectedFloor]);

  useEffect(() => {
    fetch('/api/devices')
      .then(res => res.json())
      .then(setData);
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

    if (data.length > 0) {
      fetchReadings();
    }
  }, [data]);

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

  const filteredData = useMemo(() => {
    return data.filter(device => {
      // Floor filter
      if (selectedFloor !== 'all' && device.floor !== selectedFloor)
        return false;

      // Advanced filters
      if (filterRoom !== 'all' && device.room_name !== filterRoom) return false;
      if (filterType !== 'all' && device.type !== filterType) return false;
      if (filterStatus !== 'all' && device.status !== filterStatus)
        return false;

      return true;
    });
  }, [data, selectedFloor, filterRoom, filterType, filterStatus]);

  const toggleCard = (id: string) => {
    const newExpanded = new Set(expandedCards);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedCards(newExpanded);
  };

  const getDeviceIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'temperature':
        return <Thermometer className='w-4 h-4' />;
      case 'humidity':
        return <Droplet className='w-4 h-4' />;
      case 'power':
        return <Zap className='w-4 h-4' />;
      case 'occupancy':
        return <Users className='w-4 h-4' />;
      default:
        return <Activity className='w-4 h-4' />;
    }
  };

  const getStatusColor = (
    status: string,
    reading?: Reading,
    device?: IDevice
  ) => {
    if (status === 'offline')
      return 'bg-gray-100 text-gray-600 border-gray-200';

    if (reading && device) {
      if (reading.value > device.configuration.threshold_critical)
        return 'bg-red-100 text-red-700 border-red-200';
      if (reading.value > device.configuration.threshold_warning)
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    }
    return 'bg-green-100 text-green-700 border-green-200';
  };

  const getStatusLabel = (
    status: string,
    reading?: Reading,
    device?: IDevice
  ) => {
    if (status === 'offline') return 'Offline';
    if (reading && device) {
      if (reading.value > device.configuration.threshold_critical)
        return 'Critical';
      if (reading.value > device.configuration.threshold_warning)
        return 'Warning';
    }
    return 'OK';
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('room_name', {
        header: ({ column }) => {
          return (
            <button
              className='flex items-center gap-1 hover:text-gray-900'
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === 'asc')
              }>
              Room Name
              <ArrowUpDown className='w-4 h-4' />
            </button>
          );
        },
        cell: info => <span className='font-medium'>{info.getValue()}</span>,
      }),
      columnHelper.accessor('floor', {
        header: 'Floor',
        cell: info => info.getValue(),
      }),
      columnHelper.accessor('type', {
        header: 'Type',
        cell: info => <span className='capitalize'>{info.getValue()}</span>,
      }),
      columnHelper.display({
        id: 'status',
        header: 'Status',
        cell: info => {
          const device = info.row.original;
          const reading = readings[device._id];
          const statusColor = getStatusColor(device.status, reading, device);
          const statusText = getStatusLabel(device.status, reading, device);

          return (
            <Badge variant='outline' className={`${statusColor} border`}>
              {statusText}
            </Badge>
          );
        },
      }),
      columnHelper.display({
        id: 'current_value',
        header: 'Current Value',
        cell: info => {
          const device = info.row.original;
          const reading = readings[device._id];
          if (!reading) return <span className='text-gray-400'>--</span>;

          let unit = '';
          if (device.type === 'temperature') unit = '°F';
          if (device.type === 'humidity') unit = '%';
          if (device.type === 'power') unit = ' kW';

          return (
            <span className='font-mono font-medium text-gray-900'>
              {reading.value}
              {unit}
            </span>
          );
        },
      }),
      columnHelper.accessor('configuration.threshold_critical', {
        header: 'Critical Threshold',
        cell: info => {
          const device = info.row.original;
          let unit = '';
          if (device.type === 'temperature') unit = '°F';
          if (device.type === 'humidity') unit = '%';
          if (device.type === 'power') unit = ' kW';
          return (
            <span className='text-gray-500'>
              {info.getValue()}
              {unit}
            </span>
          );
        },
      }),
    ],
    [readings]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className='w-full space-y-4'>
      {/* Mobile/Desktop Filters */}
      <div className='bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col md:flex-row gap-4 justify-between'>
        <div className='flex flex-col gap-2 w-full md:w-auto'>
          <h3 className='text-lg font-semibold flex items-center gap-2'>
            Device Health
            {selectedRoom && selectedRoom !== 'all' && (
              <Badge
                variant='secondary'
                className='bg-blue-50 text-blue-700 hover:bg-blue-100 gap-1'>
                {selectedRoom}
                <button
                  onClick={onClearRoomFilter}
                  className='ml-1 hover:text-blue-900'>
                  <span className='sr-only'>Clear</span>×
                </button>
              </Badge>
            )}
          </h3>

          {/* Pill Filters */}
          <div className='flex flex-wrap gap-2'>
            <Button
              variant={filterType === 'all' ? 'default' : 'outline'}
              size='sm'
              onClick={() => setFilterType('all')}
              className='h-7 text-xs'>
              All Types
            </Button>
            {types.map(t => (
              <Button
                key={t}
                variant={filterType === t ? 'default' : 'outline'}
                size='sm'
                onClick={() => setFilterType(filterType === t ? 'all' : t)}
                className='h-7 text-xs capitalize'>
                {t}
              </Button>
            ))}
          </div>
        </div>

        <div className='flex flex-col md:flex-row gap-2 w-full md:w-auto'>
          {/* Room Autocomplete */}
          <Popover open={openRoomCombobox} onOpenChange={setOpenRoomCombobox}>
            <PopoverTrigger asChild>
              <Button
                variant='outline'
                role='combobox'
                aria-expanded={openRoomCombobox}
                className='w-full md:w-[200px] justify-between'>
                {filterRoom === 'all' ? 'Select room...' : filterRoom}
                <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-[200px] p-0'>
              <Command>
                <CommandInput placeholder='Search room...' />
                <CommandList>
                  <CommandEmpty>No room found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value='all'
                      onSelect={() => {
                        setFilterRoom('all');
                        setOpenRoomCombobox(false);
                      }}>
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          filterRoom === 'all' ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      All Rooms
                    </CommandItem>
                    {rooms.map(room => (
                      <CommandItem
                        key={room}
                        value={room}
                        onSelect={currentValue => {
                          setFilterRoom(
                            currentValue === filterRoom ? 'all' : currentValue
                          );
                          setOpenRoomCombobox(false);
                        }}>
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            filterRoom === room ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        {room}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {/* Status Filter */}
          <div className='flex gap-2'>
            <Button
              variant={filterStatus === 'all' ? 'secondary' : 'outline'}
              size='sm'
              onClick={() => setFilterStatus('all')}
              className='flex-1 md:flex-none'>
              All Status
            </Button>
            <Button
              variant={filterStatus === 'active' ? 'secondary' : 'outline'}
              size='sm'
              onClick={() =>
                setFilterStatus(filterStatus === 'active' ? 'all' : 'active')
              }
              className='flex-1 md:flex-none'>
              Active
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile/Tablet Card Layout */}
      <div className='lg:hidden grid grid-cols-1 md:grid-cols-2 gap-4'>
        {filteredData.map(device => {
          const reading = readings[device._id];
          const statusColor = getStatusColor(device.status, reading, device);
          const statusText = getStatusLabel(device.status, reading, device);
          const isExpanded = expandedCards.has(device._id);

          // Adaptive behavior: Dim if occupancy is 0
          const isDimmed = device.type === 'occupancy' && reading?.value === 0;
          // Pulse if critical
          const isCritical = statusText === 'Critical';

          return (
            <Card
              key={device._id}
              className={cn(
                'transition-all duration-300',
                isDimmed && 'opacity-60 grayscale',
                isCritical && 'animate-pulse ring-2 ring-red-200'
              )}>
              <CardHeader className='p-4 pb-2'>
                <div className='flex justify-between items-start'>
                  <div>
                    <CardTitle className='text-base font-medium flex items-center gap-2'>
                      {device.room_name}
                      <span className='text-xs font-normal text-gray-500'>
                        Floor {device.floor}
                      </span>
                    </CardTitle>
                    <div className='flex items-center gap-2 mt-1 text-sm text-gray-600'>
                      {getDeviceIcon(device.type)}
                      <span className='capitalize'>{device.type}</span>
                    </div>
                  </div>
                  <Badge variant='outline' className={`${statusColor} border`}>
                    {statusText}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className='p-4 pt-2'>
                <div className='flex justify-between items-end'>
                  <div>
                    <p className='text-xs text-gray-500 uppercase tracking-wider'>
                      Current
                    </p>
                    <p className='text-2xl font-mono font-bold'>
                      {reading ? (
                        <>
                          {reading.value}
                          <span className='text-sm font-normal text-gray-500 ml-1'>
                            {device.type === 'temperature'
                              ? '°F'
                              : device.type === 'humidity'
                              ? '%'
                              : device.type === 'power'
                              ? 'kW'
                              : ''}
                          </span>
                        </>
                      ) : (
                        '--'
                      )}
                    </p>
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => toggleCard(device._id)}
                    className='h-8 w-8 p-0'>
                    {isExpanded ? (
                      <ChevronUp className='h-4 w-4' />
                    ) : (
                      <ChevronDown className='h-4 w-4' />
                    )}
                  </Button>
                </div>

                {isExpanded && (
                  <div className='mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-200'>
                    <div>
                      <p className='text-xs text-gray-500'>
                        Critical Threshold
                      </p>
                      <p className='font-mono text-sm'>
                        {device.configuration.threshold_critical}
                      </p>
                    </div>
                    <div>
                      <p className='text-xs text-gray-500'>Warning Threshold</p>
                      <p className='font-mono text-sm'>
                        {device.configuration.threshold_warning}
                      </p>
                    </div>
                    <div className='col-span-2'>
                      <p className='text-xs text-gray-500'>Last Updated</p>
                      <p className='text-sm'>
                        {reading
                          ? new Date(reading.timestamp).toLocaleTimeString()
                          : 'Never'}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filteredData.length === 0 && (
          <div className='text-center py-8 text-gray-500'>
            No devices found matching filters.
          </div>
        )}
      </div>

      {/* Desktop Table Layout */}
      <div className='hidden lg:block bg-white rounded-xl border border-gray-200 p-6 shadow-sm overflow-x-auto'>
        <table className='w-full text-sm text-left'>
          <thead className='bg-gray-50 text-gray-700 uppercase'>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className='px-6 py-3 font-medium whitespace-nowrap'>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map(row => (
                <tr
                  key={row.id}
                  className='border-b border-gray-100 hover:bg-gray-50'>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className='px-6 py-4 whitespace-nowrap'>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className='px-6 py-8 text-center text-gray-500'>
                  No devices found matching filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
