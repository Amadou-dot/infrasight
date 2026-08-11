'use client';

import { useMemo } from 'react';
import type { DeviceV2Response, ReadingV2Response } from '@/types/v2';
import {
  formatReadingValue,
  getReadingDisplay,
  summarizeReadings,
  toChartPoint,
  unitSymbol,
  type ChartPoint,
} from '@/lib/utils/reading-display';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const SERIES_COLOR = '#3b82f6';
const ANOMALY_COLOR = '#ef4444';
const WARNING_COLOR = '#f59e0b';

interface ReadingsPanelProps {
  device: DeviceV2Response;
  /** Newest-first, as useDeviceDetail returns them. */
  recentReadings: ReadingV2Response[];
  /** Server total for the 24h window; null until known. */
  readingsTotal: number | null;
}

type ChartDatum = ChartPoint & { time: string };

interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: ChartDatum;
}

/**
 * Recharts calls this per point. Anomalous points (quality.is_anomaly on the
 * fetched reading) render as larger red dots so a flagged spike is visible in
 * context; recharts requires an element back even for skipped points.
 */
function renderDot(props: DotProps) {
  const { cx, cy, index, payload } = props;
  if (cx == null || cy == null) return <g key={index} />;
  if (payload?.isAnomaly)
    return <circle key={index} cx={cx} cy={cy} r={4} fill={ANOMALY_COLOR} data-testid="anomaly-dot" />;
  return <circle key={index} cx={cx} cy={cy} r={2} fill={SERIES_COLOR} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-600 dark:text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

/**
 * Type-aware readings chart + stats for the device detail Readings tab.
 * Chart shape, stat kind, and formatting come from the READING_DISPLAY
 * registry; the unit label comes from the newest reading's own metadata.unit.
 */
export default function ReadingsPanel({ device, recentReadings, readingsTotal }: ReadingsPanelProps) {
  const display = getReadingDisplay(device.type);
  // The hook returns newest-first; the chart and stats want ascending time.
  const points = useMemo(
    () => recentReadings.map(toChartPoint).reverse(),
    [recentReadings]
  );
  const summary = useMemo(() => summarizeReadings(points), [points]);

  const symbol = unitSymbol(recentReadings[0]?.metadata.unit ?? '');
  const format = (value: number) => formatReadingValue(value, display.decimals, symbol);

  const data: ChartDatum[] = useMemo(
    () =>
      points.map(point => ({
        ...point,
        time: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      })),
    [points]
  );

  const truncated = readingsTotal !== null && readingsTotal > recentReadings.length;
  const heading = truncated
    ? `Newest ${recentReadings.length.toLocaleString('en-US')} of ${readingsTotal.toLocaleString('en-US')} readings (last 24h)`
    : 'Readings — last 24h';

  const warning = device.configuration?.threshold_warning;
  const critical = device.configuration?.threshold_critical;

  // Shared by both chart kinds. Thresholds render only for actual numbers —
  // a configured 0 must draw, an absent config must not (no truthiness).
  const axesAndThresholds = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#888" />
      <YAxis
        tick={{ fontSize: 12 }}
        stroke="#888"
        label={symbol ? { value: symbol, angle: -90, position: 'insideLeft' } : undefined}
      />
      <Tooltip formatter={(value?: number) => (value === undefined ? '' : format(value))} />
      {typeof warning === 'number' && (
        <ReferenceLine y={warning} stroke={WARNING_COLOR} strokeDasharray="4 4" />
      )}
      {typeof critical === 'number' && (
        <ReferenceLine y={critical} stroke={ANOMALY_COLOR} strokeDasharray="4 4" />
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-white">{heading}</h3>
        {summary.anomalyCount > 0 && (
          <span className="text-xs font-medium text-red-600 dark:text-red-400">
            {summary.anomalyCount} {summary.anomalyCount === 1 ? 'anomaly' : 'anomalies'}
          </span>
        )}
      </div>

      {points.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          No recent readings available
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            {display.chart === 'bar' ? (
              <BarChart data={data}>
                {axesAndThresholds}
                <Bar dataKey="value" fill={SERIES_COLOR}>
                  {data.map((point, index) => (
                    <Cell key={index} fill={point.isAnomaly ? ANOMALY_COLOR : SERIES_COLOR} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <LineChart data={data}>
                {axesAndThresholds}
                <Line
                  type={display.chart === 'step' ? 'stepAfter' : 'monotone'}
                  dataKey="value"
                  stroke={SERIES_COLOR}
                  strokeWidth={2}
                  dot={renderDot}
                />
              </LineChart>
            )}
          </ResponsiveContainer>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {display.stats === 'events' ? (
              <>
                <Stat label="Events" value={String(summary.eventCount)} />
                <Stat
                  label="Last event"
                  value={
                    summary.lastEventAt
                      ? new Date(summary.lastEventAt).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'
                  }
                />
              </>
            ) : (
              <>
                <Stat label="Current" value={summary.current !== null ? format(summary.current) : '—'} />
                <Stat label="Min" value={summary.min !== null ? format(summary.min) : '—'} />
                <Stat label="Avg" value={summary.avg !== null ? format(summary.avg) : '—'} />
                <Stat label="Max" value={summary.max !== null ? format(summary.max) : '—'} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
