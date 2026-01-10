'use client';

import { v2Api } from '@/lib/api/v2-client';
import { useAnomalies } from '@/lib/query/hooks';
import { Loader2 } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

interface ChartDataPoint {
  time: string;
  normal: number;
  anomaly: number;
}

interface AnomalyDetectionChartProps {
  hours?: number;
}

export default function AnomalyDetectionChart({
  hours = 6,
}: AnomalyDetectionChartProps) {
  // Calculate time range - memoize to prevent infinite re-renders
  // Round to nearest minute to avoid constant changes
  const { startDateISO, endDateISO, startDate } = useMemo(() => {
    const now = new Date();
    // Round down to nearest minute to stabilize the value
    now.setSeconds(0, 0);
    const end = now;
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    return {
      startDateISO: start.toISOString(),
      endDateISO: end.toISOString(),
      startDate: start,
    };
  }, [hours]);

  // Fetch anomalies with React Query
  const { data: anomaliesData, isLoading, error: fetchError } = useAnomalies({
    startDate: startDateISO,
    endDate: endDateISO,
    limit: 1000,
  });

  const error = fetchError ? 'Failed to load data' : null;

  // Fetch readings total for normal count calculation (still need this one call)
  const [totalReadings, setTotalReadings] = useState(0);

  useEffect(() => {
    const fetchReadingsTotal = async () => {
      try {
        const readingsRes = await v2Api.readings.list({
          startDate: startDateISO,
          endDate: endDateISO,
          limit: 1,
        });
        setTotalReadings(readingsRes.pagination?.total || 0);
      } catch {
        // Ignore errors, will default to 0
      }
    };
    fetchReadingsTotal();
  }, [startDateISO, endDateISO]);

  // Process chart data
  const data = useMemo(() => {
    if (!anomaliesData) return [];

    const anomalies = anomaliesData.anomalies || [];

        // Create hourly buckets using epoch hour as key for reliable matching
        const hourlyBuckets: Map<number, { time: string; normal: number; anomaly: number }> = new Map();

        // Initialize buckets for each hour (including current hour)
        for (let i = 0; i <= hours; i++) {
          const bucketTime = new Date(startDate.getTime() + i * 60 * 60 * 1000);
          // Use epoch hour as key (floor to hour)
          const epochHour = Math.floor(bucketTime.getTime() / (60 * 60 * 1000));
          const timeLabel = bucketTime.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          hourlyBuckets.set(epochHour, { time: timeLabel, normal: 0, anomaly: 0 });
        }

    // Count anomalies per hour
    anomalies.forEach((a) => {
      const timestamp = new Date(a.timestamp);
      const epochHour = Math.floor(timestamp.getTime() / (60 * 60 * 1000));

      const bucket = hourlyBuckets.get(epochHour);
      if (bucket) bucket.anomaly += 1;
    });

    // Calculate normal readings per bucket (distribute evenly)
    const totalAnomalies = anomaliesData.pagination?.total || anomalies.length;
    const totalNormal = Math.max(0, totalReadings - totalAnomalies);
    const bucketCount = hourlyBuckets.size;
    const avgNormalPerHour = Math.floor(totalNormal / bucketCount);

    hourlyBuckets.forEach((bucket) => {
      bucket.normal = avgNormalPerHour;
    });

    // Convert to chart data (sorted by time, take last 'hours' buckets)
    const chartData: ChartDataPoint[] = Array.from(hourlyBuckets.entries())
      .sort(([a], [b]) => a - b)
      .slice(-hours) // Take only the last N hours
      .map(([, bucket]) => ({
        time: bucket.time,
        normal: bucket.normal,
        anomaly: bucket.anomaly,
      }));

    return chartData;
  }, [anomaliesData, totalReadings, hours, startDate]);

  if (isLoading) 
    return (
      <div className="bg-card border border-border rounded-xl p-6 h-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Anomaly Detection
            </h3>
            <p className="text-sm text-muted-foreground">
              Network traffic analysis over last {hours} hours
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
            <h3 className="text-lg font-semibold text-foreground">
              Anomaly Detection
            </h3>
            <p className="text-sm text-muted-foreground">
              Network traffic analysis over last {hours} hours
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
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#a1a1aa', fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#a1a1aa', fontSize: 12 }}
            />
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
            <Bar
              dataKey="normal"
              fill="#06b6d4"
              radius={[4, 4, 0, 0]}
              name="Normal"
            />
            <Bar
              dataKey="anomaly"
              fill="#ef4444"
              radius={[4, 4, 0, 0]}
              name="Anomaly"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
