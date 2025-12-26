'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { v2Api, type AnomalyData } from '@/lib/api/v2-client';
import {
  AlertTriangle,
  Battery,
  Clock,
  TrendingUp,
  Zap,
} from 'lucide-react';

interface AlertsPanelProps {
  onDeviceClick?: (deviceId: string) => void;
  maxAlerts?: number;
}

export default function AlertsPanel({
  onDeviceClick,
  maxAlerts = 10,
}: AlertsPanelProps) {
  const [anomalies, setAnomalies] = useState<AnomalyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnomalies = async (showLoading = false) => {
      try {
        if (showLoading) 
          setLoading(true);
        
        setError(null);
        const response = await v2Api.analytics.anomalies({
          limit: maxAlerts,
        });
        // Extract anomalies array from the response object
        setAnomalies(response.data.anomalies || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load alerts');
        console.error('Error fetching anomalies:', err);
      } finally {
        if (showLoading) 
          setLoading(false);
        
      }
    };

    // Show loading only on initial fetch
    fetchAnomalies(true);

    // Refresh every 30 seconds without loading spinner
    const interval = setInterval(() => fetchAnomalies(false), 30000);
    return () => clearInterval(interval);
  }, [maxAlerts]);

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'power':
      case 'energy':
        return <Zap className="h-4 w-4 text-yellow-500" />;
      case 'temperature':
        return <TrendingUp className="h-4 w-4 text-red-500" />;
      case 'battery':
        return <Battery className="h-4 w-4 text-orange-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
    }
  };

  const getAlertSeverity = (score?: number) => {
    if (!score) return 'medium';
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive">Critical</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500">Warning</Badge>;
      case 'low':
        return <Badge variant="outline">Info</Badge>;
      default:
        return <Badge>{severity}</Badge>;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) 
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Recent Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </CardContent>
      </Card>
    );
  

  if (error) 
    return (
      <Card className="w-full border-red-200 dark:border-red-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Alerts - Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </CardContent>
      </Card>
    );
  

  return (
    <Card className='w-full h-full flex flex-col'>
      <CardHeader>
        <CardTitle className='flex items-center justify-between'>
          <span className='flex items-center gap-2'>
            <AlertTriangle className='h-5 w-5' />
            Recent Alerts
          </span>
          {anomalies.length > 0 && (
            <Badge variant='destructive' className='ml-2'>
              {anomalies.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className='flex-1 flex flex-col min-h-0'>
        {anomalies.length === 0 ? (
          <div className='text-center py-8'>
            <div className='inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 mb-4'>
              <Clock className='h-8 w-8 text-green-600 dark:text-green-400' />
            </div>
            <p className='text-gray-600 dark:text-gray-400'>
              No anomalies detected
            </p>
            <p className='text-sm text-gray-500 dark:text-gray-500 mt-1'>
              All systems operating normally
            </p>
          </div>
        ) : (
          <div className='space-y-3 overflow-y-auto flex-1'>
            {anomalies.map((anomaly, index) => {
              const severity = getAlertSeverity(anomaly.quality.anomaly_score);
              return (
                <button
                  key={index}
                  onClick={() => onDeviceClick?.(anomaly.metadata.device_id)}
                  className='w-full text-left p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors'>
                  <div className='flex items-start justify-between gap-2 mb-2'>
                    <div className='flex items-center gap-2'>
                      {getAlertIcon(anomaly.metadata.type)}
                      <span className='font-medium text-gray-900 dark:text-white'>
                        {anomaly.metadata.device_id}
                      </span>
                    </div>
                    {getSeverityBadge(severity)}
                  </div>

                  <div className='space-y-1'>
                    <div className='flex items-center justify-between text-sm'>
                      <span className='text-gray-600 dark:text-gray-400'>
                        {anomaly.metadata.type.charAt(0).toUpperCase() +
                          anomaly.metadata.type.slice(1)}{' '}
                        anomaly
                      </span>
                      <span className='text-gray-500 dark:text-gray-500'>
                        {formatTimestamp(anomaly.timestamp)}
                      </span>
                    </div>

                    <div className='flex items-center justify-between text-sm'>
                      <span className='text-gray-600 dark:text-gray-400'>
                        Value:{' '}
                        <span className='font-medium text-gray-900 dark:text-white'>
                          {anomaly.value.toFixed(2)}
                        </span>
                      </span>
                      {anomaly.quality.anomaly_score !== undefined && (
                        <span className='text-gray-600 dark:text-gray-400'>
                          Score:{' '}
                          <span className='font-medium text-gray-900 dark:text-white'>
                            {(anomaly.quality.anomaly_score * 100).toFixed(0)}%
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
