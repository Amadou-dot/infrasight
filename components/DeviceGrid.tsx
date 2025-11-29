'use client';

import { useEffect, useState, useMemo } from 'react';
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
import { ArrowUpDown } from 'lucide-react';

const columnHelper = createColumnHelper<IDevice>();

interface DeviceGridProps {
  selectedFloor: number | 'all';
  selectedRoom?: string | 'all';
}

interface Reading {
  _id: string; // device_id
  value: number;
  timestamp: string;
  type: string;
}

export default function DeviceGrid({
  selectedFloor,
  selectedRoom = 'all',
}: DeviceGridProps) {
  const [data, setData] = useState<IDevice[]>([]);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

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

    if (data.length > 0) {
      fetchReadings();
      const interval = setInterval(fetchReadings, 2000);
      return () => clearInterval(interval);
    }
  }, [data]);

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

          let statusColor = 'bg-gray-400';
          let statusText = 'Unknown';

          if (device.status === 'offline') {
            statusColor = 'bg-gray-400';
            statusText = 'Offline';
          } else if (reading) {
            if (reading.value > device.configuration.threshold_critical) {
              statusColor = 'bg-red-500';
              statusText = 'Critical';
            } else if (reading.value > device.configuration.threshold_warning) {
              statusColor = 'bg-yellow-400';
              statusText = 'Warning';
            } else {
              statusColor = 'bg-green-500';
              statusText = 'OK';
            }
          } else {
            statusColor = 'bg-green-500'; // Default active
            statusText = 'Active';
          }

          return (
            <div className='flex items-center gap-2'>
              <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
              <span className='text-sm text-gray-600 capitalize'>
                {statusText}
              </span>
            </div>
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
    <div className='w-full bg-white rounded-xl border border-gray-200 p-6 shadow-sm'>
      <div className='flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4'>
        <h3 className='text-lg font-semibold'>Device Health Grid</h3>

        <div className='flex flex-wrap gap-2 w-full md:w-auto'>
          {/* Search */}
          <input
            value={globalFilter ?? ''}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder='Search...'
            className='p-2 border border-gray-300 rounded-md text-sm w-full md:w-48 focus:outline-none focus:ring-2 focus:ring-blue-500'
          />

          {/* Room Filter */}
          <select
            value={filterRoom}
            onChange={e => setFilterRoom(e.target.value)}
            className='p-2 border border-gray-300 rounded-md text-sm w-full md:w-32 focus:outline-none focus:ring-2 focus:ring-blue-500'>
            <option value='all'>All Rooms</option>
            {rooms.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {/* Type Filter */}
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className='p-2 border border-gray-300 rounded-md text-sm w-full md:w-32 focus:outline-none focus:ring-2 focus:ring-blue-500'>
            <option value='all'>All Types</option>
            {types.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className='p-2 border border-gray-300 rounded-md text-sm w-full md:w-32 focus:outline-none focus:ring-2 focus:ring-blue-500'>
            <option value='all'>All Status</option>
            <option value='active'>Active</option>
            <option value='offline'>Offline</option>
            <option value='maintenance'>Maintenance</option>
          </select>
        </div>
      </div>

      <div className='overflow-x-auto'>
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
