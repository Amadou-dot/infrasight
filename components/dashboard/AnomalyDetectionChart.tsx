'use client';

import { useAnomalies, useEnergyAnalytics } from '@/lib/query/hooks';
import { buildAnomalyDetectionChartData } from '@/lib/utils/anomaly-chart';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface AnomalyDetectionChartProps {
  hours?: number;
}

export default function AnomalyDetectionChart({ hours = 6 }: AnomalyDetectionChartProps) {
  // Calculate time range - memoize to prevent infinite re-renders
  // Round to nearest minute to avoid constant changes
  const { startDateISO, endDateISO, endDate } = useMemo(() => {
    const now = new Date();
    // Round down to nearest minute to stabilize the value
    now.setSeconds(0, 0);
    const end = now;
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    return {
      startDateISO: start.toISOString(),
      endDateISO: end.toISOString(),
      endDate: end,
    };
  }, [hours]);

  // Fetch anomalies with React Query
  const {
    data: anomaliesData,
    isLoading: isLoadingAnomalies,
    error: fetchError,
  } = useAnomalies({
    startDate: startDateISO,
    endDate: endDateISO,
    bucketGranularity: 'hour',
    limit: 1,
  });

  const {
    data: totalReadingsData,
    isLoading: isLoadingTotals,
    error: totalsError,
  } = useEnergyAnalytics({
    startDate: startDateISO,
    endDate: endDateISO,
    granularity: 'hour',
    aggregationType: 'count',
    includeInvalid: true,
  });

  const isLoading = isLoadingAnomalies || isLoadingTotals;
  const error = fetchError || totalsError ? 'Failed to load data' : null;

  // Process chart data
  const data = useMemo(() => {
    return buildAnomalyDetectionChartData({
      endDate,
      hours,
      totals: totalReadingsData?.results || [],
      trends: anomaliesData?.trends || [],
    });
  }, [anomaliesData?.trends, totalReadingsData?.results, endDate, hours]);

  if (isLoading)
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Anomaly Detection</h3>
            <p className="text-sm text-muted-foreground">
              Sensor anomaly analysis over last {hours} hours
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );

  if (error)
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Anomaly Detection</h3>
            <p className="text-sm text-muted-foreground">
              Sensor anomaly analysis over last {hours} hours
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center h-48">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      </div>
    );

  return (
    <div className="bg-card border border-border rounded-xl p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Anomaly Detection</h3>
          <p className="text-sm text-muted-foreground">
            Sensor readings analysis over last {hours} hours
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cyan-500" />
            <span className="text-muted-foreground">Normal</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-muted-foreground">Anomaly</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-62.5 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#a1a1aa', fontSize: 12 }}
            />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#a1a1aa', fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                color: 'hsl(var(--foreground))',
              }}
              labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
              itemStyle={{ color: 'hsl(var(--foreground))' }}
              cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
            />
            <Bar dataKey="normal" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Normal" />
            <Bar dataKey="anomaly" fill="#ef4444" radius={[4, 4, 0, 0]} name="Anomaly" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
