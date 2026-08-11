# Count & Display Truthfulness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every count and list shown in the UI reflects database truth — no capped array lengths displayed as totals, no fabricated numbers, no silently truncated fleets.

**Architecture:** Fix the one field-name bug that breaks all-pages device fetching, then move every displayed count onto a server-authoritative source (`pagination.total`, `countDocuments`), and delete data the UI invents. One server route changes (health analytics); everything else is client hooks/components.

**Tech Stack:** Next.js 16 App Router, TypeScript 6, React Query 5, Mongoose 9, Jest 30 + Testing Library, mongodb-memory-server for integration tests.

## Global Constraints

- A number displayed to the user must come from a server total (`pagination.total`, `countDocuments`, or an uncapped aggregate) — never from the length of a limit-capped array.
- Server-side `MAX_PAGE_SIZE` stays 100 and validation caps are not raised (`lib/validations/common.validation.ts`).
- No new npm dependencies.
- Verification for every task: the task's named jest tests pass, plus `npx tsc --noEmit` clean, plus `npx eslint <changed files>` clean.
- Unit tests run with `npx jest __tests__/unit/...`; integration tests with `npx jest __tests__/integration/...` (mongodb-memory-server boots automatically).
- Follow existing response conventions: v2 routes use `jsonSuccess`/`jsonPaginated` (`lib/api/response.ts`); the health route's cached-payload builder shape is extended, not restructured.
- Commit at the end of each task with a conventional message (`fix:`, `test:`, `refactor:`).
- Do not modify anything under `models/` (timeseries constraints) or any RBAC checks.

---

### Task 1: Fix the pagination field mismatch and the schedule-modal 400

The all-pages branch of `useDevicesList` reads `firstResponse.pagination?.pages`, but the server emits `totalPages` (see `calculateOffsetPagination` in `lib/api/pagination.ts:263-274`, which returns `{ total, page, limit, totalPages, hasNext, hasPrevious }`). `pages` is always `undefined`, so `?? 1` collapses every "fetch all" to a single page of 100 devices. The client type `PaginatedResponse` (`types/v2/api.types.ts:168-180`) declares `pages` and `hasPrev`, which is why tsc never caught it. Separately, `ScheduleServiceModal` passes `limit: 500`, which the server rejects with a 400 (`max(100)`), so the schedule-service device picker always fails.

**Files:**
- Modify: `lib/query/hooks/useDevicesList.ts:19`
- Modify: `types/v2/api.types.ts:168-180`
- Modify: `components/ScheduleServiceModal.tsx:84-87`
- Test: `__tests__/unit/lib/useDevicesList.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `useDevicesList(filters)` with no `page`/`limit` now genuinely returns the whole fleet (up to the existing 20-page/2000 cap). Tasks 2 and 7 rely on this. `PaginatedResponse<T>['pagination']` is now `{ total: number; page: number; limit: number; totalPages: number; hasNext: boolean; hasPrevious: boolean }`.

- [ ] **Step 1: Update the hook test to describe the real wire shape (failing test)**

In `__tests__/unit/lib/useDevicesList.test.ts`, replace every `pagination: { pages: ... }` mock with the field the server actually sends. Three places:

The module-level mock (top of file):
```typescript
jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    devices: {
      list: jest.fn().mockResolvedValue({
        success: true,
        data: [{ _id: 'device_001', name: 'Test Device' }],
        pagination: { totalPages: 1, total: 1, page: 1, limit: 100 },
      }),
    },
  },
}));
```

The multi-page test (`should fetch multiple pages in parallel when totalPages > 1`): change all three `pagination: { pages: 3, total: 250 }` to `pagination: { totalPages: 3, total: 250 }`.

The cap test (`should cap at 20 pages maximum`): change `pagination: { pages: 50, total: 5000 }` to `pagination: { totalPages: 50, total: 5000 }`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/unit/lib/useDevicesList.test.ts -t "multiple pages" -t "cap at 20"`
Expected: FAIL — the hook reads `.pages`, mocks now only provide `totalPages`, so only 1 call happens instead of 3 (and 20).

- [ ] **Step 3: Fix the hook**

In `lib/query/hooks/useDevicesList.ts:19`:
```typescript
        const totalPages = Math.min(firstResponse.pagination?.totalPages ?? 1, 20);
```

- [ ] **Step 4: Fix the lying type**

In `types/v2/api.types.ts`, `PaginatedResponse`:
```typescript
export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  timestamp: string;
}
```

Then run `grep -rn "pagination.pages\|pagination\.hasPrev\b" --include='*.ts' --include='*.tsx' lib app components types` and fix any other consumer of the old field names the same way (expected: none besides the hook, but verify).

- [ ] **Step 5: Fix the schedule modal**

In `components/ScheduleServiceModal.tsx:84-87`, delete the `limit` line so the hook takes the all-pages branch:
```typescript
  const { data: devices = [], isLoading: devicesLoading, error: devicesError } = useDevicesList({
    status: 'active',
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/unit/lib/useDevicesList.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add lib/query/hooks/useDevicesList.ts types/v2/api.types.ts components/ScheduleServiceModal.tsx __tests__/unit/lib/useDevicesList.test.ts
git commit -m "fix: read totalPages from device pagination so all-pages fetch works; unbreak schedule modal device picker"
```

---

### Task 2: Floor plan shows the whole fleet

`components/FloorPlan.tsx:61` fetches exactly one page (`v2Api.devices.list({ limit: 100 })`), so with the first building auto-selected only ~23 devices render out of ~500. Two adjacent defects: the floor-grouping guard `if (floor)` drops floor `0`/missing-floor devices, and the status thresholds `value > (threshold || 9999)` mean a device with missing thresholds can never be Critical/Warning.

**Files:**
- Create: `lib/utils/floor-plan.ts`
- Create test: `__tests__/unit/utils/floor-plan.test.ts`
- Modify: `components/FloorPlan.tsx:56-70` (device fetch), `:186-224` (getStatusInfo), `:239-249` (grouping)

**Interfaces:**
- Consumes: Task 1's fixed `useDevicesList` (all-pages fetch).
- Produces: `lib/utils/floor-plan.ts` exporting:
  - `getDeviceStatusLevel(device: Pick<DeviceV2Response, 'configuration'>, value: number | undefined): 'offline' | 'critical' | 'warning' | 'normal'`
  - `groupDevicesByFloor(devices: DeviceV2Response[]): Record<number, DeviceV2Response[]>` (floor 0 kept; devices with `location.floor == null` excluded)

- [ ] **Step 1: Write failing tests for the pure helpers**

`__tests__/unit/utils/floor-plan.test.ts`:
```typescript
import { getDeviceStatusLevel, groupDevicesByFloor } from '@/lib/utils/floor-plan';
import type { DeviceV2Response } from '@/types/v2';

const dev = (over: Record<string, unknown> = {}) =>
  ({ _id: 'd1', configuration: { threshold_warning: 30, threshold_critical: 40 }, location: { floor: 1 }, ...over }) as unknown as DeviceV2Response;

describe('getDeviceStatusLevel', () => {
  it('is offline when there is no reading', () => {
    expect(getDeviceStatusLevel(dev(), undefined)).toBe('offline');
  });
  it('is critical above the critical threshold', () => {
    expect(getDeviceStatusLevel(dev(), 41)).toBe('critical');
  });
  it('is warning above warning but at/below critical', () => {
    expect(getDeviceStatusLevel(dev(), 35)).toBe('warning');
  });
  it('is normal at/below warning', () => {
    expect(getDeviceStatusLevel(dev(), 30)).toBe('normal');
  });
  it('treats a zero threshold as a real threshold, not "unset"', () => {
    expect(
      getDeviceStatusLevel(dev({ configuration: { threshold_warning: 0, threshold_critical: 10 } }), 5)
    ).toBe('warning');
  });
  it('is normal (never critical) when thresholds are missing', () => {
    expect(getDeviceStatusLevel(dev({ configuration: undefined }), 99999)).toBe('normal');
  });
});

describe('groupDevicesByFloor', () => {
  it('keeps floor 0 devices', () => {
    const grouped = groupDevicesByFloor([dev({ location: { floor: 0 } })]);
    expect(grouped[0]).toHaveLength(1);
  });
  it('drops devices with no floor rather than crashing', () => {
    const grouped = groupDevicesByFloor([dev({ location: {} }), dev({ location: { floor: 2 } })]);
    expect(Object.keys(grouped)).toEqual(['2']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/unit/utils/floor-plan.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/utils/floor-plan.ts`**

```typescript
import type { DeviceV2Response } from '@/types/v2';

export type DeviceStatusLevel = 'offline' | 'critical' | 'warning' | 'normal';

/**
 * Threshold comparison for the floor-plan tile status.
 *
 * `typeof === 'number'` (not `||`) so a configured threshold of 0 counts and a
 * missing threshold disables that level instead of comparing against a magic
 * 9999 — under which a device with no thresholds could never leave "Normal".
 */
export function getDeviceStatusLevel(
  device: Pick<DeviceV2Response, 'configuration'>,
  value: number | undefined
): DeviceStatusLevel {
  if (value === undefined) return 'offline';
  const critical = device.configuration?.threshold_critical;
  const warning = device.configuration?.threshold_warning;
  if (typeof critical === 'number' && value > critical) return 'critical';
  if (typeof warning === 'number' && value > warning) return 'warning';
  return 'normal';
}

/** Groups by floor keeping floor 0; devices without a floor are omitted. */
export function groupDevicesByFloor(
  devices: DeviceV2Response[]
): Record<number, DeviceV2Response[]> {
  const grouped: Record<number, DeviceV2Response[]> = {};
  for (const d of devices) {
    const floor = d.location?.floor;
    if (floor == null) continue;
    (grouped[floor] ??= []).push(d);
  }
  return grouped;
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `npx jest __tests__/unit/utils/floor-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire FloorPlan.tsx**

1. Replace the device-fetch `useEffect` (lines 56-70) and the `const [devices, setDevices] = useState(...)` it feeds with the hook (import from `@/lib/query/hooks`):
```typescript
  const { data: devices = [] } = useDevicesList();
```
Remove the now-unused `setLoading`/`loading` state if nothing else consumes it. The readings-fetch effect keeps its `[devices]`-shaped dependency (now the hook's array) and its existing batch-of-50 loop.
2. In `getStatusInfo`, replace the two threshold lines with the helper:
```typescript
    const level = getDeviceStatusLevel(device, value);
    if (level === 'offline') return { /* existing offline object */ };
    if (level === 'critical') return { /* existing critical object */ };
    if (level === 'warning') return { /* existing warning object */ };
    return { /* existing normal object */ };
```
(Keep the four existing return objects verbatim; only the branching changes.)
3. In the `groupedDevices` memo, replace the manual `grouped` loop (the `if (floor)` block) with `groupDevicesByFloor(filtered)`.

- [ ] **Step 6: Full verification**

Run: `npx jest __tests__/unit/utils/floor-plan.test.ts && npx tsc --noEmit && npx eslint components/FloorPlan.tsx lib/utils/floor-plan.ts`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add lib/utils/floor-plan.ts __tests__/unit/utils/floor-plan.test.ts components/FloorPlan.tsx
git commit -m "fix: floor plan loads full fleet, keeps floor-0 devices, honest thresholds"
```

---

### Task 3: Remove fabricated UI data

Four places show numbers the system never measured: a literal "↗ +4 new this week" under Total Devices; a "+N New" badge computed as `Math.min(2, critical.length)`; a "Next 7 Days" badge over data fetched with `days_ahead: 30`; and CriticalIssuesPanel rendering "N min ago" from `Date.now()` at mount for issues the server sends no timestamp for.

**Files:**
- Modify: `app/devices/_components/DeviceStatusCards.tsx:44`
- Modify: `app/maintenance/page.tsx:19,196-203`
- Modify: `components/MaintenanceStatusCards.tsx` (props + Critical card badge + `daysForDue` default)
- Modify: `components/dashboard/CriticalIssuesPanel.tsx:46-125,245-246`
- Test: `__tests__/unit/components/MaintenanceStatusCards.test.tsx` (create), `__tests__/unit/components/CriticalIssuesPanel.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `MaintenanceStatusCardsProps` loses `criticalNew`; `daysForDue` becomes required (`daysForDue: number`). `CriticalIssue.timestamp` becomes `Date | null`.

- [ ] **Step 1: Write failing tests**

`__tests__/unit/components/MaintenanceStatusCards.test.tsx`:
```typescript
import { render, screen } from '@testing-library/react';
import MaintenanceStatusCards from '@/components/MaintenanceStatusCards';

describe('MaintenanceStatusCards', () => {
  it('labels the due-for-service window with the fetch window it was given', () => {
    render(
      <MaintenanceStatusCards criticalCount={3} dueForServiceCount={5} healthyCount={10} daysForDue={30} />
    );
    expect(screen.getByText('Next 30 Days')).toBeInTheDocument();
  });

  it('renders no fabricated "New" badge', () => {
    render(
      <MaintenanceStatusCards criticalCount={3} dueForServiceCount={5} healthyCount={10} daysForDue={30} />
    );
    expect(screen.queryByText(/New/)).not.toBeInTheDocument();
  });
});
```

`__tests__/unit/components/CriticalIssuesPanel.test.tsx` (mock the two hooks the panel uses; assert no relative time is invented for an error-device issue, and that offline issues with a real `last_seen` still show one):
```typescript
import { render, screen } from '@testing-library/react';
import CriticalIssuesPanel from '@/components/dashboard/CriticalIssuesPanel';

const mockHealth = jest.fn();
const mockForecast = jest.fn();
jest.mock('@/lib/query/hooks', () => ({
  useHealthAnalytics: () => mockHealth(),
  useMaintenanceForecast: () => mockForecast(),
}));

function healthWith(alerts: Record<string, unknown>) {
  return { data: { alerts }, isLoading: false, error: null };
}

describe('CriticalIssuesPanel timestamps', () => {
  beforeEach(() => {
    mockForecast.mockReturnValue({ data: { summary: { maintenance_overdue: [] }, critical: [] }, isLoading: false, error: null });
  });

  it('shows no relative time for issues the server sends no timestamp for', () => {
    mockHealth.mockReturnValue(
      healthWith({
        error_devices: { count: 1, devices: [{ _id: 'device_009', serial_number: 'SN-1009', location: { room_name: 'Lab' } }] },
      })
    );
    render(<CriticalIssuesPanel />);
    expect(screen.getByText(/Error/)).toBeInTheDocument();
    expect(screen.queryByText(/ago|Just now/i)).not.toBeInTheDocument();
  });

  it('still shows a relative time when the server provides one', () => {
    mockHealth.mockReturnValue(
      healthWith({
        offline_devices: {
          count: 1,
          devices: [{ _id: 'device_010', serial_number: 'SN-1010', location: { room_name: 'Roof', floor: 3 }, health: { last_seen: new Date(Date.now() - 5 * 60_000).toISOString() } }],
        },
      })
    );
    render(<CriticalIssuesPanel />);
    expect(screen.getByText(/ago|Just now/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx jest __tests__/unit/components/MaintenanceStatusCards.test.tsx __tests__/unit/components/CriticalIssuesPanel.test.tsx`
Expected: FAIL — "+2 New"/"Next 7 Days" render today; error issues render a fabricated "Just now".

- [ ] **Step 3: Implement the four removals**

1. `DeviceStatusCards.tsx`: delete the line `<span className="text-xs text-emerald-500">↗ +4 new this week</span>`.
2. `MaintenanceStatusCards.tsx`: remove `criticalNew` from the props interface, destructuring, and delete the `{criticalNew > 0 && (<Badge ...>+{criticalNew} New</Badge>)}` block. Change `daysForDue = 7` to a required prop `daysForDue: number` (no default).
3. `app/maintenance/page.tsx`: delete `_MAX_PAGINATION_PAGES` (line 19). Add near the other constants:
```typescript
/** Forecast window; also labels the "Due for Service" card. */
const FORECAST_DAYS_AHEAD = 30;
```
Use it in the fetch (`useMaintenanceForecast({ days_ahead: FORECAST_DAYS_AHEAD })`) and in the JSX: remove the `criticalNew={...}` prop and pass `daysForDue={FORECAST_DAYS_AHEAD}`.
4. `CriticalIssuesPanel.tsx`: delete the `fallbackTime` state. Change `CriticalIssue.timestamp` to `Date | null` (the interface is at the top of the file). For each issue builder: offline uses `d.health?.last_seen ? new Date(d.health.last_seen) : null`; error and battery use `null`; the two maintenance builders use `d.metadata?.next_maintenance ? new Date(...) : null`. Sort: critical first, then by timestamp descending with `null` last:
```typescript
    collectedIssues.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      if (!a.timestamp) return b.timestamp ? 1 : 0;
      if (!b.timestamp) return -1;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
```
Render (line ~245): wrap the time span in `{issue.timestamp && (<span ...>{formatTimeAgo(issue.timestamp)}</span>)}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/unit/components/MaintenanceStatusCards.test.tsx __tests__/unit/components/CriticalIssuesPanel.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean (tsc also proves no other caller still passes `criticalNew`).

- [ ] **Step 5: Commit**

```bash
git add app/devices/_components/DeviceStatusCards.tsx components/MaintenanceStatusCards.tsx app/maintenance/page.tsx components/dashboard/CriticalIssuesPanel.tsx __tests__/unit/components/MaintenanceStatusCards.test.tsx __tests__/unit/components/CriticalIssuesPanel.test.tsx
git commit -m "fix: remove fabricated counts, badges, and timestamps from dashboards"
```

---

### Task 4: Health analytics returns true counts; dashboard stops double-counting

`app/api/v2/analytics/health/route.ts` runs five category queries with `.limit(50)` and then reports `count: array.length` — every count saturates at 50. The dashboard then sums three of those capped, overlapping buckets. Fix: real `countDocuments` per category, plus one distinct `devices_with_issues` count for the dashboard.

**Files:**
- Modify: `app/api/v2/analytics/health/route.ts:100-260` (query fan-out), `:295-340` (payload)
- Modify: `lib/api/v2-client.ts` (HealthAnalyticsResponse `alerts` type — find `offline_devices` in the interface near line 318)
- Modify: `app/page.tsx:60-65`
- Modify: `components/dashboard/SystemHealthWidget.tsx:17-20`
- Test: `__tests__/integration/api/analytics.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: each `alerts.<category>` object's `count` is now a `countDocuments` result; `alerts.devices_with_issues: { count: number }` is new — the **distinct** number of devices that are offline, low-battery, or in error (no double counting). Device arrays stay capped at 10 as before.

- [ ] **Step 1: Write the failing integration test**

In `__tests__/integration/api/analytics.test.ts`, add (following the file's existing setup pattern for creating devices and calling the route):
```typescript
describe('GET /api/v2/analytics/health — true counts', () => {
  it('reports category counts beyond the 50-row document cap and a distinct issue count', async () => {
    // 60 error devices, 30 of which also have low battery
    const devices = Array.from({ length: 60 }, (_, i) => ({
      _id: `device_err_${i}`,
      serial_number: `SN-ERR-${i}`,
      type: 'temperature',
      status: 'error',
      location: { building_id: 'bldg_a', floor: 1, room_name: `R${i}` },
      health: { battery_level: i < 30 ? 10 : 90, uptime_percentage: 99 },
    }));
    await DeviceV2.create(devices);

    const response = await GET(makeRequest('/api/v2/analytics/health'));
    const body = await response.json();

    expect(body.data.alerts.error_devices.count).toBe(60);        // not 50
    expect(body.data.alerts.low_battery_devices.count).toBe(30);
    expect(body.data.alerts.error_devices.devices.length).toBeLessThanOrEqual(10);
    // 60 distinct devices have at least one issue — NOT 60 + 30
    expect(body.data.alerts.devices_with_issues.count).toBe(60);
  });
});
```
Adapt `makeRequest`/route import and any required base fields for `DeviceV2.create` to the patterns already in this test file — device documents must satisfy the schema (copy required fields from an existing helper in the file if one exists).

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/integration/api/analytics.test.ts -t "true counts"`
Expected: FAIL — `error_devices.count` is 50.

- [ ] **Step 3: Implement the route change**

In the `Promise.all` fan-out:
1. Change each of the five category `.find(...)` calls from `.limit(50)` to `.limit(10)` (only 10 were ever returned; fetching 50 was waste).
2. Add six parallel count queries after the existing entries (destructure alongside the others):
```typescript
          offlineCount,
          lowBatteryCount,
          errorCount,
          maintenanceDueCount,
          predictiveCount,
          devicesWithIssuesCount,
```
```typescript
          DeviceV2.countDocuments({ ...baseFilter, 'health.last_seen': { $lt: offlineThreshold } }).maxTimeMS(5000),
          DeviceV2.countDocuments({ ...baseFilter, 'health.battery_level': { $lt: query.battery_warning_threshold, $ne: null } }).maxTimeMS(5000),
          DeviceV2.countDocuments({ ...baseFilter, status: 'error' }).maxTimeMS(5000),
          DeviceV2.countDocuments({ ...baseFilter, 'metadata.next_maintenance': { $lte: maintenanceDueDate, $ne: null } }).maxTimeMS(5000),
          DeviceV2.countDocuments({
            ...baseFilter,
            $or: [
              { 'health.battery_level': { $lt: 15, $ne: null } },
              { 'metadata.next_maintenance': { $lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), $ne: null } },
              { 'health.error_count': { $gt: 10 } },
            ],
          }).maxTimeMS(5000),
          // Distinct devices with ANY of the three "issue" conditions — the
          // number the dashboard adds up; $or dedups devices in two buckets.
          DeviceV2.countDocuments({
            ...baseFilter,
            $or: [
              { 'health.last_seen': { $lt: offlineThreshold } },
              { 'health.battery_level': { $lt: query.battery_warning_threshold, $ne: null } },
              { status: 'error' },
            ],
          }).maxTimeMS(5000),
```
The filters must be byte-identical to the corresponding `.find()` filters — copy them, don't re-derive.
3. In the payload: each category's `count:` uses the new count variable (e.g. `count: offlineCount`); keep `devices: offlineDevices` (already ≤10 — drop the now-redundant `.slice(0, 10)` calls); add:
```typescript
            devices_with_issues: {
              count: devicesWithIssuesCount,
            },
```

- [ ] **Step 4: Update the client type and the two consumers**

1. `lib/api/v2-client.ts` — in the health response interface's `alerts` block add:
```typescript
    devices_with_issues: {
      count: number;
    };
```
2. `app/page.tsx:60-65`:
```typescript
  // Distinct devices with an issue (server-side dedup) + overdue maintenance.
  // A device can appear in both terms — the endpoints don't share ids — which
  // is accepted: they are different kinds of attention.
  const activeAlerts =
    (health?.alerts?.devices_with_issues?.count ?? 0) +
    (forecast?.summary?.maintenance_overdue?.length ?? 0);
```
3. `components/dashboard/SystemHealthWidget.tsx:17-20`:
```typescript
  const issuesCount = health?.alerts?.devices_with_issues?.count ?? 0;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/integration/api/analytics.test.ts && npx tsc --noEmit`
Expected: PASS (new and pre-existing analytics tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/v2/analytics/health/route.ts lib/api/v2-client.ts app/page.tsx components/dashboard/SystemHealthWidget.tsx __tests__/integration/api/analytics.test.ts
git commit -m "fix: health analytics counts via countDocuments; distinct devices_with_issues for dashboard"
```

---

### Task 5: List pagination driven by server totals (alerts, alert rules, schedules)

`useAlertsList`, `useAlertRulesList`, and `useSchedulesList` all `return response.data`, discarding `response.pagination`. Their consumers guess "has next page" from `rows.length === PAGE_SIZE`, which breaks on totals that are exact multiples of 10, and none can show a true total. The reference pattern is `useOpenAlertCount` (`lib/query/hooks/useAlerts.ts`), which reads `pagination.total`.

**Files:**
- Modify: `lib/query/hooks/useAlerts.ts` (`useAlertsList`), `lib/query/hooks/useAlertRules.ts` (`useAlertRulesList`), `lib/query/hooks/useSchedules.ts` (`useSchedulesList`)
- Modify: `components/alerts/AlertList.tsx`, `components/alerts/AlertRuleList.tsx`, `components/ScheduleList.tsx`, `components/dashboard/ActiveAlertsWidget.tsx` (+ any other consumer `grep -rln "useAlertsList\|useAlertRulesList\|useSchedulesList" components app` finds)
- Test: `__tests__/unit/components/AlertList.test.tsx`, `__tests__/unit/components/AlertRuleList.test.tsx` (update mocks + add pagination cases); check for existing `useSchedules`/`ScheduleList` tests with `grep -rln "useSchedulesList" __tests__` and update the same way

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: each list hook's `data` becomes
```typescript
export interface PagedResult<T> {
  items: T[];
  total: number;
}
```
(declare `PagedResult` once in `lib/query/types.ts` and export it). `useAlertsList` returns `PagedResult<AlertV2Response>`, etc. **Every** consumer must destructure `data?.items` / `data?.total`.

- [ ] **Step 1: Update hook + component tests to describe the new contract (failing)**

In `__tests__/unit/components/AlertList.test.tsx`: the `useAlertsList` mock currently resolves to an array; change it to `{ items: [...same array...], total }`. Add one behavior test:
```typescript
  it('disables Next exactly when the last page is reached, using the server total', () => {
    // 20 alerts total, page 2 of 2 → Next disabled even though the page is full
    mockUseAlertsList.mockReturnValue({
      data: { items: tenAlerts, total: 20 },
      isLoading: false, error: null, refetch: jest.fn(), isFetching: false,
    });
    mockUseAlertFilterParams.mockReturnValue({ status: 'open', setStatus: jest.fn(), severity: 'all', setSeverity: jest.fn(), page: 2, setPage: jest.fn() });
    render(<AlertList />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });
```
Mirror the same mock-shape change in `AlertRuleList.test.tsx` (and in any ScheduleList/useSchedules tests found by the grep). Follow each file's existing mock helpers — change shapes, not structure.

- [ ] **Step 2: Run to verify failures**

Run: `npx jest __tests__/unit/components/AlertList.test.tsx __tests__/unit/components/AlertRuleList.test.tsx`
Expected: FAIL — components read `data` as an array.

- [ ] **Step 3: Implement**

1. `lib/query/types.ts`:
```typescript
/** List page plus the server's authoritative total for that filter. */
export interface PagedResult<T> {
  items: T[];
  total: number;
}
```
2. Each of the three hooks (same change; alerts shown):
```typescript
export function useAlertsList(
  filters: ListAlertsQueryParams = {},
  config?: QueryConfig<PagedResult<AlertV2Response>>
) {
  const refetchInterval = useRealtimeFallbackInterval();

  return useQuery({
    queryKey: queryKeys.alerts.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.alerts.list(filters);
      return { items: response.data, total: response.pagination.total };
    },
    ...
```
(keep each hook's existing staleTime/gcTime/refetchInterval/config spread untouched; only the generic, queryFn return, and config type change). Preserve every existing doc comment.
3. Consumers:
   - `AlertList.tsx`: `const { data, ... } = useAlertsList(filters);` then `const alerts = data?.items; const total = data?.total ?? 0;`. Replace the Next-button condition with `disabled={page * PAGE_SIZE >= total || isFetching}` and the `Page {page}` span with `Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}`.
   - `AlertRuleList.tsx`: same pattern (`rules = data?.items`).
   - `ScheduleList.tsx`: same pattern (`schedules = data?.items ?? []`); replace `hasMorePages = schedules.length === PAGE_SIZE` with `const total = data?.total ?? 0; const hasMorePages = page * PAGE_SIZE < total;` and render `Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}` in the existing span.
   - `ActiveAlertsWidget.tsx` and any other consumer: `data?.items` where it used `data`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/unit/components/AlertList.test.tsx __tests__/unit/components/AlertRuleList.test.tsx __tests__/unit/lib && npx tsc --noEmit`
Expected: PASS; tsc clean across every consumer (tsc is the net that catches a consumer the grep missed).

- [ ] **Step 5: Commit**

```bash
git add lib/query/types.ts lib/query/hooks/useAlerts.ts lib/query/hooks/useAlertRules.ts lib/query/hooks/useSchedules.ts components/alerts/AlertList.tsx components/alerts/AlertRuleList.tsx components/ScheduleList.tsx components/dashboard/ActiveAlertsWidget.tsx __tests__/unit/components/AlertList.test.tsx __tests__/unit/components/AlertRuleList.test.tsx
git commit -m "fix: alert/rule/schedule lists paginate from server totals, not page length"
```
(Include any additional consumer/test files the greps surfaced.)

---

### Task 6: True totals on detail surfaces (audit log + anomaly badge)

The device audit tab renders "All (20)" forever: `useDeviceDetail` calls `getHistory` with no limit (server default 20) and `AuditLogViewer` prints `entries.length`. The server already returns `pagination.total` (`DeviceHistoryResponse`, `types/v2/device.types.ts:430-439`). Separately, `AnomalyPanel`'s badge renders `anomalies.length` (the page size, 8-10) while discarding `summary.total_anomalies`.

**Files:**
- Modify: `lib/api/v2-client.ts:203-209` (`getHistory` query type)
- Modify: `components/devices/useDeviceDetail.ts` (fetch limit 100, expose `auditTotal: number | null`)
- Modify: `components/devices/DeviceDetailView.tsx` (accept/pass `auditTotal`), callers found via `grep -rln "DeviceDetailView" app components`
- Modify: `components/AuditLogViewer.tsx:72` (optional `total` prop)
- Modify: `components/AnomalyPanel.tsx` (badge shows `summary.total_anomalies`)
- Test: `__tests__/unit/components/AuditLogViewer.test.tsx` (create or extend), `__tests__/unit/components/AnomalyPanel.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `getHistory(id, query)` accepts `limit?: number; page?: number`. `DeviceDetail` (hook return) gains `auditTotal: number | null` (null while unknown). `AuditLogViewerProps` gains `total?: number`.

- [ ] **Step 1: Write failing tests**

`__tests__/unit/components/AuditLogViewer.test.tsx` (extend if it exists; follow existing entry fixtures):
```typescript
  it('labels the All filter with the server total when provided', () => {
    render(<AuditLogViewer deviceId="device_001" entries={twoEntries} loading={false} total={57} />);
    expect(screen.getByText('All (57)')).toBeInTheDocument();
  });
  it('falls back to the loaded count without a total', () => {
    render(<AuditLogViewer deviceId="device_001" entries={twoEntries} loading={false} />);
    expect(screen.getByText('All (2)')).toBeInTheDocument();
  });
```

`__tests__/unit/components/AnomalyPanel.test.tsx`:
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import AnomalyPanel from '@/components/AnomalyPanel';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: { analytics: { anomalies: jest.fn() } },
}));

it('badges the server total, not the page size', async () => {
  (v2Api.analytics.anomalies as jest.Mock).mockResolvedValue({
    success: true,
    data: {
      anomalies: Array.from({ length: 8 }, (_, i) => ({
        device_id: `device_00${i}`, type: 'temperature', value: 99, timestamp: new Date().toISOString(), anomaly_score: 0.9,
      })),
      summary: { total_anomalies: 143 },
    },
  });
  render(<AnomalyPanel maxAlerts={8} />);
  await waitFor(() => expect(screen.getByText('143')).toBeInTheDocument());
});
```
Adapt the anomaly fixture fields to `AnomalyData` (see its declaration in `lib/api/v2-client.ts`) so tsc accepts it.

- [ ] **Step 2: Run to verify failures**

Run: `npx jest __tests__/unit/components/AuditLogViewer.test.tsx __tests__/unit/components/AnomalyPanel.test.tsx`
Expected: FAIL — no `total` prop; badge shows 8.

- [ ] **Step 3: Implement**

1. `lib/api/v2-client.ts` `getHistory`: widen the query type to `{ startDate?: string; endDate?: string; actionType?: string; limit?: number; page?: number }`.
2. `useDeviceDetail.ts`: add `const [auditTotal, setAuditTotal] = useState<number | null>(null);` reset alongside the other resets; call `v2Api.devices.getHistory(deviceId, { limit: 100 })`; after mapping entries, `setAuditTotal(auditResponse.data.pagination?.total ?? null);` and include `auditTotal` in the `DeviceDetail` interface + return object.
3. `DeviceDetailView.tsx`: add `auditTotal?: number | null` to props; pass `total={auditTotal ?? undefined}` to `<AuditLogViewer ...>`. Update both render sites of `DeviceDetailView` (modal + `/devices/[id]` page — the grep in Files) to thread `auditTotal` from the hook.
4. `AuditLogViewer.tsx`: add `total?: number` to props; label becomes `All ({total ?? entries.length})`.
5. `AnomalyPanel.tsx`: add `const [totalAnomalies, setTotalAnomalies] = useState(0);` set from `response.data.summary?.total_anomalies ?? 0` in the fetch; badge renders `{totalAnomalies}` (keep the `anomalies.length > 0` visibility guard).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/unit/components/AuditLogViewer.test.tsx __tests__/unit/components/AnomalyPanel.test.tsx __tests__/unit/components/DeviceDetail 2>/dev/null; npx jest __tests__/unit/components && npx tsc --noEmit`
Expected: PASS (including pre-existing device-detail tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/api/v2-client.ts components/devices/useDeviceDetail.ts components/devices/DeviceDetailView.tsx components/AuditLogViewer.tsx components/AnomalyPanel.tsx __tests__/unit/components/AuditLogViewer.test.tsx __tests__/unit/components/AnomalyPanel.test.tsx
git commit -m "fix: audit log and anomaly badge show server totals instead of page sizes"
```
(Plus the DeviceDetailView caller files.)

---

### Task 7: DeviceGrid loads the full fleet (shared batched readings helper)

`components/DeviceGrid.tsx:110` calls `v2Api.devices.list()` with no params — the server default page size is 20, so the dashboard's device table silently shows 20 of ~500 devices with no pagination UI. Fixing the fetch to the full fleet breaks its follow-up `readings.latest({ device_ids })` call (one comma-joined string of 500 ids exceeds sane URL length), so extract the batch-of-50 pattern FloorPlan already uses into a shared helper and use it in both.

**Files:**
- Create: `lib/api/latest-readings.ts`
- Create test: `__tests__/unit/lib/latest-readings.test.ts`
- Modify: `components/DeviceGrid.tsx:106-135` (device fetch + readings fetch)
- Modify: `components/FloorPlan.tsx` (replace its inline batching loop with the helper)

**Interfaces:**
- Consumes: Task 1's fixed `useDevicesList`; Task 2's FloorPlan shape (this task edits the readings effect Task 2 left in place).
- Produces:
```typescript
// lib/api/latest-readings.ts
export interface LatestReading {
  _id: string;      // device_id
  value: number;
  timestamp: string;
  type: string;
}
export async function fetchLatestReadingsBatched(deviceIds: string[]): Promise<Record<string, LatestReading>>;
```

- [ ] **Step 1: Write the failing helper test**

`__tests__/unit/lib/latest-readings.test.ts`:
```typescript
import { fetchLatestReadingsBatched } from '@/lib/api/latest-readings';

describe('fetchLatestReadingsBatched', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: { readings: [{ device_id: 'device_001', value: 21.5, timestamp: '2026-08-10T00:00:00Z', type: 'temperature' }] },
      }),
    }) as unknown as typeof fetch;
  });

  it('splits requests into batches of 50 ids', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `device_${i}`);
    await fetchLatestReadingsBatched(ids);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    const firstUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(firstUrl.match(/device_ids=/g)).toHaveLength(50);
  });

  it('keys results by device id', async () => {
    const result = await fetchLatestReadingsBatched(['device_001']);
    expect(result['device_001']).toMatchObject({ value: 21.5, type: 'temperature' });
  });

  it('returns an empty map for no ids without fetching', async () => {
    const result = await fetchLatestReadingsBatched([]);
    expect(result).toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/unit/lib/latest-readings.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

`lib/api/latest-readings.ts` — lift FloorPlan's existing loop verbatim into:
```typescript
/** Batch size chosen to keep GET URLs comfortably under proxy limits. */
const BATCH_SIZE = 50;

export interface LatestReading {
  _id: string; // device_id
  value: number;
  timestamp: string;
  type: string;
}

/**
 * Latest reading per device, fetched in batches of 50 ids per request so a
 * full-fleet call does not overflow URL length limits.
 */
export async function fetchLatestReadingsBatched(
  deviceIds: string[]
): Promise<Record<string, LatestReading>> {
  const allReadings: Record<string, LatestReading> = {};

  for (let i = 0; i < deviceIds.length; i += BATCH_SIZE) {
    const batch = deviceIds.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams();
    batch.forEach(id => params.append('device_ids', id));

    const res = await fetch(`/api/v2/readings/latest?${params.toString()}`);
    const data = await res.json();

    if (data.success && data.data?.readings)
      data.data.readings.forEach(
        (r: { device_id: string; value: number; timestamp: string; type: string }) => {
          allReadings[r.device_id] = {
            _id: r.device_id,
            value: r.value,
            timestamp: r.timestamp,
            type: r.type,
          };
        }
      );
  }

  return allReadings;
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `npx jest __tests__/unit/lib/latest-readings.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire DeviceGrid and FloorPlan**

1. `DeviceGrid.tsx`: replace the raw device fetch effect with `useDevicesList()` (imported from `@/lib/query/hooks`), mapping `data` state usage onto the hook result (`const { data: devices = [], isLoading } = useDevicesList();` — keep the local `readings` state). Replace the single `readings.latest({ device_ids: joined })` effect body with `setReadings(await fetchLatestReadingsBatched(devices.map(d => d._id)))` guarded by `devices.length > 0`, preserving the effect's existing error handling shape.
2. `FloorPlan.tsx`: replace the inline batching loop inside its readings effect with the same helper call, and its local `Reading` interface usages with `LatestReading` if identical (it is — same four fields).

- [ ] **Step 6: Full verification**

Run: `npx jest __tests__/unit/lib/latest-readings.test.ts __tests__/unit/utils/floor-plan.test.ts && npx tsc --noEmit && npx eslint components/DeviceGrid.tsx components/FloorPlan.tsx lib/api/latest-readings.ts`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add lib/api/latest-readings.ts __tests__/unit/lib/latest-readings.test.ts components/DeviceGrid.tsx components/FloorPlan.tsx
git commit -m "fix: DeviceGrid loads full fleet; shared batched latest-readings helper"
```
