'use client';

import { v2Api } from '@/lib/api/v2-client';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async (showLoading = false) => {
      try {
        if (showLoading) setLoading(true);

        // Calculate time range
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000);

        // Fetch readings to get total counts and anomaly data
        const [readingsRes, anomaliesRes] = await Promise.all([
          v2Api.readings.list({
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            limit: 1, // We only need the total count
          }),
          v2Api.analytics.anomalies({
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            limit: 1000, // Fetch more anomalies to get accurate counts
          }),
        ]);

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
        const anomalies = anomaliesRes.data?.anomalies || [];
        anomalies.forEach((a) => {
          const timestamp = new Date(a.timestamp);
          const epochHour = Math.floor(timestamp.getTime() / (60 * 60 * 1000));

          const bucket = hourlyBuckets.get(epochHour);
          if (bucket) {
            bucket.anomaly += 1;
          }
        });

        // Calculate normal readings per bucket (distribute evenly)
        const totalReadings = readingsRes.pagination?.total || 0;
        const totalAnomalies = anomaliesRes.data?.pagination?.total || anomalies.length;
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

        setData(chartData);
        setError(null);
      } catch (err) {
        console.error('Error fetching anomaly data:', err);
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData(true);
    const interval = setInterval(() => fetchData(false), 60000);
    return () => clearInterval(interval);
  }, [hours]);

  if (loading) {
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
  }

  if (error) {
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
  }

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
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
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
