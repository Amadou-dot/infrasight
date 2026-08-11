# Type-Specific Readings Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The device detail Readings tab renders each of the 15 device types with the right chart shape, unit-labeled axes, threshold lines, anomaly markers, honest window labeling, and live Pusher appends — driven by one display registry.

**Architecture:** A pure config module (`lib/utils/reading-display.ts`) keyed by the full `ReadingType` union drives one `ReadingsPanel` component that replaces the inline chart in `DeviceDetailView`. `useDeviceDetail` fetches the 24h window across up to 5 pages and exposes the server total so the heading never lies. Live updates ride the existing public readings channel via `usePusherReadings`.

**Tech Stack:** Next.js 16, TypeScript, Recharts, React Testing Library (jsdom), Jest. No server/API changes.

**Spec:** `docs/superpowers/specs/2026-08-11-type-specific-readings-design.md`

## Global Constraints

- Branch: `feat/type-specific-readings` (stacked on `fix/count-display-truthfulness`, PR #124).
- Client-only feature: no new endpoints, no server route changes, no React Query changes.
- Displayed counts must be server totals or actual data — never a capped array length presented as a total (project doctrine from PR #124).
- Threshold reference lines render only when the value passes `typeof value === 'number'` — no truthiness guards, no `|| 9999`-style fallbacks. A legitimate threshold of `0` must render.
- `MAX_CHART_POINTS = 500` (5 pages × the server's 100-per-page max). The server page cap stays 100.
- `READING_DISPLAY` and `UNIT_SYMBOL` must be **total** `Record`s over `ReadingType` / `ReadingUnit` so a missing entry is a `tsc` error (pattern: `TYPE_SENSITIVITY` in `lib/simulation/readings.ts`).
- `TemperatureCorrelationPanel` is untouched and stays above the new panel for temperature devices.
- Components use `'use client'`, Tailwind classes in the style of `DeviceDetailView` (`text-gray-600 dark:text-gray-400` labels, `font-medium` values).
- Component tests carry the `/** @jest-environment jsdom */` docblock; pure-module tests run in the default node environment.
- Each task ends green: targeted `npx jest <file>` runs pass, `npx tsc --noEmit` clean, `npx eslint <touched files>` clean.

---

### Task 1: Reading display registry (`lib/utils/reading-display.ts`)

**Files:**
- Create: `lib/utils/reading-display.ts`
- Test: `__tests__/unit/utils/reading-display.test.ts`
- Modify: `CLAUDE.md` (two spots in "Adding a New Device / Reading Type": the `tsc`-guarded table in item 1, and the units sentence in item 2)

**Interfaces:**
- Consumes: `ReadingType`, `ReadingUnit`, `ReadingV2Response` from `@/types/v2`.
- Produces (later tasks import all of these from `@/lib/utils/reading-display`):
  - `MAX_CHART_POINTS: number` (= 500)
  - `interface ReadingDisplayConfig { label: string; chart: 'line' | 'step' | 'bar'; stats: 'continuous' | 'events'; decimals: number }`
  - `READING_DISPLAY: Record<ReadingType, ReadingDisplayConfig>`
  - `getReadingDisplay(type: string): ReadingDisplayConfig` (falls back for unknown runtime types)
  - `UNIT_SYMBOL: Record<ReadingUnit, string>`
  - `unitSymbol(unit: string): string` (falls back to the raw string for unknown units)
  - `interface ChartPoint { timestamp: string; value: number; isAnomaly: boolean }`
  - `toChartPoint(reading: ReadingV2Response): ChartPoint`
  - `interface ReadingSummary { count: number; anomalyCount: number; current: number | null; min: number | null; max: number | null; avg: number | null; eventCount: number; lastEventAt: string | null }`
  - `summarizeReadings(points: ChartPoint[]): ReadingSummary` (expects **ascending** timestamp order; `current` is the last element)
  - `formatReadingValue(value: number, decimals: number, symbol: string): string`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/unit/utils/reading-display.test.ts`:

```typescript
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
    for (const type of ['temperature', 'co2', 'voltage', 'water_flow'] as const) {
      expect(READING_DISPLAY[type].chart).toBe('line');
    }
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/unit/utils/reading-display.test.ts`
Expected: FAIL — cannot resolve `@/lib/utils/reading-display`.

- [ ] **Step 3: Implement the module**

Create `lib/utils/reading-display.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/unit/utils/reading-display.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Update CLAUDE.md's new-type checklist**

In CLAUDE.md, section "Adding a New Device / Reading Type", item **1** ("Type and schema definitions — miss one and `tsc` or Mongoose tells you"), add a row to the table after the `lib/simulation/readings.ts` row:

```markdown
| [lib/utils/reading-display.ts](lib/utils/reading-display.ts) | `READING_DISPLAY` entry (chart shape, stats kind, label) | `tsc` error — total `Record<ReadingType, …>` |
```

In item **2** ("Units"), change the sentence listing the three copies so it reads *four* copies, appending `lib/utils/reading-display.ts` (`UNIT_SYMBOL`, `tsc`-guarded):

```markdown
**2. Units.** Add any new `ReadingUnit` values (35 today) to *all four* copies: `models/v2/ReadingV2.ts` (union + schema enum), `lib/validations/v2/reading.validation.ts` (`readingUnitSchema`), `types/v2/reading.types.ts`, and `lib/utils/reading-display.ts` (`UNIT_SYMBOL` — this one is a total `Record`, so `tsc` catches an omission).
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit` (expect clean), `npx eslint lib/utils/reading-display.ts __tests__/unit/utils/reading-display.test.ts` (expect clean).

```bash
git add lib/utils/reading-display.ts __tests__/unit/utils/reading-display.test.ts CLAUDE.md
git commit -m "feat: reading display registry (chart shape, units, stats per reading type)"
```

---

### Task 2: Honest multi-page readings fetch in `useDeviceDetail`

**Files:**
- Modify: `components/devices/useDeviceDetail.ts`
- Test: `__tests__/unit/lib/useDeviceDetail.test.tsx` (extend the existing file)

**Interfaces:**
- Consumes: `MAX_CHART_POINTS` from `@/lib/utils/reading-display` (Task 1); `v2Api.readings.list(query): Promise<PaginatedResponse<ReadingV2Response>>` whose `pagination` is `{ total, page, limit, totalPages, hasNext, hasPrevious }`.
- Produces: `DeviceDetail` gains `readingsTotal: number | null` (server total for the 24h window; `null` until the readings fetch resolves, mirroring `auditTotal`). `recentReadings` stays **newest-first** (server sort order) but now holds up to `MAX_CHART_POINTS` readings across pages.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/unit/lib/useDeviceDetail.test.tsx` (it already mocks `v2Api` wholesale and has `listReadings = v2Api.readings.list as jest.Mock`, `mockHappyPath()`, and a `device` fixture):

```typescript
describe('useDeviceDetail readings pagination', () => {
  function readingsPage(page: number, count: number, total: number) {
    return {
      success: true,
      data: Array.from({ length: count }, (_, i) => ({
        timestamp: `2026-08-11T0${page}:${String(i).padStart(2, '0')}:00.000Z`,
        value: page * 100 + i,
      })),
      pagination: {
        total,
        page,
        limit: 100,
        totalPages: Math.ceil(total / 100),
        hasNext: page * 100 < total,
        hasPrevious: page > 1,
      },
    };
  }

  beforeEach(() => {
    getById.mockResolvedValue({ success: true, data: device });
    getHistory.mockResolvedValue({ success: true, data: { history: [] } });
  });

  it('exposes the server total and follows pages until the window is covered', async () => {
    listReadings
      .mockResolvedValueOnce(readingsPage(1, 100, 250))
      .mockResolvedValueOnce(readingsPage(2, 100, 250))
      .mockResolvedValueOnce(readingsPage(3, 50, 250));

    const { result } = renderHook(() => useDeviceDetail('device_001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listReadings).toHaveBeenCalledTimes(3);
    expect(listReadings.mock.calls[1][0]).toEqual(expect.objectContaining({ page: 2 }));
    expect(listReadings.mock.calls[2][0]).toEqual(expect.objectContaining({ page: 3 }));
    expect(result.current.recentReadings).toHaveLength(250);
    // Newest-first across the page boundary: page 1 rows precede page 2 rows.
    expect(result.current.recentReadings[0].value).toBe(100);
    expect(result.current.recentReadings[100].value).toBe(200);
    expect(result.current.readingsTotal).toBe(250);
  });

  it('stops at 5 pages even when the window holds more', async () => {
    listReadings.mockImplementation(({ page = 1 }) =>
      Promise.resolve(readingsPage(page, 100, 2880))
    );

    const { result } = renderHook(() => useDeviceDetail('device_001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listReadings).toHaveBeenCalledTimes(5);
    expect(result.current.recentReadings).toHaveLength(500);
    // The total stays the SERVER total — the heading uses it to admit truncation.
    expect(result.current.readingsTotal).toBe(2880);
  });

  it('keeps the contiguous pages that loaded when a later page fails', async () => {
    listReadings
      .mockResolvedValueOnce(readingsPage(1, 100, 300))
      .mockResolvedValueOnce(readingsPage(2, 100, 300))
      .mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useDeviceDetail('device_001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recentReadings).toHaveLength(200);
    expect(result.current.readingsTotal).toBe(300);
    expect(result.current.error).toBeNull();
  });

  it('reports readingsTotal null before any fetch and after reset', () => {
    const { result } = renderHook(() => useDeviceDetail(null));
    expect(result.current.readingsTotal).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/unit/lib/useDeviceDetail.test.tsx`
Expected: the new describe block FAILS (`readingsTotal` undefined, single `list` call). Pre-existing tests still pass.

- [ ] **Step 3: Implement the multi-page fetch**

In `components/devices/useDeviceDetail.ts`:

Add the import:

```typescript
import { MAX_CHART_POINTS } from '@/lib/utils/reading-display';
```

Below `READINGS_WINDOW_MS`, add:

```typescript
/** Chart cap ÷ server page max. Pages beyond this are reported via readingsTotal, not fetched. */
const MAX_READING_PAGES = MAX_CHART_POINTS / 100;
```

Extend the `DeviceDetail` interface:

```typescript
export interface DeviceDetail {
  device: DeviceV2Response | null;
  /** Newest-first, up to MAX_CHART_POINTS readings from the 24h window. */
  recentReadings: ReadingV2Response[];
  auditLog: AuditLogEntry[];
  /** Server-reported total audit entry count; null until the audit fetch resolves. */
  auditTotal: number | null;
  /** Server-reported total readings in the 24h window; null until the readings fetch resolves. */
  readingsTotal: number | null;
  loading: boolean;
  error: string | null;
  /** True when the device id does not resolve, so callers can render a 404. */
  notFound: boolean;
}
```

Add state alongside the others, reset it in the disabled branch, and return it:

```typescript
const [readingsTotal, setReadingsTotal] = useState<number | null>(null);
```

(in the `if (!deviceId || !enabled)` branch, add `setReadingsTotal(null);`; in the return object, add `readingsTotal`.)

Replace the single readings fetch (the `const now = new Date();` block through `setRecentReadings(readingsResponse.data);`) with:

```typescript
const now = new Date();
const windowStart = new Date(now.getTime() - READINGS_WINDOW_MS);
const readingsQuery = {
  device_id: deviceId,
  startDate: windowStart.toISOString(),
  endDate: now.toISOString(),
  limit: 100,
};

const firstPage = await v2Api.readings.list(readingsQuery);
if (abortController.signal.aborted) return;
if (firstPage.success && firstPage.data) {
  const readings = [...firstPage.data];
  const totalPages = Math.min(firstPage.pagination?.totalPages ?? 1, MAX_READING_PAGES);

  // Later pages are best-effort and sequential: stopping at the first failure
  // keeps the loaded window CONTIGUOUS (newest-first with no invisible hole in
  // the middle), and the panel heading reports the count actually shown.
  for (let page = 2; page <= totalPages; page += 1) {
    try {
      const nextPage = await v2Api.readings.list({ ...readingsQuery, page });
      if (abortController.signal.aborted) return;
      if (!nextPage.success || !nextPage.data) break;
      readings.push(...nextPage.data);
    } catch {
      break;
    }
  }

  setRecentReadings(readings);
  setReadingsTotal(firstPage.pagination?.total ?? readings.length);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/unit/lib/useDeviceDetail.test.tsx`
Expected: PASS — new block and all pre-existing tests (their mocks return no `pagination`, so `totalPages ?? 1` keeps them single-page).

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit`, `npx eslint components/devices/useDeviceDetail.ts __tests__/unit/lib/useDeviceDetail.test.tsx`.

```bash
git add components/devices/useDeviceDetail.ts __tests__/unit/lib/useDeviceDetail.test.tsx
git commit -m "feat: useDeviceDetail follows readings pages (cap 500) and exposes readingsTotal"
```

---

### Task 3: `ReadingsPanel` component and `DeviceDetailView` integration

**Files:**
- Create: `components/devices/ReadingsPanel.tsx`
- Modify: `components/devices/DeviceDetailView.tsx` (replace the inline chart in the readings tab; drop its recharts imports and `formatReadingsForChart`)
- Modify: `components/DeviceDetailModal.tsx` and `app/devices/[id]/page.tsx` (pass `readingsTotal` through)
- Test: `__tests__/unit/components/ReadingsPanel.test.tsx` (create), `__tests__/unit/components/DeviceDetailView.test.tsx` (update)
- Modify: `CLAUDE.md` (component list: add `ReadingsPanel` under the devices components)

**Interfaces:**
- Consumes: everything Task 1 produces; `DeviceV2Response`, `ReadingV2Response` from `@/types/v2`.
- Produces: `ReadingsPanel` default export with props `{ device: DeviceV2Response; recentReadings: ReadingV2Response[]; readingsTotal: number | null }`. `DeviceDetailView` gains optional prop `readingsTotal?: number | null`. Task 4 modifies `ReadingsPanel` in place.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/unit/components/ReadingsPanel.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DeviceV2Response, ReadingV2Response } from '@/types/v2';
import ReadingsPanel from '@/components/devices/ReadingsPanel';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/unit/components/ReadingsPanel.test.tsx`
Expected: FAIL — cannot resolve `@/components/devices/ReadingsPanel`.

- [ ] **Step 3: Implement `ReadingsPanel`**

Create `components/devices/ReadingsPanel.tsx`:

```tsx
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
      <Tooltip formatter={(value: number) => format(value)} />
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/unit/components/ReadingsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Integrate into `DeviceDetailView` and its two callers**

In `components/devices/DeviceDetailView.tsx`:

1. Delete the recharts import block (`LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer`) and the `formatReadingsForChart` function — the readings tab was their only consumer.
2. Add `import ReadingsPanel from './ReadingsPanel';`
3. Add `readingsTotal?: number | null;` to `DeviceDetailViewProps` with the doc comment `/** Server total for the 24h readings window; passed through to ReadingsPanel. */`, and destructure it in the component signature.
4. Replace the readings tab content (everything inside `{activeTab === 'readings' && (…)}` **after** the `TemperatureCorrelationPanel` line — the "Standard Readings Chart" `div`) with:

```tsx
{activeTab === 'readings' && (
  <div className="space-y-6">
    {/* Temperature Correlation Panel for temperature devices */}
    {device.type === 'temperature' && <TemperatureCorrelationPanel deviceId={device._id} />}

    <ReadingsPanel
      device={device}
      recentReadings={recentReadings}
      readingsTotal={readingsTotal ?? null}
    />
  </div>
)}
```

In `components/DeviceDetailModal.tsx` and `app/devices/[id]/page.tsx`: both already destructure from `useDeviceDetail` and pass `device/recentReadings/auditLog/auditTotal` to `<DeviceDetailView>`. Add `readingsTotal` to each destructuring and pass `readingsTotal={readingsTotal}` alongside `auditTotal`.

- [ ] **Step 6: Update `DeviceDetailView.test.tsx`**

In `__tests__/unit/components/DeviceDetailView.test.tsx`:

1. Delete the `jest.mock('recharts', …)` block (DeviceDetailView no longer imports recharts).
2. Add a `ReadingsPanel` mock next to the existing `TemperatureCorrelationPanel` mock:

```tsx
jest.mock('@/components/devices/ReadingsPanel', () => {
  const ReadingsPanel = (props: {
    device: { _id: string };
    recentReadings: unknown[];
    readingsTotal: number | null;
  }) => (
    <div data-testid="readings-panel" data-total={String(props.readingsTotal)}>
      {props.recentReadings.length} readings
    </div>
  );
  ReadingsPanel.displayName = 'ReadingsPanel';
  return ReadingsPanel;
});
```

3. Rewrite any existing readings-tab assertions that targeted the inline chart (the `readings-chart` testid, the "Recent Readings (Last 24 Hours)" heading, or the no-readings empty state — that state now lives inside ReadingsPanel) to assert the panel mock instead:

```tsx
it('hands the readings tab to ReadingsPanel with the server total', () => {
  render(
    <DeviceDetailView
      device={createDevice()}
      recentReadings={[createReading()]}
      auditLog={[]}
      readingsTotal={2880}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /readings/i }));
  const panel = screen.getByTestId('readings-panel');
  expect(panel).toHaveAttribute('data-total', '2880');
  expect(panel).toHaveTextContent('1 readings');
});
```

(Adapt `createReading()` to the file's existing reading fixture helper if it has one; otherwise reuse the fixture shape from ReadingsPanel.test.tsx. Keep the existing temperature-correlation assertion — that behavior is unchanged.)

- [ ] **Step 7: Run the affected suites**

Run: `npx jest __tests__/unit/components/ReadingsPanel.test.tsx __tests__/unit/components/DeviceDetailView.test.tsx __tests__/unit/components/DeviceDetailModal.test.tsx __tests__/unit/lib/useDeviceDetail.test.tsx`
Expected: PASS. (`DeviceDetailModal.test.tsx` mocks `DeviceDetailView` or the hook — if it renders the real view, the new optional prop defaults safely.)

- [ ] **Step 8: Update CLAUDE.md component list**

In CLAUDE.md's project-structure listing, after the `components/devices/useDeviceDetail.ts` line, add:

```markdown
  devices/ReadingsPanel.tsx        # Type-aware readings chart + stats (registry-driven, live appends)
```

- [ ] **Step 9: Verify and commit**

Run: `npx tsc --noEmit`, `npx eslint components/devices/ReadingsPanel.tsx components/devices/DeviceDetailView.tsx components/DeviceDetailModal.tsx 'app/devices/[id]/page.tsx' __tests__/unit/components/ReadingsPanel.test.tsx __tests__/unit/components/DeviceDetailView.test.tsx`.

```bash
git add components/devices/ReadingsPanel.tsx components/devices/DeviceDetailView.tsx components/DeviceDetailModal.tsx 'app/devices/[id]/page.tsx' __tests__/unit/components/ReadingsPanel.test.tsx __tests__/unit/components/DeviceDetailView.test.tsx CLAUDE.md
git commit -m "feat: type-aware ReadingsPanel replaces the one-size-fits-all readings chart"
```

---

### Task 4: Live updates via Pusher

**Files:**
- Modify: `lib/pusher-context.tsx` (widen `PusherReading.metadata.type` to `ReadingType`)
- Modify: `components/devices/ReadingsPanel.tsx` (subscription + live buffer)
- Modify: `app/providers.tsx` (comment only: add ReadingsPanel to the list of live-readings consumers above `PusherProvider`)
- Test: `__tests__/unit/components/ReadingsPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `usePusherReadings(callback: (readings: PusherReading[]) => void): void` and `PusherReading` from `@/lib/pusher-context`; `MAX_CHART_POINTS`, `ChartPoint` from Task 1; `ReadingsPanel` from Task 3.
- Produces: no new exports — `ReadingsPanel` behavior change only.

**Background for the implementer:** the server broadcast (`ReadingBroadcast` in `lib/pusher-readings.ts`) already types `metadata.type` as the full 15-member `ReadingType` and documents "Must stay assignable to `PusherReading`". The client's `PusherReading.metadata.type` is a stale 4-member union (`'temperature' | 'humidity' | 'occupancy' | 'power'`) — the readings of the other 11 types already arrive on the wire; only the type annotation is behind. Widening it is the correction the server-side comment anticipates.

- [ ] **Step 1: Write the failing tests**

Extend `__tests__/unit/components/ReadingsPanel.test.tsx`. Add to the imports and mocks:

```tsx
import { act } from '@testing-library/react';
import { usePusherReadings } from '@/lib/pusher-context';
import type { PusherReading } from '@/lib/pusher-context';

jest.mock('@/lib/pusher-context', () => ({
  usePusherReadings: jest.fn(),
}));
```

(The Task 3 tests keep passing: with the hook mocked to a no-op, static rendering is unchanged.)

Add the describe block:

```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/unit/components/ReadingsPanel.test.tsx`
Expected: the live-updates block FAILS (`usePusherReadings` never called). Task 3 tests still pass.

- [ ] **Step 3: Widen `PusherReading.metadata.type`**

In `lib/pusher-context.tsx`, add to the type imports:

```typescript
import type { ReadingType } from '@/types/v2/reading.types';
```

and change the `PusherReading` interface:

```typescript
export interface PusherReading {
  metadata: {
    device_id: string;
    type: ReadingType;
  };
  timestamp: string;
  value: number;
}
```

Run `npx tsc --noEmit` immediately. If a consumer (`FloorPlan.tsx`, `DeviceGrid.tsx`, `AnomalyChart.tsx`) narrowed on the old 4-member union, fix it at the consumer by handling the wider union (e.g. a `switch` gains a default case) — do **not** re-narrow the shared type.

- [ ] **Step 4: Implement the subscription in `ReadingsPanel`**

In `components/devices/ReadingsPanel.tsx`:

Add imports:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePusherReadings, type PusherReading } from '@/lib/pusher-context';
import { MAX_CHART_POINTS } from '@/lib/utils/reading-display';
```

(fold `useCallback`/`useEffect`/`useState` into the existing react import; add `MAX_CHART_POINTS` to the existing reading-display import.)

Inside the component, above the `points` memo:

```tsx
const [livePoints, setLivePoints] = useState<ChartPoint[]>([]);

// A new device or a fresh fetch invalidates the live buffer — without this,
// live points from the previously viewed device leak into the next chart.
useEffect(() => {
  setLivePoints([]);
}, [device._id, recentReadings]);

usePusherReadings(
  useCallback(
    (incoming: PusherReading[]) => {
      // The public channel carries the whole fleet; keep only this device's
      // own readings (and only its own type, defensively).
      const mine = incoming.filter(
        reading =>
          reading.metadata.device_id === device._id && reading.metadata.type === device.type
      );
      if (mine.length === 0) return;
      setLivePoints(previous =>
        [
          ...previous,
          // Live payloads carry no quality object, so anomaly dots appear
          // only on fetched readings (accepted in the design spec).
          ...mine.map(reading => ({
            timestamp: reading.timestamp,
            value: reading.value,
            isAnomaly: false,
          })),
        ].slice(-MAX_CHART_POINTS)
      );
    },
    [device._id, device.type]
  )
);
```

Change the `points` memo to merge and trim:

```tsx
// The hook returns newest-first; the chart and stats want ascending time.
// Live points are appended after the fetched window and the merged series is
// trimmed from the FRONT so the newest MAX_CHART_POINTS always win.
const points = useMemo(() => {
  const fetched = recentReadings.map(toChartPoint).reverse();
  return [...fetched, ...livePoints].slice(-MAX_CHART_POINTS);
}, [recentReadings, livePoints]);
```

The truncation heading keeps using `recentReadings.length` (the fetched count vs. the server total) — live appends do not change what the fetch covered.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/unit/components/ReadingsPanel.test.tsx`
Expected: PASS — live-updates block and all Task 3 tests.

- [ ] **Step 6: Update the providers.tsx consumer comment**

In `app/providers.tsx`, the comment above `<PusherProvider>` reads "PusherProvider stays an ancestor of {children}: DeviceGrid, FloorPlan and AnomalyChart read live readings through its context…". Change that sentence's component list to "DeviceGrid, FloorPlan, AnomalyChart and ReadingsPanel". No code change.

- [ ] **Step 7: Verify everything and commit**

Run:
- `npx jest __tests__/unit/components/ReadingsPanel.test.tsx __tests__/unit/components/DeviceDetailView.test.tsx __tests__/unit/lib/useDeviceDetail.test.tsx __tests__/unit/utils/reading-display.test.ts`
- `npx tsc --noEmit`
- `npx eslint components/devices/ReadingsPanel.tsx lib/pusher-context.tsx __tests__/unit/components/ReadingsPanel.test.tsx`

Expected: all PASS/clean.

```bash
git add lib/pusher-context.tsx components/devices/ReadingsPanel.tsx app/providers.tsx __tests__/unit/components/ReadingsPanel.test.tsx
git commit -m "feat: live Pusher appends on the readings chart; widen PusherReading to all 15 types"
```
