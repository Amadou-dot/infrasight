import type { AnomalyTrendPoint, EnergyAnalyticsResult } from '../api/v2-client';

const HOUR_IN_MS = 60 * 60 * 1000;

export interface AnomalyChartDataPoint {
  time: string;
  normal: number;
  anomaly: number;
  timestamp: string;
}

function parseTimeBucket(value: string) {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value);
  if (value.includes('T')) return new Date(`${value}Z`);
  return new Date(`${value}T00:00:00Z`);
}

function toHourBucket(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours())
  );
}

function normalizeBucketKey(value: string) {
  return toHourBucket(parseTimeBucket(value)).toISOString();
}

export function buildAnomalyDetectionChartData({
  endDate,
  hours,
  totals,
  trends,
}: {
  endDate: Date;
  hours: number;
  totals: Array<Pick<EnergyAnalyticsResult, 'time_bucket' | 'count'>>;
  trends: Array<Pick<AnomalyTrendPoint, 'time_bucket' | 'count'>>;
}): AnomalyChartDataPoint[] {
  const buckets = new Map<string, AnomalyChartDataPoint>();
  const endBucket = toHourBucket(endDate);

  for (let offset = hours - 1; offset >= 0; offset--) {
    const bucketDate = new Date(endBucket.getTime() - offset * HOUR_IN_MS);
    const key = bucketDate.toISOString();

    buckets.set(key, {
      timestamp: key,
      time: bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      normal: 0,
      anomaly: 0,
    });
  }

  totals.forEach(total => {
    const bucket = buckets.get(normalizeBucketKey(total.time_bucket));
    if (!bucket) return;

    bucket.normal = Math.max(0, Math.round(total.count));
  });

  trends.forEach(trend => {
    const bucket = buckets.get(normalizeBucketKey(trend.time_bucket));
    if (!bucket) return;

    const anomalyCount = Math.max(0, Math.round(trend.count));
    bucket.anomaly = anomalyCount;
    bucket.normal = Math.max(0, bucket.normal - anomalyCount);
  });

  return Array.from(buckets.values());
}
