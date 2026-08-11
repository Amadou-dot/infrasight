# Type-Specific Readings Tab — Design

**Date:** 2026-08-11
**Status:** Approved by user (brainstorming session)
**Depends on:** PR #124 (`fix/count-display-truthfulness`) — builds on its versions of `useDeviceDetail.ts` and `DeviceDetailView.tsx`.

## Problem

The device detail Readings tab treats every one of the 15 device types identically: one
unlabeled blue line chart. A CO₂ sensor reporting ppm, a motion sensor reporting 0/1
booleans, and an energy meter reporting watt-hours all get the same rendering, with no
units, no stats, and no thresholds. Only temperature devices get anything type-specific
(`TemperatureCorrelationPanel`).

The tab also lies about its window: the heading says "Last 24 Hours" but the fetch caps at
the newest 100 readings — for a device sampling every minute, that is under 2 hours of
data labeled as 24.

## Decision summary

Chosen approach (option A of three considered): **a display registry driving one smart
chart component, fed by raw readings.** Rejected: server-side aggregation (loses per-point
anomaly flags, fights live appends, blurs motion/occupancy into averages) and bespoke
panels per type (~15× the code for repeated structure).

User-selected extras: **anomaly markers** and **live updates via Pusher**. Explicitly not
in scope: per-point confidence/validity display, new server endpoints, changes to
`TemperatureCorrelationPanel`.

## Components

### 1. `lib/utils/reading-display.ts` (new — pure, no React)

- `READING_DISPLAY: Record<ReadingType, ReadingDisplayConfig>` where the config carries:
  - `label: string` — human name ("CO₂", "Water flow", …).
  - `chart: 'line' | 'step' | 'bar'` — `line` for the 12 analog types; `step` for
    `motion` and `occupancy`; `bar` for `energy`.
  - `stats: 'continuous' | 'events'` — `continuous` renders current/min/avg/max;
    `events` (motion only) renders event count (readings with value ≥ 1) and time of the
    last event.
  - `decimals: number` — value formatting precision.
- Keying by the full `ReadingType` union makes a future 16th type a **compile error**
  here (same pattern as `TYPE_SENSITIVITY` in `lib/simulation/readings.ts`). This file
  becomes a new row in CLAUDE.md's "Adding a New Device / Reading Type" checklist,
  in the `tsc`-guarded table.
- `UNIT_SYMBOL: Record<ReadingUnit, string>` — `'celsius' → '°C'`, `'ppm' → 'ppm'`,
  `'liters_per_minute' → 'L/min'`, etc. Unit display comes from each reading's own
  `metadata.unit` (a Fahrenheit temperature sensor labels itself °F); an unknown unit at
  runtime falls back to the raw unit string.
- `summarizeReadings(readings): ReadingSummary` — pure stats helper (current, min, max,
  avg, count, anomalyCount, and the events variant), unit-testable without a DOM.

### 2. `components/devices/ReadingsPanel.tsx` (new)

Replaces the inline chart block inside `DeviceDetailView`'s readings tab. Receives
`device`, `recentReadings`, `readingsTotal` as props. Renders:

- The type-appropriate Recharts shape (`LineChart` with `type="monotone"` or
  `type="stepAfter"`, or `BarChart`), Y-axis and tooltip labeled with the unit symbol.
- Warning/critical `ReferenceLine`s from `device.configuration.threshold_warning` /
  `threshold_critical`, rendered **only** when the value is an actual number
  (`typeof === 'number'` — no truthiness guards, no `|| 9999` fallbacks).
- Anomaly markers: a custom `dot` renderer draws a red filled dot when
  `quality.is_anomaly`, the ordinary 2px dot otherwise. No extra query — the flag is on
  each fetched reading.
- The stats row per the registry's `stats` kind.
- An honest heading: "Readings — last 24h" when the fetch covered the window, or
  "Newest N of T readings (last 24h)" when capped.
- Empty state unchanged ("No recent readings available").

`TemperatureCorrelationPanel` stays exactly where it is, above this panel, for
temperature devices.

### 3. `useDeviceDetail` (changed)

- Still fetches the 24h window newest-first (server default sort), but follows
  `pagination.total` across additional pages, capped at **5 pages / 500 points**.
- Exposes `readingsTotal: number | null` (server total for the window; `null` until the
  readings fetch resolves, mirroring `auditTotal`) alongside `recentReadings`.
- If a later page fetch fails, keep the pages that succeeded and report what was actually
  loaded — partial data honestly labeled beats an error wiping the chart.

## Live updates

`ReadingsPanel` subscribes through the existing `usePusherReadings` (public
`READINGS_CHANNEL`; `PusherProvider` already wraps both detail surfaces). Handler rules:

- Keep only events where `metadata.device_id` matches this device **and**
  `metadata.type` matches the device type; append the point; trim the oldest past the
  500-point cap. The negative case (another device's reading) must be tested.
- Live payloads carry no `quality` object, so live-appended points render as plain
  points — anomaly dots appear only on fetched readings. Accepted limitation.
- The panel mounts only while the Readings tab is active, so tab-switch unsubscribes via
  the normal effect-cleanup pattern.
- Stats recompute from the merged array, so "current" tracks live.

## Data flow

Modal and `/devices/[id]` both render `DeviceDetailView` → `ReadingsPanel`. The panel
owns only chart-local state (live-appended points, seeded from the `recentReadings`
prop). No new endpoints, no server changes, no React Query changes.

## Error handling

| Case | Behavior |
| --- | --- |
| No readings in window | Existing empty state |
| Unknown `ReadingUnit` at runtime | Fall back to raw unit string |
| Thresholds absent/non-numeric | No reference lines (explicit `typeof` check) |
| Later readings page fails | Keep earlier pages, label actual count shown |
| Mixed units in one window | Label from the newest reading's unit |
| Unknown `ReadingType` at runtime | Defensive fallback config: line chart, continuous stats, raw unit |

## Testing

- **Unit:** `summarizeReadings` (continuous, events, empty), `UNIT_SYMBOL` fallback.
  Registry completeness needs no test — `tsc` enforces it.
- **Component (jsdom):** step shape for motion, bars for energy, line otherwise; unit
  label rendered; threshold lines only when numeric; anomaly dot on flagged points; live
  append via mocked `usePusherReadings` including the wrong-device negative case;
  truncation heading vs. full-window heading.
- **Hook:** `useDeviceDetail` multi-page follow, 5-page cap, `readingsTotal`, page-failure
  partial-keep.

## Docs

- CLAUDE.md: add `lib/utils/reading-display.ts` to the "Adding a New Device / Reading
  Type" checklist (`tsc`-guarded table) and mention `ReadingsPanel` in the component list.
