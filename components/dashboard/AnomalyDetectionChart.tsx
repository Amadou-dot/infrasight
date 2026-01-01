'use client';

import { useEffect, useState } from 'react';
import { v2Api, type AnomalyResponse } from '@/lib/api/v2-client';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Loader2 } from 'lucide-react';

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
            limit: 1000,
          }),
          v2Api.analytics.anomalies({
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            limit: 500,
          }),
        ]);

        // Group readings by hour for the chart
        const hourlyBuckets: Map<
          string,
          { normal: number; anomaly: number }
        > = new Map();

        // Initialize buckets for each hour
        for (let i = 0; i < hours; i++) {
          const bucketTime = new Date(
            endDate.getTime() - (hours - 1 - i) * 60 * 60 * 1000
          );
          const key = bucketTime.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          hourlyBuckets.set(key, { normal: 0, anomaly: 0 });
        }

        // Count anomalies per hour
        const anomalies = anomaliesRes.data?.anomalies || [];
        anomalies.forEach((a) => {
          const timestamp = new Date(a.timestamp);
          const key = timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });

          // Find closest bucket
          const bucketKeys = Array.from(hourlyBuckets.keys());
          let closestKey = bucketKeys[0];
          for (const bKey of bucketKeys) {
            closestKey = bKey;
            // Simple matching by hour
            if (key.slice(0, 2) === bKey.slice(0, 2)) {
              break;
            }
          }

          const bucket = hourlyBuckets.get(closestKey);
          if (bucket) {
            bucket.anomaly += 1;
          }
        });

        // Calculate normal readings (total minus anomalies)
        // Since we don't have exact totals per hour, we'll simulate based on total
        const totalReadings = readingsRes.pagination?.total || 100;
        const avgReadingsPerHour = Math.floor(totalReadings / hours);

        hourlyBuckets.forEach((bucket) => {
          // Normal readings = estimated total - anomalies
          bucket.normal = Math.max(0, avgReadingsPerHour - bucket.anomaly);
        });

        // Convert to chart data
        const chartData: ChartDataPoint[] = Array.from(
          hourlyBuckets.entries()
        ).map(([time, counts]) => ({
          time,
          normal: counts.normal,
          anomaly: counts.anomaly,
        }));

        setData(chartData);
        setError(null);
      } catch (err) {
        console.error('Error fetching anomaly data:', err);
        setError('Failed to load data');
      } finally {
        if (showLoading) setLoading(false);
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
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#94a3b8' }}
              itemStyle={{ color: '#fff' }}
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
