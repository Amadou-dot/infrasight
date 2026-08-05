### Task 18: AnomalyPanel rename, dashboard widget, and navigation

**`components/AlertsPanel.tsx` is NOT orphaned.** Issue #99 and the parent design both describe it as such; that is stale. It is imported at `app/analytics/page.tsx:5` and rendered at `:84`, and commit `9c80aa9` *"refactor(ui): give AlertsPanel a home, drop CriticalDevicesList"* already discharged parent §3.3. **Deleting it breaks the build.** The diagnosis survives the correction — a component named `AlertsPanel` rendering anomaly data is exactly the confusion this phase exists to remove — but the resolution is a rename, not a deletion.

**Files:**
- Rename: `components/AlertsPanel.tsx` → `components/AnomalyPanel.tsx`
- Modify: `app/analytics/page.tsx` (one import, one JSX tag)
- Create: `components/dashboard/ActiveAlertsWidget.tsx`
- Modify: `app/page.tsx` (render the widget)
- Modify: `components/TopNav.tsx` (nav item + count badge)
- Test: `__tests__/unit/components/ActiveAlertsWidget.test.tsx`

- [ ] **Step 1: Confirm the reference set before renaming**

Run: `grep -rn "AlertsPanel" --include="*.ts" --include="*.tsx" . | grep -v node_modules`
Expected: exactly three hits — `app/analytics/page.tsx:5`, `app/analytics/page.tsx:84`, and `components/AlertsPanel.tsx` itself. If the count differs, update every hit found rather than the three listed here.

- [ ] **Step 2: Rename the component**

```bash
git mv components/AlertsPanel.tsx components/AnomalyPanel.tsx
```

Inside `components/AnomalyPanel.tsx`, rename `AlertsPanelProps` → `AnomalyPanelProps` and `AlertsPanel` → `AnomalyPanel`, and update the visible heading text so it says "Anomalies" rather than "Alerts". No behaviour change — it stays on `/analytics`, which is where anomaly data belongs under this design's separation of the two surfaces.

In `app/analytics/page.tsx`, change the import to `import AnomalyPanel from '@/components/AnomalyPanel';` and the JSX tag to `<AnomalyPanel … />`.

- [ ] **Step 3: Verify the rename**

Run: `npx tsc --noEmit && grep -rn "AlertsPanel" --include="*.tsx" . | grep -v node_modules`
Expected: no type errors, no remaining `AlertsPanel` references.

- [ ] **Step 4: Write the failing widget test**

Create `__tests__/unit/components/ActiveAlertsWidget.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { ActiveAlertsWidget } from '@/components/dashboard/ActiveAlertsWidget';

jest.mock('@/lib/query/hooks', () => ({
  useAlertsList: jest.fn(),
}));

import { useAlertsList } from '@/lib/query/hooks';

const mockUseAlertsList = useAlertsList as jest.Mock;

describe('ActiveAlertsWidget', () => {
  it('should show a loading state', () => {
    mockUseAlertsList.mockReturnValue({ data: undefined, isLoading: true, error: null });

    const { container } = render(<ActiveAlertsWidget />);

    expect(container.querySelector('.animate-pulse, .animate-spin')).not.toBeNull();
  });

  it('should show an all-clear state when nothing is open', () => {
    mockUseAlertsList.mockReturnValue({ data: [], isLoading: false, error: null });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText(/no active alerts/i)).toBeInTheDocument();
  });

  it('should render alert rows with status and severity', () => {
    mockUseAlertsList.mockReturnValue({
      data: [
        {
          _id: 'a1',
          rule_name: 'High temp',
          device_id: 'device_001',
          status: 'firing',
          severity: 'critical',
          metric: 'value',
          comparison: 'gt',
          threshold: 30,
          trigger_value: 42,
          fired_at: '2026-08-01T12:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText('High temp')).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
    expect(screen.getByText(/firing/i)).toBeInTheDocument();
  });

  it('should link each row to its alert page', () => {
    mockUseAlertsList.mockReturnValue({
      data: [
        {
          _id: 'a1',
          rule_name: 'High temp',
          device_id: 'device_001',
          status: 'firing',
          severity: 'critical',
          metric: 'value',
          comparison: 'gt',
          threshold: 30,
          trigger_value: 42,
          fired_at: '2026-08-01T12:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<ActiveAlertsWidget />);

    expect(screen.getByRole('link', { name: /high temp/i })).toHaveAttribute('href', '/alerts/a1');
  });

  it('should show an error state', () => {
    mockUseAlertsList.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Write the widget**

Create `components/dashboard/ActiveAlertsWidget.tsx` **fresh against `GET /api/v2/alerts`**, rather than lifting the layout out of `AnomalyPanel`. It is a different data shape — status, acknowledgement, duration — and copying a panel built for anomaly rows would import assumptions that no longer hold.

- `'use client'`; `useAlertsList({ limit: 5, sortBy: 'severity', sortDirection: 'desc' })` — this returns **critical first** only because Task 12 Step 0 replaced the lexical severity sort with a rank-based one. If you find criticals sorting last, that fix is missing; do not paper over it in this component.
- `Card` shell matching the other `components/dashboard/*` widgets
- Rows: `AlertSeverityBadge`, `AlertStatusBadge`, rule name as a `<Link href={`/alerts/${alert._id}`}>`, device id, and time since `fired_at`
- Loading: skeleton with `animate-pulse`. Empty: "No active alerts". Error: "Failed to load alerts"
- Footer link "View all alerts" → `/alerts`

Render `<ActiveAlertsWidget />` in `app/page.tsx` alongside the existing dashboard widgets.

- [ ] **Step 6: Add navigation**

In `components/TopNav.tsx`, add `Bell` to the `lucide-react` import and insert into `navItems` **between Devices and Maintenance**:

```typescript
  { href: '/alerts', label: 'Alerts', icon: Bell },
```

Add an open-alert count badge. Because `navItems` is a module-level constant, the badge is rendered in the map rather than baked into the item:

```typescript
  const { data: openAlertCount = 0 } = useOpenAlertCount();
```

Use `useOpenAlertCount()` (Task 12), **not** `useAlertsList({ limit: 100 }).data?.length`. The API caps `limit` at 100, so a real storm would freeze the badge at "100" — and because `TopNav` renders on every route, the list variant would fetch 100 full alert documents on every navigation just to display one integer. The count hook asks for one row and reads `pagination.total`.

and inside the desktop and mobile item renderers:

```tsx
  {item.href === '/alerts' && openAlertCount > 0 && (
    <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground">
      {openAlertCount}
    </span>
  )}
```

The badge is the single clearest signal that this is an operations tool rather than a set of charts. Keep it live by adding `usePusherAlerts(() => queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all }))` in `TopNav` — the same invalidation `AlertToaster` performs, so the count updates on the same event that raises the toast.

- [ ] **Step 7: Verify**

Run: `pnpm test __tests__/unit/components && npx tsc --noEmit && pnpm build`
Expected: clean. `/alerts` must be reachable from the nav in both the desktop and mobile menus.

- [ ] **Step 8: Commit**

```bash
git add components/AnomalyPanel.tsx app/analytics/page.tsx components/dashboard/ActiveAlertsWidget.tsx app/page.tsx components/TopNav.tsx __tests__/unit/components/ActiveAlertsWidget.test.tsx
git commit -m "refactor(ui): rename AlertsPanel to AnomalyPanel and add alerts nav and widget"
```

---

