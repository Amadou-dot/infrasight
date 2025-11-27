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

export default function DeviceGrid() {
  const [data, setData] = useState<IDevice[]>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  useEffect(() => {
    fetch('/api/devices').then(res => res.json()).then(setData);
  }, []);

  const columns = useMemo(() => [
    columnHelper.accessor('room_name', {
      header: ({ column }) => {
        return (
          <button
            className="flex items-center gap-1 hover:text-gray-900"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Room Name
            <ArrowUpDown className="w-4 h-4" />
          </button>
        )
      },
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('type', {
      header: 'Type',
      cell: info => <span className="capitalize">{info.getValue()}</span>,
    }),
    columnHelper.accessor('floor', {
      header: 'Floor',
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      cell: info => {
        const status = info.getValue();
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
            status === 'active' ? 'bg-green-100 text-green-700' :
            status === 'offline' ? 'bg-red-100 text-red-700' :
            'bg-yellow-100 text-yellow-700'
          }`}>
            {status}
          </span>
        );
      },
    }),
    columnHelper.accessor('configuration.threshold_critical', {
      header: 'Critical Threshold',
      cell: info => info.getValue(),
    }),
  ], []);

  const table = useReactTable({
    data,
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
    <div className="w-full bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Device Health Grid</h3>
        <input
          value={globalFilter ?? ''}
          onChange={e => setGlobalFilter(e.target.value)}
          placeholder="Search devices..."
          className="p-2 border border-gray-300 rounded-md text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 text-gray-700 uppercase">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="px-6 py-3 font-medium">
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
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-6 py-4">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
