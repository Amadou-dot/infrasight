### Task 16: Alert detail page

**Files:**
- Create: `components/alerts/AlertDetailView.tsx`
- Create: `app/alerts/[id]/page.tsx`
- Test: `__tests__/unit/components/AlertDetailView.test.tsx`

**No new endpoint is added for the bracketing readings.** The page issues a second call to the existing `GET /api/v2/readings?device_id=<id>&startDate=<fired_at − 15m>&endDate=<fired_at + 15m>`, which already satisfies that endpoint's required-time-range constraint. `getAlertQuerySchema` therefore stays at `include_device` only.

`AlertDetailView` is modelled on `components/devices/DeviceDetailView.tsx`: a presentational component shared between the page and any future drawer, taking already-loaded data as props. `app/alerts/[id]/page.tsx` follows `app/devices/[id]/page.tsx`: a canonical URL that survives a refresh and can be pasted into a chat mid-incident, calling `notFound()` for ids that do not resolve.

**Interfaces:**
- Consumes: `useAlertDetail` (Task 12); `v2Api.readings.list`; `useAcknowledgeAlert`, `useResolveAlert`; `describeCondition` from `components/alerts/AlertList` (Task 15); badges (Task 15).
- Produces:
  - `export function AlertDetailView({ alert, bracketingReadings, loading })`
  - Default-exported `AlertDetailPage` at `/alerts/[id]`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/components/AlertDetailView.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { AlertDetailView } from '@/components/alerts/AlertDetailView';
import type { AlertV2Response } from '@/types/v2';

function alert(overrides: Partial<AlertV2Response> = {}): AlertV2Response {
  return {
    _id: '507f1f77bcf86cd799439011',
    rule_id: '507f1f77bcf86cd799439012',
    rule_name: 'High temperature',
    device_id: 'device_001',
    status: 'firing',
    is_open: true,
    severity: 'critical',
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    trigger_value: 42,
    last_value: 41,
    breached_since: '2026-08-01T12:00:00.000Z',
    last_observed_at: '2026-08-01T12:10:00.000Z',
    fired_at: '2026-08-01T12:05:00.000Z',
    audit: {
      created_at: '2026-08-01T12:00:00.000Z',
      created_by: 'system',
      updated_at: '2026-08-01T12:10:00.000Z',
      updated_by: 'system',
    },
    ...overrides,
  };
}

jest.mock('@/lib/auth/rbac-client', () => ({
  useAdminAction: () => ({ visible: true, disabled: false }),
  useRbac: () => ({ isAdmin: true, isMember: false, orgRole: 'org:admin', isLoaded: true }),
}));

describe('AlertDetailView', () => {
  it('should state the condition in plain language', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByText(/above 30/i)).toBeInTheDocument();
  });

  it('should mention the duration when the rule has one', () => {
    render(
      <AlertDetailView
        alert={alert()}
        bracketingReadings={[]}
        loading={false}
        forDurationSeconds={300}
      />
    );

    expect(screen.getByText(/for 5 minutes/i)).toBeInTheDocument();
  });

  it('should render the lifecycle timeline', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByText(/breached since/i)).toBeInTheDocument();
    expect(screen.getByText(/fired/i)).toBeInTheDocument();
  });

  it('should show acknowledged and resolved steps once they exist', () => {
    render(
      <AlertDetailView
        alert={alert({
          status: 'resolved',
          is_open: false,
          audit: {
            created_at: '2026-08-01T12:00:00.000Z',
            created_by: 'system',
            updated_at: '2026-08-01T12:40:00.000Z',
            updated_by: 'user_1',
            acknowledged_at: '2026-08-01T12:20:00.000Z',
            acknowledged_by: 'user_1',
            resolved_at: '2026-08-01T12:40:00.000Z',
            resolved_by: 'user_1',
            resolution: 'manual',
          },
        })}
        bracketingReadings={[]}
        loading={false}
      />
    );

    expect(screen.getByText(/acknowledged/i)).toBeInTheDocument();
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
  });

  it('should link to the device', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByRole('link', { name: /device_001/i })).toHaveAttribute(
      'href',
      '/devices/device_001'
    );
  });

  it('should render the bracketing readings', () => {
    render(
      <AlertDetailView
        alert={alert()}
        bracketingReadings={[
          { timestamp: '2026-08-01T12:04:00.000Z', value: 29 },
          { timestamp: '2026-08-01T12:05:00.000Z', value: 42 },
        ]}
        loading={false}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/components/AlertDetailView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the detail view**

Create `components/alerts/AlertDetailView.tsx`:

- `'use client'`; props `{ alert: AlertV2Response; bracketingReadings: Array<{ timestamp: string; value: number }>; loading: boolean; forDurationSeconds?: number }`
- Header: rule name, `AlertSeverityBadge`, `AlertStatusBadge`
- **Condition in plain language**: `describeCondition(alert)` plus, when `forDurationSeconds` is supplied and non-zero, ` for ${humanizeDuration(forDurationSeconds)}` — producing e.g. "temperature above 30 for 5 minutes"
- **Timeline** across `breached_since → fired_at → audit.acknowledged_at → audit.resolved_at`, each step rendered only when the timestamp exists, with the actor beside acknowledged/resolved and `audit.resolution` beside resolved (so `stale` and `device_inactive` read distinctly from `auto`, and history never claims a problem was fixed when the sensor merely went quiet)
- Values block: `trigger_value`, `last_value`, `resolved_value`, `threshold`
- `<Link href={`/devices/${alert.device_id}`}>` for the device
- Bracketing readings as a simple table, `fired_at ± 15m`
- Acknowledge / Resolve buttons via `useAdminAction()` — see Task 15; do not hand-roll with `useRbac`

Add a small local helper:

```typescript
function humanizeDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
```

- [ ] **Step 4: Write the detail page**

Create `app/alerts/[id]/page.tsx`, following `app/devices/[id]/page.tsx`:

```typescript
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDetailView } from '@/components/alerts/AlertDetailView';
import { useAlertDetail } from '@/lib/query/hooks';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '@/lib/query/queryClient';

const BRACKET_MINUTES = 15;

/**
 * Canonical, deep-linkable alert page: it survives a refresh and can be pasted
 * into a chat mid-incident.
 */
export default function AlertDetailPage() {
  const params = useParams<{ id: string }>();
  const alertId = params?.id ? decodeURIComponent(params.id) : '';

  const { data: alert, isLoading, error } = useAlertDetail(alertId, { include_device: true });

  const range = useMemo(() => {
    const anchor = alert?.fired_at ?? alert?.breached_since;
    if (!anchor) return null;
    const at = new Date(anchor).getTime();
    return {
      startDate: new Date(at - BRACKET_MINUTES * 60_000).toISOString(),
      endDate: new Date(at + BRACKET_MINUTES * 60_000).toISOString(),
    };
  }, [alert?.fired_at, alert?.breached_since]);

  // No new endpoint: the existing readings endpoint already requires a time
  // range, and fired_at +/- 15 minutes satisfies it.
  const { data: bracketingReadings = [] } = useQuery({
    queryKey: queryKeys.readings.list({ device_id: alert?.device_id, ...range }),
    queryFn: async () => {
      const response = await v2Api.readings.list({
        device_id: alert!.device_id,
        startDate: range!.startDate,
        endDate: range!.endDate,
      });
      return response.data;
    },
    enabled: !!alert?.device_id && !!range,
  });

  // Renders the styled app-wide 404 for ids that do not resolve.
  if (!isLoading && !alert && error) notFound();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6 space-y-4">
        <Link
          href="/alerts"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to alerts
        </Link>
        <div className="flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground break-all">
            {alert?.rule_name ?? 'Alert'}
          </h1>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      )}

      {alert && !isLoading && (
        <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <AlertDetailView
            alert={alert}
            bracketingReadings={bracketingReadings as Array<{ timestamp: string; value: number }>}
            loading={false}
          />
        </div>
      )}
    </div>
  );
}
```

Two things to confirm against the existing code rather than assume:

- **Parameter names.** Read `lib/validations/v2/reading.validation.ts` (`listReadingsQuerySchema`) and `readingsApi.list` in `lib/api/v2-client.ts` before writing the query, and use whatever the device-filter and time-range parameters are actually called there. The design's only commitment is that no new endpoint is added — the existing readings endpoint already requires a time range, which `fired_at ± 15m` satisfies.
- **Retry behaviour.** `useAlertDetail` must not retry a 404 into a spinner loop — pass `config={{ retry: false }}` from this page, or set `retry: false` in the hook's defaults.

- [ ] **Step 5: Run tests and build**

Run: `pnpm test __tests__/unit/components/AlertDetailView.test.tsx && npx tsc --noEmit`
Expected: PASS, 6 tests; no type errors.

- [ ] **Step 6: Commit**

```bash
git add components/alerts/AlertDetailView.tsx app/alerts/[id]/page.tsx __tests__/unit/components/AlertDetailView.test.tsx
git commit -m "feat(alerting): add deep-linkable alert detail page"
```

---

