'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { v2Api } from '@/lib/api/v2-client';
import type { TemperatureCorrelationResponse } from '@/types/v2';
import { AlertCircle, Thermometer, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// ============================================================================
// TYPES
// ============================================================================

interface TemperatureCorrelationPanelProps {
  deviceId: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function TemperatureCorrelationPanel({
  deviceId,
}: TemperatureCorrelationPanelProps) {
  const [correlation, setCorrelation] = useState<TemperatureCorrelationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch correlation data
  const fetchCorrelation = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await v2Api.analytics.temperatureCorrelation({ device_id: deviceId });
      setCorrelation(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load temperature data');
      console.error('Temperature correlation error:', err);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  // Fetch on mount
  useEffect(() => {
    fetchCorrelation();
  }, [fetchCorrelation]);

  // Get diagnosis icon and color
  const getDiagnosisStyle = (diagnosis: string) => {
    switch (diagnosis) {
      case 'device_failure':
        return {
          icon: <AlertCircle className="h-5 w-5" />,
          colorClass: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-500',
          badge: 'destructive' as const,
        };
      case 'environmental':
        return {
          icon: <AlertTriangle className="h-5 w-5" />,
          colorClass:
            'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-500',
          badge: 'secondary' as const,
        };
      case 'normal':
        return {
          icon: <CheckCircle className="h-5 w-5" />,
          colorClass:
            'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-500',
          badge: 'secondary' as const,
        };
      default:
        return {
          icon: <Thermometer className="h-5 w-5" />,
          colorClass:
            'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20 border-gray-500',
          badge: 'secondary' as const,
        };
    }
  };

  // Get diagnosis explanation
  const getDiagnosisExplanation = (diagnosis: string): string => {
    switch (diagnosis) {
      case 'device_failure':
        return 'Device is overheating while ambient temperature is normal. This indicates a potential device failure or cooling system malfunction. Schedule immediate inspection.';
      case 'environmental':
        return 'Both device and ambient temperatures are elevated. The issue is likely environmental (room HVAC failure). Check building climate control.';
      case 'normal':
        return 'Device temperature is within normal operating range and correlates with ambient temperature. No action required.';
      default:
        return 'Temperature analysis unavailable.';
    }
  };

  // Format chart data
  const chartData = correlation
    ? correlation.device_temp_series.map((devicePoint, index) => {
        const ambientPoint = correlation.ambient_temp_series[index];
        return {
          timestamp: new Date(devicePoint.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          deviceTemp: devicePoint.value,
          ambientTemp: ambientPoint?.value || null,
        };
      })
    : [];

  // Loading state
  if (loading)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Thermometer className="h-5 w-5" />
            Temperature Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );

  // Error state
  if (error || !correlation)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Thermometer className="h-5 w-5" />
            Temperature Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {error || 'Insufficient temperature data for correlation analysis'}
            </p>
            <Button variant="outline" size="sm" onClick={fetchCorrelation} className="mt-4">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );

  const diagnosisStyle = getDiagnosisStyle(correlation.diagnosis);
  const currentDeviceTemp =
    correlation.device_temp_series[correlation.device_temp_series.length - 1]?.value || 0;
  const currentAmbientTemp =
    correlation.ambient_temp_series[correlation.ambient_temp_series.length - 1]?.value || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Thermometer className="h-5 w-5" />
            Temperature Analysis
          </div>
          <Badge variant={diagnosisStyle.badge}>
            {correlation.diagnosis.replace('_', ' ').toUpperCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Readings */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Device Temperature</p>
            <p className="text-2xl font-bold">{currentDeviceTemp.toFixed(1)}°C</p>
            <div className="h-2 bg-linear-to-r from-blue-200 via-amber-200 to-red-500 rounded-full">
              <div
                className="h-full bg-red-600 rounded-full"
                style={{ width: `${Math.min((currentDeviceTemp / 100) * 100, 100)}%` }}
              />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Ambient Temperature</p>
            <p className="text-2xl font-bold">{currentAmbientTemp.toFixed(1)}°C</p>
            <div className="h-2 bg-linear-to-r from-blue-200 via-amber-200 to-red-500 rounded-full">
              <div
                className="h-full bg-blue-600 rounded-full"
                style={{ width: `${Math.min((currentAmbientTemp / 100) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                label={{ value: '°C', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="deviceTemp"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                name="Device Temp"
              />
              <Line
                type="monotone"
                dataKey="ambientTemp"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Ambient Temp"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Correlation Score */}
        {correlation.correlation_score !== null && (
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Correlation Score:{' '}
              <span className="font-medium">{correlation.correlation_score.toFixed(2)}</span>
            </span>
          </div>
        )}

        {/* Diagnosis */}
        <div className={`border-l-4 ${diagnosisStyle.colorClass} p-4 rounded-r-lg`}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5">{diagnosisStyle.icon}</div>
            <div className="flex-1">
              <p className="font-semibold mb-1">
                {correlation.diagnosis.replace('_', ' ').toUpperCase()}
              </p>
              <p className="text-sm text-muted-foreground">
                {getDiagnosisExplanation(correlation.diagnosis)}
              </p>
            </div>
          </div>
        </div>

        {/* Threshold Breaches */}
        {correlation.threshold_breaches.length > 0 && (
          <div className="pt-4 border-t">
            <p className="text-sm font-medium mb-2">
              ⚠️ {correlation.threshold_breaches.length} Threshold Breach(es) Detected
            </p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {correlation.threshold_breaches.slice(0, 3).map((breach, index) => (
                <div key={index} className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>
                    {new Date(breach.timestamp).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span>•</span>
                  <span>Device: {breach.device_temp.toFixed(1)}°C</span>
                  <span>•</span>
                  <span>Ambient: {breach.ambient_temp.toFixed(1)}°C</span>
                </div>
              ))}
              {correlation.threshold_breaches.length > 3 && (
                <p className="text-xs text-muted-foreground">
                  + {correlation.threshold_breaches.length - 3} more breaches
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
