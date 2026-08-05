### Task 15: Alert badges and list

**Files:**
- Create: `components/alerts/AlertSeverityBadge.tsx`
- Create: `components/alerts/AlertStatusBadge.tsx`
- Create: `components/alerts/useAlertFilterParams.ts`
- Create: `components/alerts/AlertList.tsx`
- Create: `app/alerts/page.tsx`
- Test: `__tests__/unit/components/AlertBadges.test.tsx`
- Test: `__tests__/unit/components/useAlertFilterParams.test.tsx`

Badges mirror `components/ScheduleStatusBadge.tsx` exactly: a `Record<T, { label, className, icon }>` config object, `Badge variant="outline"`, `cn()` for class merging, and light/dark class pairs. `AlertList` is modelled on `components/ScheduleList.tsx` — same `Card` shell, same `Select` filters, same `PAGE_SIZE = 10` pagination, same `useRbac()` gating.

**Interfaces:**
- Consumes: `useAlertsList`, `useAcknowledgeAlert`, `useResolveAlert` (Task 12); `AlertV2Response`, `AlertStatus`, `AlertSeverity` (Task 3); `useRbac` from `@/lib/auth/rbac-client`.
- Produces:
  - `export function AlertSeverityBadge({ severity, className?, showIcon? })`
  - `export function AlertStatusBadge({ status, className?, showIcon? })`
  - `export function AlertList({ initialFilters?, showHeader?, onDeviceClick? })`
  - Default-exported `AlertsPage` at `/alerts`

- [ ] **Step 1: Write the failing badge test**

Create `__tests__/unit/components/AlertBadges.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { AlertSeverityBadge } from '@/components/alerts/AlertSeverityBadge';
import { AlertStatusBadge } from '@/components/alerts/AlertStatusBadge';

describe('AlertSeverityBadge', () => {
  it.each(['info', 'warning', 'critical'] as const)('should render %s', severity => {
    render(<AlertSeverityBadge severity={severity} />);
    expect(screen.getByText(new RegExp(severity, 'i'))).toBeInTheDocument();
  });

  it('should hide the icon when showIcon is false', () => {
    const { container } = render(<AlertSeverityBadge severity="critical" showIcon={false} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('AlertStatusBadge', () => {
  it.each([
    ['firing', /firing/i],
    ['acknowledged', /acknowledged/i],
    ['resolved', /resolved/i],
    ['pending', /pending/i],
  ] as const)('should render %s', (status, pattern) => {
    render(<AlertStatusBadge status={status} />);
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/components/AlertBadges.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the badges**

Create `components/alerts/AlertSeverityBadge.tsx`, following `components/ScheduleStatusBadge.tsx` line for line:

```typescript
'use client';

import { Badge } from '@/components/ui/badge';
import { Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import type { AlertSeverity } from '@/types/v2';
import { cn } from '@/lib/utils';

interface AlertSeverityBadgeProps {
  severity: AlertSeverity;
  className?: string;
  showIcon?: boolean;
}

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { label: string; className: string; icon: typeof Info }
> = {
  info: {
    label: 'Info',
    className:
      'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    icon: Info,
  },
  warning: {
    label: 'Warning',
    className:
      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    className:
      'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    icon: AlertOctagon,
  },
};

export function AlertSeverityBadge({
  severity,
  className,
  showIcon = true,
}: AlertSeverityBadgeProps) {
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

export default AlertSeverityBadge;
```

Create `components/alerts/AlertStatusBadge.tsx` with the same structure over `AlertStatus`: `pending` → `Clock`, neutral gray; `firing` → `Zap`, red; `acknowledged` → `Eye`, amber; `resolved` → `CheckCircle`, green.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/components/AlertBadges.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the list component**

Create `components/alerts/AlertList.tsx`, copying the structure of `components/ScheduleList.tsx`:

- `'use client'`; props `{ initialFilters?: Partial<ListAlertsQueryParams>; showHeader?: boolean; onDeviceClick?: (deviceId: string) => void }`
- `const { isAdmin } = useRbac();`
- `STATUS_OPTIONS = [{ value: 'open', label: 'Open' }, { value: 'firing', … }, { value: 'acknowledged', … }, { value: 'resolved', label: 'Resolved (history)' }]` and `SEVERITY_OPTIONS` with an `all` entry, rendered through `Select`
- `PAGE_SIZE = 10`; page state; `useAlertsList({ ...filters, page, limit: PAGE_SIZE })`
- Each row: `AlertSeverityBadge`, `AlertStatusBadge`, rule name, a `Link` to `/alerts/${alert._id}`, the device id as a button calling `onDeviceClick`, the condition in plain language, and a relative timestamp
- Acknowledge / Resolve buttons render for every viewer but are `disabled={!isAdmin}` with a `title` tooltip explaining why — **disabled, not hidden**, per the demo-mode rule, so a visitor learns the workflow exists. Server-side `requireAdmin()` is the real enforcement
- On mutation success, `toast.success(...)`; on error, `toast.error(err.message)`
- Loading state reuses the spinner markup from `ScheduleList`; empty state reads "No open alerts."

Concretely:

```typescript
'use client';

import Link from 'next/link';
import { toast } from 'react-toastify';
import { CheckCircle, Eye, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import { AlertStatusBadge } from './AlertStatusBadge';
import { useAlertFilterParams } from './useAlertFilterParams';
import { useAlertsList, useAcknowledgeAlert, useResolveAlert } from '@/lib/query/hooks';
import { useRbac } from '@/lib/auth/rbac-client';
import type {
  AlertComparison,
  AlertSeverity,
  AlertStatus,
  AlertV2Response,
  ListAlertsQueryParams,
} from '@/types/v2';

interface AlertListProps {
  initialFilters?: Partial<ListAlertsQueryParams>;
  showHeader?: boolean;
  onDeviceClick?: (deviceId: string) => void;
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'firing', label: 'Firing' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved (history)' },
];

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const PAGE_SIZE = 10;

const COMPARISON_WORDS: Record<AlertComparison, string> = {
  gt: 'above',
  gte: 'at or above',
  lt: 'below',
  lte: 'at or below',
};

/** "temperature above 30" / "battery_level below 20" — shared with AlertDetailView. */
export function describeCondition(
  alert: Pick<AlertV2Response, 'metric' | 'comparison' | 'threshold'>
): string {
  return `${alert.metric} ${COMPARISON_WORDS[alert.comparison]} ${alert.threshold}`;
}

const ADMIN_ONLY_TOOLTIP = 'Admin role required — sign in as an admin to act on alerts';

export function AlertList({ initialFilters = {}, showHeader = true, onDeviceClick }: AlertListProps) {
  const { isAdmin } = useRbac();
  // URL is the source of truth — see useAlertFilterParams below.
  const { status, setStatus, severity, setSeverity, page, setPage } =
    useAlertFilterParams(initialFilters);

  const filters: ListAlertsQueryParams = {
    ...initialFilters,
    // 'open' is the server default (firing + acknowledged), so it is sent as absent.
    ...(status !== 'open' ? { status: status as AlertStatus } : {}),
    ...(severity !== 'all' ? { severity: severity as AlertSeverity } : {}),
    page,
    limit: PAGE_SIZE,
  };

  const { data: alerts, isLoading, error, refetch } = useAlertsList(filters);
  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();

  const act = (
    mutation: typeof acknowledge,
    id: string,
    successMessage: string
  ) =>
    mutation.mutate(
      { id },
      {
        onSuccess: () => toast.success(successMessage),
        onError: (err: Error) => toast.error(err.message),
      }
    );

  return (
    <Card>
      {showHeader && (
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Alerts</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              label="Status"
              value={status}
              onValueChange={setStatus}
              options={STATUS_OPTIONS}
              size="sm"
            />
            <Select
              label="Severity"
              value={severity}
              onValueChange={setSeverity}
              options={SEVERITY_OPTIONS}
              size="sm"
            />
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
      )}

      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {error && !isLoading && (
          <p className="py-8 text-center text-sm text-destructive">Failed to load alerts</p>
        )}

        {!isLoading && !error && alerts?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No open alerts.</p>
        )}

        <ul className="divide-y divide-border">
          {alerts?.map(alert => (
            <li key={alert._id} className="flex flex-wrap items-center gap-3 py-3">
              <AlertSeverityBadge severity={alert.severity} />
              <AlertStatusBadge status={alert.status} />

              <Link href={`/alerts/${alert._id}`} className="font-medium hover:underline">
                {alert.rule_name}
              </Link>

              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => onDeviceClick?.(alert.device_id)}
              >
                {alert.device_id}
              </button>

              <span className="text-sm text-muted-foreground">
                {describeCondition(alert)} — last {alert.last_value}
              </span>

              <div className="ml-auto flex items-center gap-2">
                {/* Disabled, never hidden: a visitor should learn the workflow exists.
                    requireAdmin() server-side is the real enforcement. */}
                {alert.status === 'firing' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isAdmin || acknowledge.isPending}
                    title={isAdmin ? undefined : ADMIN_ONLY_TOOLTIP}
                    onClick={() => act(acknowledge, alert._id, 'Alert acknowledged')}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Acknowledge
                  </Button>
                )}
                {alert.is_open && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isAdmin || resolve.isPending}
                    title={isAdmin ? undefined : ADMIN_ONLY_TOOLTIP}
                    onClick={() => act(resolve, alert._id, 'Alert resolved')}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Resolve
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={(alerts?.length ?? 0) < PAGE_SIZE}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default AlertList;
```

`Select`'s prop contract has been verified against `components/ui/select.tsx` and is used above exactly as `components/ScheduleList.tsx:183-200` uses it: `{ value, onValueChange: (value: string) => void, options: SelectOption[], label?, size?: 'sm' | 'md' }`. It is **not** a native `<select>` — there is no `onChange`, no `event.target.value`, and no `aria-label` prop. Use `label` for the accessible name.

**Write `components/alerts/useAlertFilterParams.ts` first.** Modelled on `app/devices/_components/useDeviceFilterParams.ts`, which is the repo's precedent and whose central rule applies here too: **the URL is the single source of truth**, and nothing writes derived state back into it, so there is no round-trip loop. This is what makes `/alerts?status=resolved` a shareable link and browser Back step through filter changes.

```typescript
export interface AlertFilterParams {
  status: string;   // 'open' (default) | 'firing' | 'acknowledged' | 'resolved'
  severity: string; // 'all' (default) | 'critical' | 'warning' | 'info'
  page: number;     // 1-based
  setStatus: (value: string) => void;
  setSeverity: (value: string) => void;
  setPage: (page: number) => void;
}

export function useAlertFilterParams(
  initialFilters?: Partial<ListAlertsQueryParams>
): AlertFilterParams;
```

Three rules the tests must pin:

1. **`setStatus` and `setSeverity` reset `page` to 1 in the same URL write.** Two sequential writes would race and leave a junk history entry — and land the user on page 4 of a two-page result.
2. **Default values are omitted from the query string**, so `/alerts` stays clean: no `status=open`, no `severity=all`, no `page=1`. This mirrors `buildQueryString` in the devices hook.
3. **Unparseable values fall back to the default** rather than reaching the API — `?page=banana` is page 1, `?severity=purple` is `all`.

`initialFilters` seeds only what the URL does not already specify; an explicit URL parameter always wins, or a shared link would not survive the first render.

- [ ] **Step 6: Write the alerts page**

Create `app/alerts/page.tsx`:

```typescript
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertList } from '@/components/alerts/AlertList';

/**
 * Active alerts. History is a filter value on the same page rather than a
 * separate route (`/alerts?status=resolved`), following the Phase 3 URL-sync
 * precedent in app/devices/_components/useDeviceFilterParams.ts.
 */
export default function AlertsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Alerts</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/alerts/rules">
            <SlidersHorizontal className="h-4 w-4 mr-2" />
            Manage rules
          </Link>
        </Button>
      </header>

      <AlertList onDeviceClick={deviceId => router.push(`/devices/${deviceId}`)} />
    </div>
  );
}
```

URL syncing is already handled by `useAlertFilterParams` from Step 5 — there is nothing extra to do here. `app/alerts/page.tsx` stays a thin shell.

Because `AlertList` calls `useSearchParams()`, Next.js requires it to sit under a Suspense boundary or the build fails with a prerender error on `/alerts`. Wrap it: `<Suspense fallback={…}><AlertList … /></Suspense>`. Check how `app/devices/page.tsx` handles the same constraint and follow it.

- [ ] **Step 7: Verify build and tests**

Run: `npx tsc --noEmit && pnpm test __tests__/unit/components && pnpm build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add components/alerts app/alerts/page.tsx __tests__/unit/components/AlertBadges.test.tsx __tests__/unit/components/useAlertFilterParams.test.tsx
git commit -m "feat(alerting): add alert badges, list, and /alerts page"
```

---

