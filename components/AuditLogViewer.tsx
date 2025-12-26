'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';

interface AuditLogEntry {
  timestamp: string;
  action: string;
  user: string;
  changes?: Record<string, unknown>;
}

interface AuditLogViewerProps {
  deviceId: string;
  entries: AuditLogEntry[];
  loading?: boolean;
}

export default function AuditLogViewer({
  deviceId: _deviceId,
  entries,
  loading = false,
}: AuditLogViewerProps) {
  const [filter, setFilter] = useState<'all' | 'created' | 'updated' | 'deleted'>('all');

  const filteredEntries = entries.filter((entry) => {
    if (filter === 'all') return true;
    return entry.action.toLowerCase().includes(filter);
  });

  const getActionBadge = (action: string) => {
    const lowerAction = action.toLowerCase();
    if (lowerAction.includes('create')) 
      return <Badge className="bg-green-500">Created</Badge>;
    
    if (lowerAction.includes('update')) 
      return <Badge className="bg-blue-500">Updated</Badge>;
    
    if (lowerAction.includes('delete')) 
      return <Badge variant="destructive">Deleted</Badge>;
    
    return <Badge variant="secondary">{action}</Badge>;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) 
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded-md text-sm transition-colors ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          All ({entries.length})
        </button>
        <button
          onClick={() => setFilter('created')}
          className={`px-3 py-1 rounded-md text-sm transition-colors ${
            filter === 'created'
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          Created
        </button>
        <button
          onClick={() => setFilter('updated')}
          className={`px-3 py-1 rounded-md text-sm transition-colors ${
            filter === 'updated'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          Updated
        </button>
        <button
          onClick={() => setFilter('deleted')}
          className={`px-3 py-1 rounded-md text-sm transition-colors ${
            filter === 'deleted'
              ? 'bg-red-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          Deleted
        </button>
      </div>

      {/* Audit log entries */}
      {filteredEntries.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No audit log entries found
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {filteredEntries.map((entry, index) => (
            <div
              key={index}
              className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1">
                  {getActionBadge(entry.action)}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTimestamp(entry.timestamp)}
                </span>
              </div>

              <div className="space-y-1">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  By:{' '}
                  <span className="font-medium text-gray-900 dark:text-white">
                    {entry.user}
                  </span>
                </p>

                {entry.changes && Object.keys(entry.changes).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-sm text-blue-600 dark:text-blue-400 cursor-pointer hover:underline">
                      View changes
                    </summary>
                    <pre className="mt-2 p-2 bg-gray-900 dark:bg-black text-gray-100 rounded text-xs overflow-x-auto">
                      {JSON.stringify(entry.changes, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
