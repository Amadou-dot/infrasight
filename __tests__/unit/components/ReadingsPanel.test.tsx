/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DeviceV2Response, ReadingV2Response } from '@/types/v2';
import ReadingsPanel from '@/components/devices/ReadingsPanel';
import { usePusherReadings, type PusherReading } from '@/lib/pusher-context';

jest.mock('@/lib/pusher-context', () => ({
  usePusherReadings: jest.fn(),
}));

/**
 * Recharts renders nothing measurable in jsdom, so each mock surfaces the
 * props the tests assert on as data attributes, and LineChart/Line capture
 * their props for direct inspection (chart data, the dot renderer).
 */
let capturedLineProps: Record<string, unknown> = {};
let capturedChartData: unknown[] = [];

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  LineChart: (props: { children: React.ReactNode; data: unknown[] }) => {
    capturedChartData = props.data;
    return <div data-testid="line-chart">{props.children}</div>;
  },
  BarChart: (props: { children: React.ReactNode; data: unknown[] }) => {
    capturedChartData = props.data;
    return <div data-testid="bar-chart">{props.children}</div>;
  },
  Line: (props: Record<string, unknown>) => {
    capturedLineProps = props;
    return <div data-testid="chart-line" data-line-type={String(props.type)} />;
  },
  Bar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="chart-bar">{children}</div>
  ),
  Cell: (props: { fill?: string }) => <div data-testid="chart-cell" data-fill={props.fill} />,
  XAxis: () => null,
  YAxis: (props: { label?: { value?: string } }) => (
    <div data-testid="y-axis" data-unit={props.label?.value ?? ''} />
  ),
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: (props: { y?: number }) => (
    <div data-testid="reference-line" data-y={String(props.y)} />
  ),
}));

function createDevice(overrides: Partial<DeviceV2Response> = {}): DeviceV2Response {
  return {
    _id: 'device_001',
    type: 'temperature',
    status: 'active',
    serial_number: 'SN-1',
    configuration: {
      threshold_warning: 28,
      threshold_critical: 35,
      sampling_interval: 60,
      calibration_offset: 0,
    },
    ...overrides,
  } as DeviceV2Response;
}

function createReading(overrides: {
  value?: number;
  timestamp?: string;
  unit?: string;
  type?: string;
  isAnomaly?: boolean;
} = {}): ReadingV2Response {
  return {
    _id: `r_${overrides.timestamp ?? 'x'}_${overrides.value ?? 0}`,
    metadata: {
      device_id: 'device_001',
      type: overrides.type ?? 'temperature',
      unit: overrides.unit ?? 'celsius',
      source: 'sensor',
    },
    timestamp: overrides.timestamp ?? '2026-08-11T10:00:00.000Z',
    value: overrides.value ?? 21.5,
    quality: { is_valid: true, is_anomaly: overrides.isAnomaly ?? false },
    processing: { ingested_at: '2026-08-11T10:00:01.000Z' },
  } as ReadingV2Response;
}

beforeEach(() => {
  jest.clearAllMocks(); // mock call counts must not leak between tests (Task 4 asserts them)
  capturedLineProps = {};
  capturedChartData = [];
});

describe('ReadingsPanel chart shapes', () => {
  it('renders a monotone line for analog types', () => {
    render(
      <ReadingsPanel
        device={createDevice({ type: 'temperature' })}
        recentReadings={[createReading()]}
        readingsTotal={1}
      />
    );
    expect(screen.getByTestId('chart-line')).toHaveAttribute('data-line-type', 'monotone');
  });

  it('renders a step line for motion', () => {
    render(
      <ReadingsPanel
        device={createDevice({ type: 'motion' })}
        recentReadings={[createReading({ type: 'motion', unit: 'boolean', value: 1 })]}
        readingsTotal={1}
      />
    );
    expect(screen.getByTestId('chart-line')).toHaveAttribute('data-line-type', 'stepAfter');
  });

  it('renders bars for energy, coloring anomalous bars red', () => {
    render(
      <ReadingsPanel
        device={createDevice({ type: 'energy' })}
        recentReadings={[
          createReading({ type: 'energy', unit: 'kilowatt_hours', value: 4, isAnomaly: true }),
          createReading({ type: 'energy', unit: 'kilowatt_hours', value: 3 }),
        ]}
        readingsTotal={2}
      />
    );
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    const fills = screen.getAllByTestId('chart-cell').map(cell => cell.getAttribute('data-fill'));
    expect(fills).toContain('#ef4444');
    expect(fills).toContain('#3b82f6');
  });
});

describe('ReadingsPanel units and thresholds', () => {
  it('labels the Y axis with the unit symbol of the newest reading', () => {
    render(
      <ReadingsPanel
        device={createDevice()}
        recentReadings={[createReading({ unit: 'celsius' })]}
        readingsTotal={1}
      />
    );
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-unit', '°C');
  });

  it('draws warning and critical reference lines from device configuration', () => {
    render(
      <ReadingsPanel device={createDevice()} recentReadings={[createReading()]} readingsTotal={1} />
    );
    const ys = screen.getAllByTestId('reference-line').map(line => line.getAttribute('data-y'));
    expect(ys).toEqual(expect.arrayContaining(['28', '35']));
  });

  it('draws a reference line for a threshold of 0 (typeof check, not truthiness)', () => {
    render(
      <ReadingsPanel
        device={createDevice({
          configuration: {
            threshold_warning: 0,
            threshold_critical: 35,
            sampling_interval: 60,
            calibration_date: null,
            calibration_offset: 0,
          },
        })}
        recentReadings={[createReading()]}
        readingsTotal={1}
      />
    );
    const ys = screen.getAllByTestId('reference-line').map(line => line.getAttribute('data-y'));
    expect(ys).toEqual(expect.arrayContaining(['0', '35']));
  });

  it('draws no reference lines when the device has no configuration', () => {
    render(
      <ReadingsPanel
        device={createDevice({ configuration: undefined })}
        recentReadings={[createReading()]}
        readingsTotal={1}
      />
    );
    expect(screen.queryAllByTestId('reference-line')).toHaveLength(0);
  });
});

describe('ReadingsPanel anomaly dots', () => {
  it('passes a dot renderer that draws anomalous points red', () => {
    render(
      <ReadingsPanel
        device={createDevice()}
        recentReadings={[createReading({ isAnomaly: true })]}
        readingsTotal={1}
      />
    );
    const dot = capturedLineProps.dot as (props: {
      cx: number;
      cy: number;
      index: number;
      payload: { isAnomaly: boolean };
    }) => React.ReactElement;
    expect(typeof dot).toBe('function');

    const { container: anomalous } = render(
      <svg>{dot({ cx: 10, cy: 10, index: 0, payload: { isAnomaly: true } })}</svg>
    );
    expect(anomalous.querySelector('circle')).toHaveAttribute('fill', '#ef4444');

    const { container: normal } = render(
      <svg>{dot({ cx: 10, cy: 10, index: 1, payload: { isAnomaly: false } })}</svg>
    );
    expect(normal.querySelector('circle')).toHaveAttribute('fill', '#3b82f6');
  });
});

describe('ReadingsPanel stats row', () => {
  it('shows current/min/avg/max for continuous types', () => {
    render(
      <ReadingsPanel
        device={createDevice()}
        recentReadings={[
          // Hook order: newest first. Panel reverses to ascending, so current = 25.
          // Values chosen so all four formatted stats are DISTINCT strings —
          // getByText throws on duplicate matches: current 25, min 18, max 30,
          // avg (23+18+30+25)/4 = 24.
          createReading({ value: 25, timestamp: '2026-08-11T12:00:00.000Z' }),
          createReading({ value: 30, timestamp: '2026-08-11T11:00:00.000Z' }),
          createReading({ value: 18, timestamp: '2026-08-11T10:00:00.000Z' }),
          createReading({ value: 23, timestamp: '2026-08-11T09:00:00.000Z' }),
        ]}
        readingsTotal={4}
      />
    );
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('25.0 °C')).toBeInTheDocument();
    expect(screen.getByText('Min')).toBeInTheDocument();
    expect(screen.getByText('18.0 °C')).toBeInTheDocument();
    expect(screen.getByText('Avg')).toBeInTheDocument();
    expect(screen.getByText('24.0 °C')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(screen.getByText('30.0 °C')).toBeInTheDocument();
  });

  it('shows event count and last event for motion', () => {
    render(
      <ReadingsPanel
        device={createDevice({ type: 'motion' })}
        recentReadings={[
          createReading({ type: 'motion', unit: 'boolean', value: 1, timestamp: '2026-08-11T12:00:00.000Z' }),
          createReading({ type: 'motion', unit: 'boolean', value: 0, timestamp: '2026-08-11T11:00:00.000Z' }),
        ]}
        readingsTotal={2}
      />
    );
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Last event')).toBeInTheDocument();
  });

  it('shows an anomaly count when any point is anomalous', () => {
    render(
      <ReadingsPanel
        device={createDevice()}
        recentReadings={[createReading({ isAnomaly: true }), createReading({ value: 20 })]}
        readingsTotal={2}
      />
    );
    expect(screen.getByText(/1 anomal/i)).toBeInTheDocument();
  });
});

describe('ReadingsPanel heading honesty', () => {
  it('admits truncation when the server holds more than was fetched', () => {
    render(
      <ReadingsPanel
        device={createDevice()}
        recentReadings={[createReading()]}
        readingsTotal={2880}
      />
    );
    expect(screen.getByText('Newest 1 of 2,880 readings (last 24h)')).toBeInTheDocument();
  });

  it('claims the full window only when it has it', () => {
    render(
      <ReadingsPanel device={createDevice()} recentReadings={[createReading()]} readingsTotal={1} />
    );
    expect(screen.getByText('Readings — last 24h')).toBeInTheDocument();
  });

  it('renders the empty state when there are no readings', () => {
    render(<ReadingsPanel device={createDevice()} recentReadings={[]} readingsTotal={0} />);
    expect(screen.getByText('No recent readings available')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-container')).not.toBeInTheDocument();
  });
});

describe('ReadingsPanel live updates', () => {
  function lastHandler(): (readings: PusherReading[]) => void {
    return (usePusherReadings as jest.Mock).mock.calls.at(-1)?.[0];
  }

  function liveReading(overrides: Partial<PusherReading['metadata']> = {}, value = 30): PusherReading {
    return {
      metadata: { device_id: 'device_001', type: 'temperature', ...overrides },
      timestamp: '2026-08-11T13:00:00.000Z',
      value,
    };
  }

  it('subscribes exactly once through usePusherReadings', () => {
    render(
      <ReadingsPanel device={createDevice()} recentReadings={[createReading()]} readingsTotal={1} />
    );
    expect(usePusherReadings).toHaveBeenCalledTimes(1);
    expect(typeof lastHandler()).toBe('function');
  });

  it('appends a matching live reading to the chart and updates Current', () => {
    render(
      <ReadingsPanel
        device={createDevice()}
        recentReadings={[createReading({ value: 21.5, timestamp: '2026-08-11T10:00:00.000Z' })]}
        readingsTotal={1}
      />
    );
    expect(capturedChartData).toHaveLength(1);

    act(() => lastHandler()([liveReading({}, 30)]));

    expect(capturedChartData).toHaveLength(2);
    // Current tracks live. getAllByText because 30 is also the window max, so
    // the same formatted string appears in both the Current and Max cells.
    expect(screen.getAllByText('30.0 °C').length).toBeGreaterThan(0);
  });

  // The negative case is the point: the public channel carries the whole
  // fleet, and every other device's readings must be ignored.
  it('ignores readings for other devices', () => {
    render(
      <ReadingsPanel device={createDevice()} recentReadings={[createReading()]} readingsTotal={1} />
    );
    act(() => lastHandler()([liveReading({ device_id: 'device_999' }, 30)]));
    expect(capturedChartData).toHaveLength(1);
  });

  it('ignores readings whose type does not match the device', () => {
    render(
      <ReadingsPanel device={createDevice()} recentReadings={[createReading()]} readingsTotal={1} />
    );
    act(() => lastHandler()([liveReading({ type: 'humidity' }, 30)]));
    expect(capturedChartData).toHaveLength(1);
  });

  it('trims the merged series to MAX_CHART_POINTS', () => {
    const fetched = Array.from({ length: 500 }, (_, i) =>
      createReading({ value: i, timestamp: `2026-08-11T00:${String(i % 60).padStart(2, '0')}:00.000Z` })
    );
    render(<ReadingsPanel device={createDevice()} recentReadings={fetched} readingsTotal={500} />);
    expect(capturedChartData).toHaveLength(500);

    act(() => lastHandler()([liveReading({}, 30)]));

    expect(capturedChartData).toHaveLength(500); // oldest dropped, newest appended
    const values = (capturedChartData as Array<{ value: number }>).map(d => d.value);
    expect(values[values.length - 1]).toBe(30);
  });
});
