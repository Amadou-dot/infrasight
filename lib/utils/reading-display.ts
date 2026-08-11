/**
 * Display configuration for the device detail Readings tab.
 *
 * Both registries are TOTAL Records on purpose: adding a 16th ReadingType or a
 * 36th ReadingUnit without a row here is a tsc error, not a silently generic
 * chart (same guard as TYPE_SENSITIVITY in lib/simulation/readings.ts). This
 * file is listed in CLAUDE.md's "Adding a New Device / Reading Type" checklist.
 *
 * Pure module — no React, importable from node-environment tests.
 */

import type { ReadingType, ReadingUnit, ReadingV2Response } from '@/types/v2';

/**
 * Cap on points a readings chart holds. Sized as 5 pages at the server's
 * 100-per-page max: useDeviceDetail fetches up to this many, and the live
 * append in ReadingsPanel trims to the same bound.
 */
export const MAX_CHART_POINTS = 500;

export interface ReadingDisplayConfig {
  /** Human name for headings and stat labels. */
  label: string;
  /** line = analog series, step = discrete states, bar = per-interval quantities. */
  chart: 'line' | 'step' | 'bar';
  /** continuous = current/min/avg/max; events = event count + last event (motion). */
  stats: 'continuous' | 'events';
  /** Value formatting precision. */
  decimals: number;
}

export const READING_DISPLAY: Record<ReadingType, ReadingDisplayConfig> = {
  temperature: { label: 'Temperature', chart: 'line', stats: 'continuous', decimals: 1 },
  humidity: { label: 'Humidity', chart: 'line', stats: 'continuous', decimals: 1 },
  occupancy: { label: 'Occupancy', chart: 'step', stats: 'continuous', decimals: 0 },
  power: { label: 'Power', chart: 'line', stats: 'continuous', decimals: 1 },
  co2: { label: 'CO₂', chart: 'line', stats: 'continuous', decimals: 0 },
  pressure: { label: 'Pressure', chart: 'line', stats: 'continuous', decimals: 1 },
  light: { label: 'Light', chart: 'line', stats: 'continuous', decimals: 0 },
  motion: { label: 'Motion', chart: 'step', stats: 'events', decimals: 0 },
  air_quality: { label: 'Air quality', chart: 'line', stats: 'continuous', decimals: 1 },
  water_flow: { label: 'Water flow', chart: 'line', stats: 'continuous', decimals: 1 },
  gas: { label: 'Gas', chart: 'line', stats: 'continuous', decimals: 1 },
  vibration: { label: 'Vibration', chart: 'line', stats: 'continuous', decimals: 2 },
  voltage: { label: 'Voltage', chart: 'line', stats: 'continuous', decimals: 1 },
  current: { label: 'Current', chart: 'line', stats: 'continuous', decimals: 2 },
  energy: { label: 'Energy', chart: 'bar', stats: 'continuous', decimals: 1 },
};

/** A server newer than this client may emit a type we do not know. Render, don't crash. */
const FALLBACK_DISPLAY: ReadingDisplayConfig = {
  label: 'Reading',
  chart: 'line',
  stats: 'continuous',
  decimals: 1,
};

export function getReadingDisplay(type: string): ReadingDisplayConfig {
  return READING_DISPLAY[type as ReadingType] ?? FALLBACK_DISPLAY;
}

/**
 * Display symbol per unit. Countish and generic units map to '' — a bare
 * number reads better on an axis than the word "count".
 */
export const UNIT_SYMBOL: Record<ReadingUnit, string> = {
  celsius: '°C',
  fahrenheit: '°F',
  kelvin: 'K',
  percent: '%',
  ppm: 'ppm',
  ppb: 'ppb',
  ug_m3: 'µg/m³',
  pascal: 'Pa',
  hpa: 'hPa',
  bar: 'bar',
  psi: 'psi',
  watts: 'W',
  kilowatts: 'kW',
  watt_hours: 'Wh',
  kilowatt_hours: 'kWh',
  volts: 'V',
  millivolts: 'mV',
  amperes: 'A',
  milliamperes: 'mA',
  lux: 'lx',
  lumens: 'lm',
  liters_per_minute: 'L/min',
  gallons_per_minute: 'gal/min',
  cubic_meters_per_hour: 'm³/h',
  count: '',
  boolean: '',
  raw: '',
  unknown: '',
};

export function unitSymbol(unit: string): string {
  const symbol = UNIT_SYMBOL[unit as ReadingUnit];
  return symbol !== undefined ? symbol : unit;
}

/**
 * The one point shape the chart, stats, and live appends all share. Fetched
 * readings map through toChartPoint; live Pusher readings (which carry no
 * quality object) are constructed directly with isAnomaly: false.
 */
export interface ChartPoint {
  /** ISO timestamp. */
  timestamp: string;
  value: number;
  isAnomaly: boolean;
}

export function toChartPoint(reading: ReadingV2Response): ChartPoint {
  return {
    timestamp: reading.timestamp,
    value: reading.value,
    isAnomaly: reading.quality?.is_anomaly === true,
  };
}

export interface ReadingSummary {
  count: number;
  anomalyCount: number;
  /** Newest value — the last element of the ascending-ordered input. */
  current: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  /** Readings with value >= 1 (the events stats kind). */
  eventCount: number;
  /** ISO timestamp of the newest reading with value >= 1. */
  lastEventAt: string | null;
}

/** Points must be in ascending timestamp order; `current` is the last element. */
export function summarizeReadings(points: ChartPoint[]): ReadingSummary {
  if (points.length === 0)
    return {
      count: 0,
      anomalyCount: 0,
      current: null,
      min: null,
      max: null,
      avg: null,
      eventCount: 0,
      lastEventAt: null,
    };

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let anomalyCount = 0;
  let eventCount = 0;
  let lastEventAt: string | null = null;

  for (const point of points) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
    sum += point.value;
    if (point.isAnomaly) anomalyCount += 1;
    if (point.value >= 1) {
      eventCount += 1;
      lastEventAt = point.timestamp;
    }
  }

  return {
    count: points.length,
    anomalyCount,
    current: points[points.length - 1].value,
    min,
    max,
    avg: sum / points.length,
    eventCount,
    lastEventAt,
  };
}

export function formatReadingValue(value: number, decimals: number, symbol: string): string {
  const formatted = value.toFixed(decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}
