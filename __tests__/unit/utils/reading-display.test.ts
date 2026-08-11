import {
  READING_DISPLAY,
  getReadingDisplay,
  unitSymbol,
  toChartPoint,
  summarizeReadings,
  formatReadingValue,
  MAX_CHART_POINTS,
  type ChartPoint,
} from '@/lib/utils/reading-display';
import type { ReadingV2Response } from '@/types/v2';

function point(overrides: Partial<ChartPoint> = {}): ChartPoint {
  return { timestamp: '2026-08-11T10:00:00.000Z', value: 20, isAnomaly: false, ...overrides };
}

describe('READING_DISPLAY registry', () => {
  it('gives motion a step chart with event stats', () => {
    expect(READING_DISPLAY.motion).toEqual(
      expect.objectContaining({ chart: 'step', stats: 'events' })
    );
  });

  it('gives occupancy a step chart with continuous stats', () => {
    expect(READING_DISPLAY.occupancy).toEqual(
      expect.objectContaining({ chart: 'step', stats: 'continuous' })
    );
  });

  it('gives energy a bar chart', () => {
    expect(READING_DISPLAY.energy.chart).toBe('bar');
  });

  it('gives analog types a line chart', () => {
    for (const type of ['temperature', 'co2', 'voltage', 'water_flow'] as const)
      expect(READING_DISPLAY[type].chart).toBe('line');
  });
});

describe('getReadingDisplay', () => {
  it('returns the registry entry for a known type', () => {
    expect(getReadingDisplay('energy')).toBe(READING_DISPLAY.energy);
  });

  // A server newer than this client may emit a 16th type; the panel must not crash.
  it('falls back to a line/continuous config for an unknown runtime type', () => {
    expect(getReadingDisplay('plasma_flux')).toEqual(
      expect.objectContaining({ chart: 'line', stats: 'continuous' })
    );
  });
});

describe('unitSymbol', () => {
  it('maps known units to display symbols', () => {
    expect(unitSymbol('celsius')).toBe('°C');
    expect(unitSymbol('kilowatt_hours')).toBe('kWh');
    expect(unitSymbol('liters_per_minute')).toBe('L/min');
  });

  it('renders countish/generic units as empty (a bare number reads better than "count")', () => {
    expect(unitSymbol('count')).toBe('');
    expect(unitSymbol('boolean')).toBe('');
    expect(unitSymbol('raw')).toBe('');
  });

  it('falls back to the raw string for an unknown runtime unit', () => {
    expect(unitSymbol('furlongs_per_fortnight')).toBe('furlongs_per_fortnight');
  });
});

describe('toChartPoint', () => {
  it('carries timestamp, value, and the anomaly flag', () => {
    const reading = {
      _id: 'r1',
      metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' },
      timestamp: '2026-08-11T10:00:00.000Z',
      value: 21.5,
      quality: { is_valid: true, is_anomaly: true },
      processing: { ingested_at: '2026-08-11T10:00:01.000Z' },
    } as ReadingV2Response;

    expect(toChartPoint(reading)).toEqual({
      timestamp: '2026-08-11T10:00:00.000Z',
      value: 21.5,
      isAnomaly: true,
    });
  });
});

describe('summarizeReadings', () => {
  it('returns null stats and zero counts for no points', () => {
    expect(summarizeReadings([])).toEqual({
      count: 0,
      anomalyCount: 0,
      current: null,
      min: null,
      max: null,
      avg: null,
      eventCount: 0,
      lastEventAt: null,
    });
  });

  it('computes continuous stats with current = last point', () => {
    const summary = summarizeReadings([
      point({ value: 10 }),
      point({ value: 30, isAnomaly: true }),
      point({ value: 20, timestamp: '2026-08-11T12:00:00.000Z' }),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.current).toBe(20);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(30);
    expect(summary.avg).toBe(20);
    expect(summary.anomalyCount).toBe(1);
  });

  it('counts events (value >= 1) and tracks the last event timestamp', () => {
    const summary = summarizeReadings([
      point({ value: 1, timestamp: '2026-08-11T09:00:00.000Z' }),
      point({ value: 0, timestamp: '2026-08-11T10:00:00.000Z' }),
      point({ value: 1, timestamp: '2026-08-11T11:00:00.000Z' }),
      point({ value: 0, timestamp: '2026-08-11T12:00:00.000Z' }),
    ]);
    expect(summary.eventCount).toBe(2);
    expect(summary.lastEventAt).toBe('2026-08-11T11:00:00.000Z');
  });
});

describe('formatReadingValue', () => {
  it('applies decimals and appends the symbol with a space', () => {
    expect(formatReadingValue(21.456, 1, '°C')).toBe('21.5 °C');
  });

  it('omits the trailing space when the symbol is empty', () => {
    expect(formatReadingValue(3, 0, '')).toBe('3');
  });
});

describe('MAX_CHART_POINTS', () => {
  it('is 5 server pages', () => {
    expect(MAX_CHART_POINTS).toBe(500);
  });
});
