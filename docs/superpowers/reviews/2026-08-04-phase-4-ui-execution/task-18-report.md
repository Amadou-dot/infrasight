# Task 18 Report: AnomalyPanel rename, dashboard widget, and navigation

Branch: `feat/phase-4-alerting` (worktree `/home/yzel/github/infrasight-phase4`)
Commit: `087cc4c` — `feat(alerting): add dashboard widget and nav badge, rename AlertsPanel to AnomalyPanel`

## Summary

Renamed `components/AlertsPanel.tsx` → `components/AnomalyPanel.tsx` (behaviour-preserving,
still rendered on `/analytics`), built `components/dashboard/ActiveAlertsWidget.tsx` fresh
against `GET /api/v2/alerts`, rendered it on the dashboard, and added an `/alerts` nav entry
with a live open-alert-count badge to `components/TopNav.tsx` (desktop + mobile). Added two
test files beyond the brief's literal file list — see "Deviations from the brief."

All four gates pass with zero tolerance:

- `npx tsc --noEmit` — 0 errors (exit 0)
- `pnpm lint` — 0 problems (exit 0)
- `pnpm test` — 2585/2585 passing, 113/113 suites (baseline entering this task was
  2569/111; delta is exactly the 16 new tests across 2 new suites — no regressions)
- `pnpm build` — clean, exit 0; `/alerts`, `/`, and `/analytics` all compile

## Step 1: reference-set grep (run before touching anything)

```
$ grep -rn "AlertsPanel" --include="*.ts" --include="*.tsx" . | grep -v node_modules
app/analytics/page.tsx:5:import AlertsPanel from '@/components/AlertsPanel';
app/analytics/page.tsx:84:        <AlertsPanel
components/AlertsPanel.tsx:9:interface AlertsPanelProps {
components/AlertsPanel.tsx:14:export default function AlertsPanel({ onDeviceClick, maxAlerts = 10 }: AlertsPanelProps) {
```

4 lines, all inside the 2 files the brief predicted (`app/analytics/page.tsx`'s import +
JSX tag, and `components/AlertsPanel.tsx`'s own interface + function declaration — the
brief's "components/AlertsPanel.tsx itself" collapses to these two concrete lines). No
surprises — the brief's reference set was exactly right, so all four hits were updated
(not a subset).

## What was implemented

### `components/AnomalyPanel.tsx` (renamed via `git mv`)

- `AlertsPanelProps` → `AnomalyPanelProps`, `AlertsPanel` → `AnomalyPanel`.
- Heading text updated so it says "Anomalies" rather than "Alerts": `"Recent Alerts"` →
  `"Recent Anomalies"` (loading + loaded headers), `"Alerts - Error"` → `"Anomalies - Error"`
  (error header). Also updated the error-state fallback string `'Failed to load alerts'` →
  `'Failed to load anomalies'` — not explicitly named a "heading" by the brief, but it's
  user-visible text in the same component and carries the exact naming collision the rename
  exists to remove, so I fixed it too. No test depended on the old string (confirmed by
  grepping `__tests__` for `AlertsPanel|Recent Alerts|Alerts - Error` before changing it —
  zero real hits, one unrelated comment match).
- No behavioural change otherwise. Still fetches `v2Api.analytics.anomalies()`, still polls
  every 30s, still lives at `/analytics`.

### `app/analytics/page.tsx`

Import changed to `import AnomalyPanel from '@/components/AnomalyPanel';`, JSX tag changed
to `<AnomalyPanel onDeviceClick={...} maxAlerts={8} />`. No other changes.

### `components/dashboard/ActiveAlertsWidget.tsx` (new)

Built fresh against `GET /api/v2/alerts` via `useAlertsList({ limit: 5, sortBy: 'severity',
sortDirection: 'desc' })` — not lifted from `AnomalyPanel`, per the brief's explicit
resolution. Verified Task 12's rank-based severity sort is real and not regressed: read
`app/api/v2/alerts/route.ts:49-57` directly — `SEVERITY_RANK` is a `$switch` on
`critical=3/warning=2/info=1` (not a lexical sort), confirmed still in place.

- Shell: `<div className="bg-card border border-border rounded-xl p-6 h-full flex flex-col">`
  — matches the *actual* convention of the other `components/dashboard/*` widgets
  (`SystemHealthWidget`, `CriticalIssuesPanel`, `MaintenanceWidget` all use this exact plain-div
  shell, not the shadcn `Card`/`CardHeader`/`CardContent` primitives that `components/alerts/*`
  uses). See "Uncertain / worth flagging" — the brief said "`Card` shell matching the other
  `components/dashboard/*` widgets," and I resolved the tension in favor of literally matching
  the siblings, since that's what "matching" cashes out to when checked against the actual code.
- Header: `Bell` icon (matching the icon already used on `/alerts`, `/alerts/[id]`,
  `/alerts/rules`) + "Open Alerts" title (not "Active Alerts" — see below) + "View all alerts"
  link to `/alerts`.
- Rows: `AlertSeverityBadge`, `AlertStatusBadge`, rule name as `<Link href={/alerts/${id}}>`,
  device id, and `formatRelativeTime(alert.fired_at ?? alert.breached_since)` — imported from
  `components/alerts/AlertList.tsx` (already exported there; no third time-formatter written),
  with the same `fired_at ?? breached_since` fallback `AlertList.tsx` uses (pending episodes
  never reach the client, so this is defensive, matching the sibling's own comment).
- States are three separate, mutually exclusive conditional blocks (`isLoading` /
  `!isLoading && error` / `isEmpty` / `hasRows`), not a shared fallback — see deletion-check
  evidence below for why this matters.

**Widget title naming**: I deliberately did *not* title the widget "Active Alerts" even
though that's the filename. `app/page.tsx` already has a `StatCard title="Active Alerts"`
showing a legacy count (`offline + error + low_battery devices + maintenance_overdue`,
unrelated to the new `AlertV2` subsystem this task makes discoverable). Two "Active Alerts"
labels on the same page — one a stat card, one a widget header, showing different numbers —
would itself be a naming collision of the same shape this task exists to fix. Titled it
"Open Alerts" instead (matches the domain vocabulary already used server-side: `is_open`,
`OPEN_STATUSES`).

### `components/dashboard/index.ts`

Added `export { default as ActiveAlertsWidget } from './ActiveAlertsWidget';`, matching how
every other dashboard widget is barrel-exported.

### `app/page.tsx`

`ActiveAlertsWidget` imported from the `@/components/dashboard` barrel (consistent with the
other four dashboard widgets) and rendered as the first item in the left (`lg:col-span-2`)
column, above `CriticalIssuesPanel` — the widest column, since its rows (2 badges + name +
device id + timestamp) need more room to avoid awkward wrapping than the narrower right
column would give them.

**Necessary knock-on fix**: `__tests__/unit/components/DashboardStatCards.test.tsx` mocks
`@/components/dashboard` via `jest.requireActual(...)` plus per-widget overrides, with the
comment "Child widgets each fetch their own data; they are not what these tests are about."
That file's `@/lib/query/hooks` mock doesn't include `useAlertsList`, so the *real*
`ActiveAlertsWidget` (now reachable through the real barrel) would crash calling an
undefined hook. Added `ActiveAlertsWidget: () => null,` to that file's existing override
list. **Verified this was actually necessary**, not just theorized: temporarily removed the
one added line and reran the file — all 9 tests failed identically with
`TypeError: (0 , hooks_1.useAlertsList) is not a function`. Restored the line; reran; 9/9
green again.

### `components/TopNav.tsx`

- `Bell` added to the `lucide-react` import; `{ href: '/alerts', label: 'Alerts', icon: Bell }`
  inserted into `navItems`. Placed immediately before `Maintenance` (i.e., after the existing
  admin-only `Deleted Devices` entry) rather than immediately after `Devices` — the brief's
  "between Devices and Maintenance" predates an item (`Deleted Devices`) it doesn't mention,
  so I grouped `Alerts` with the main flow rather than wedging it into the middle of the
  Devices/Deleted-Devices pair.
- `const { data: openAlertCount = 0 } = useOpenAlertCount();` — Task 12's count hook (reads
  `pagination.total` off a one-row page), not `useAlertsList({ limit: 100 }).data?.length`.
- `usePusherAlerts(handleAlertEvent)` where `handleAlertEvent` is
  `useCallback(() => queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all }), [queryClient])`
  — same invalidation `AlertToaster` performs, so the badge updates on the same event that
  raises a toast. Memoized per the brief's explicit instruction; verified the memoization
  actually holds (see TDD/test section).
- Badge rendered inside the `.map(item => ...)` body (both desktop and mobile renderers,
  since `navItems` is a module-level constant), gated on
  `item.href === '/alerts' && openAlertCount > 0`, using the exact class string the brief gave.

## TDD evidence

### `ActiveAlertsWidget.tsx`

**Failing run** (before the component existed):

```
FAIL jsdom __tests__/unit/components/ActiveAlertsWidget.test.tsx
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/components/dashboard/ActiveAlertsWidget mapped as:
    /home/yzel/github/infrasight-phase4/$1.

      22 | import { ActiveAlertsWidget } from '@/components/dashboard/ActiveAlertsWidget';
         | ^

Test Suites: 1 failed, 1 total
Tests:       0 total
```

**Passing run** (after writing the component):

```
PASS jsdom __tests__/unit/components/ActiveAlertsWidget.test.tsx
  ActiveAlertsWidget
    ✓ should show a loading state (22 ms)
    ✓ should request the 5 highest-severity open alerts (6 ms)
    ✓ should show an all-clear state when nothing is open (4 ms)
    ✓ should render alert rows with status, severity, device id, and time since fired (12 ms)
    ✓ should preserve server-provided order (critical first) rather than re-sorting client-side (32 ms)
    ✓ should link each row to its alert page (8 ms)
    ✓ should link "View all alerts" to /alerts (6 ms)
    ✓ should show an error state (4 ms)

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

The test file extends the brief's literal 5-test template with 3 more: a call-args assertion
(the widget actually requests `sortBy: 'severity', sortDirection: 'desc'`, guarding against
silently losing the critical-first sort), an order-preservation test (the widget doesn't
re-sort or reverse what the server sends), and a "View all alerts" link-target test. The
brief's 5 tests are also strengthened with mutual-exclusion assertions — see deletion-check
evidence.

### `TopNav.tsx` (test file not in the brief's literal list — see "Deviations")

No failing-run capture here since `TopNav.tsx` already existed pre-task (only modified, not
created) — TDD red/green doesn't apply to the file's existence the way it does for the new
widget. Instead, I wrote `__tests__/unit/components/TopNav.test.tsx` immediately after
implementing the badge/nav changes and used deletion-check mutations (below) as the falsifiability
evidence for the new behavior specifically, which is what the outer task instructions ask for.

```
PASS jsdom __tests__/unit/components/TopNav.test.tsx
  TopNav
    ✓ renders an Alerts nav item linking to /alerts (61 ms)
    open-alert count badge
      ✓ should NOT show a badge when there are no open alerts (15 ms)
      ✓ should show a badge with the count when there are open alerts (12 ms)
      ✓ should default to 0 (no badge) while the count is still loading (data undefined) (11 ms)
      ✓ should render the badge in the mobile menu too, once opened (30 ms)
    live updates via Pusher
      ✓ registers exactly one alert-event handler via usePusherAlerts (8 ms)
      ✓ invalidates the alerts query cache on an alert-event, same as AlertToaster (7 ms)
      ✓ passes a memoized (referentially stable) callback to usePusherAlerts across re-renders (25 ms)

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

**Confirmed the local `@clerk/nextjs` mock override actually takes effect** (per the task
instructions' explicit warning that the global jsdom setup mock has no `useAuth`): temporarily
commented out the local `jest.mock('@clerk/nextjs', ...)` block and reran:

```
TypeError: (0 , nextjs_1.useAuth) is not a function

      62 |
      63 | export function useRbac(): RbacState {
    > 64 |   const { isLoaded, isSignedIn, orgRole, orgSlug } = useAuth();
         |                                                             ^
      64 |
Test Suites: 1 failed, 1 total
Tests:       8 failed, 8 total
```

This is exactly the failure the task instructions predicted, confirming the global mock (no
`useAuth`) is what's active without the local override, and that the local override is both
necessary and effective. Restored the local mock; reran; 8/8 green again.

## Deletion-check evidence

Per the task instructions: "would this fail if the behavior it names were deleted? Delete the
line and confirm red before claiming green." Every mutation below was applied to the real
production file, run in isolation, confirmed red, then reverted and reconfirmed green (both
the targeted test and the full file).

### `ActiveAlertsWidget` — loading state

Removed `animate-pulse` from the skeleton's className:

```
✕ should show a loading state

    expect(received).not.toBeNull()
    Received: null
    > expect(container.querySelector('.animate-pulse, .animate-spin')).not.toBeNull();
```

Reverted; confirmed green.

### `ActiveAlertsWidget` — error state (collapsed into the empty branch)

This is the literal anti-pattern named in the task instructions ("if both fall through to
the same 'nothing to show' branch, the tests pass while the error state is invisible").
Reproduced it directly: merged the error and empty JSX blocks into one shared branch —
`{!isLoading && (error || isEmpty) && (<div>...No active alerts...</div>)}` — deleting the
distinct `"Failed to load alerts"` output entirely:

```
✕ should show an error state

    > expect(screen.getByText(/failed to load/i)).toBeInTheDocument();

    Unable to find an element with the text: /failed to load/i.
    ...
      <p class="text-sm">No active alerts</p>
```

The rendered output is literally "No active alerts" for a real error — the error state
really is invisible to an operator under this mutation, and the test catches it immediately.
Reverted; confirmed green.

### `ActiveAlertsWidget` — empty state

Changed the empty-state text from `"No active alerts"` to `"All clear"`:

```
✕ should show an all-clear state when nothing is open

    > expect(screen.getByText(/no active alerts/i)).toBeInTheDocument();

    Unable to find an element with the text: /no active alerts/i.
```

Reverted; confirmed green. Full widget file reran clean afterward: 8/8.

### `TopNav` badge — ">0" gate, both directions

**Direction 1: badge shows even at count 0** (removed the `> 0` condition, leaving only
`item.href === '/alerts' &&`):

```
✕ should NOT show a badge when there are no open alerts

    expect(element).not.toBeInTheDocument()
    expected document not to contain element, found
    <span class="... bg-destructive ...">0</span> instead
```

Reverted; confirmed identical to pre-mutation via `diff` (clean).

**Direction 2: badge never shows** (forced the condition to `item.href === '/alerts' && false`):

```
✕ should show a badge with the count when there are open alerts

    expect(received).toBeInTheDocument()
    received value must be an HTMLElement or an SVGElement.
    Received has value: null
```

Reverted; confirmed identical to pre-mutation via `diff` (clean); full TopNav file reran
clean afterward: 8/8.

## Gate output

### `npx tsc --noEmit`

```
(no output — 0 errors, exit 0)
```

### `pnpm lint`

```
$ eslint
(no output — 0 problems, exit 0)
```

One round-trip needed: the first run found 2 errors, both in my new test files —
`import/first` in `ActiveAlertsWidget.test.tsx` (the brief's literal template puts
`jest.mock(...)` before the `import { useAlertsList } from '@/lib/query/hooks'` it
configures, which trips this rule even though Jest hoists `jest.mock` regardless of source
position) and an unnecessary-braces `curly` in `TopNav.test.tsx`'s `for...of` loop. Fixed by
reordering the import above the `jest.mock` call (matching `AlertList.test.tsx`'s existing
convention) and removing the braces; reran both affected test files afterward to confirm the
reorder didn't change runtime behavior (16/16 still green) before rerunning lint clean.

### `pnpm test` (full suite)

```
Test Suites: 113 passed, 113 total
Tests:       2585 passed, 2585 total
Snapshots:   0 total
Time:        41.008 s
Ran all test suites in 2 projects.

MongoDB Memory Server stopped.
```

Baseline entering this task (confirmed by running the full suite before any change): 2569
tests / 111 suites. Delta: +2 suites (`ActiveAlertsWidget.test.tsx`, `TopNav.test.tsx`), +16
tests (8 + 8). No other suite's count changed — no regressions.

### `pnpm build`

```
   ▲ Next.js 16.0.10 (Turbopack)
 ✓ Compiled successfully in 3.9s
   Running next.config.js provided runAfterProductionCompile ...
 ✓ Completed runAfterProductionCompile in 278ms
   Running TypeScript ...
   Collecting page data using 23 workers ...
 ✓ Generating static pages using 23 workers (32/32) in 1094.4ms
   Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /alerts
├ ƒ /alerts/[id]
├ ○ /alerts/rules
├ ○ /analytics
...
└ ○ /unauthorized

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Explicit exit code checked separately: `0`. `/` (dashboard, now rendering `ActiveAlertsWidget`)
and `/analytics` (now rendering `AnomalyPanel`) both compile as `○` static, same classification
as before this task.

## Commit

```
087cc4c feat(alerting): add dashboard widget and nav badge, rename AlertsPanel to AnomalyPanel
```

9 files changed, 519 insertions(+), 11 deletions(-):
`components/AlertsPanel.tsx` → `components/AnomalyPanel.tsx` (rename + edits),
`app/analytics/page.tsx`, `components/dashboard/ActiveAlertsWidget.tsx` (new),
`components/dashboard/index.ts`, `app/page.tsx`, `components/TopNav.tsx`,
`__tests__/unit/components/ActiveAlertsWidget.test.tsx` (new),
`__tests__/unit/components/TopNav.test.tsx` (new),
`__tests__/unit/components/DashboardStatCards.test.tsx` (one-line fix).

Used `feat(alerting):` rather than the brief's suggested `refactor(ui):` — every other
commit in this phase (`git log` on this branch) uses the `(alerting)` scope, and the brief's
own commit-message suggestion predates seeing that established convention, the same way its
"AlertsPanel is dead code" claim predated seeing the actual reference set.

## Deviations from the brief

1. **`__tests__/unit/components/TopNav.test.tsx` added** (not in the brief's literal "Files"
   list, which only names `ActiveAlertsWidget.test.tsx`). Required by the outer task
   instructions' explicit demand for deletion-check evidence "for the badge appearing only
   when the count is above zero" — that behavior lives entirely in `TopNav.tsx`, which the
   brief modifies but doesn't ask for a test file for. Precedent: Task 17 added
   `AlertRuleList.test.tsx` beyond its brief's file list under the same kind of instruction.

2. **`__tests__/unit/components/DashboardStatCards.test.tsx` modified** (one line). Not
   mentioned anywhere in the brief. Necessary side effect of wiring `ActiveAlertsWidget` into
   `app/page.tsx` through the real `@/components/dashboard` barrel that this pre-existing test
   partially mocks with `jest.requireActual`. Verified as a real (not theoretical) breakage
   before fixing it — see the "Necessary knock-on fix" note above.

3. **Widget titled "Open Alerts," not "Active Alerts."** The brief doesn't specify the header
   text. Avoided "Active Alerts" specifically to not collide with the pre-existing
   `StatCard title="Active Alerts"` already on the dashboard, which shows an unrelated legacy
   count — see "Widget title naming" above.

4. **`Card` shell resolved as the plain-div dashboard convention, not the shadcn `Card`
   component.** The brief says "`Card` shell matching the other `components/dashboard/*`
   widgets," but every other widget in that directory uses
   `<div className="bg-card border border-border rounded-xl p-6 h-full flex flex-col">`, not
   `components/ui/card.tsx`'s `Card`/`CardHeader`/`CardContent` (which is what
   `components/alerts/*` uses instead). Followed the actual sibling convention, since that's
   what "matching the other dashboard/* widgets" cashes out to when checked against the code.

5. **Alerts nav item placed after `Deleted Devices`, not immediately after `Devices`.** The
   brief's "insert between Devices and Maintenance" was written without visibility into the
   admin-only `Deleted Devices` entry that already sits there. Grouped `Alerts` with the main
   nav flow (immediately before `Maintenance`) rather than wedging it into the
   Devices/Deleted-Devices pair.

## Uncertain / worth flagging

- The `Card`-shell and nav-position resolutions above (#4, #5) are judgment calls where the
  brief's literal text and the actual repo state pointed in slightly different directions. I
  resolved both in favor of matching what the code already does, consistent with how the task
  instructions handled the `AlertsPanel` "dead code" claim — but a reviewer with different
  design intent for either could reasonably want them changed.
- Did not attempt a live browser/E2E walkthrough (Task 20 is explicitly "End-to-end coverage"
  as its own later task); verification here is unit tests plus the four strict gates only.
- The widget refetches on whatever cadence `useAlertsList`'s `staleTime: 30s` implies (same as
  every other alert-list consumer) plus the Pusher-driven invalidation `TopNav` now performs
  globally on every `alert-event` — I did not add a second, widget-local Pusher subscription,
  since `TopNav`'s existing invalidation of `queryKeys.alerts.all` already covers this
  component's query key (`queryKeys.alerts.list({...})` is nested under `alerts.all` in
  `lib/query/queryClient.ts`, so React Query's key-prefix matching invalidates it too). Did not
  write a dedicated test proving this cross-component invalidation path specifically — it
  follows from `queryKeys.alerts.list` and `queryKeys.alerts.detail` both being array-prefixed
  with `queryKeys.alerts.all`'s own key (`['alerts']`), which is the same mechanism
  `useAcknowledgeAlert`/`useResolveAlert`'s existing invalidation already relies on and is
  covered elsewhere, but flagging that I leaned on that existing coverage rather than
  re-proving it here.

---

## Fix round 1 (review response)

Commit: `558c966` — `fix(alerting): give the nav alert badge an accessible name`

Review verdict: spec met, no Critical, one Important, one Minor to fix, one Minor explicitly
deferred (not fixed, per reviewer instruction — badge JSX duplication between desktop/mobile
mirrors the file's pre-existing convention of duplicating all nav item markup). All three
judgment calls from the original submission (`Card` shell matching the plain-div sibling
convention, `SystemHealthWidget`'s actual shell, and the `DashboardStatCards.test.tsx`
barrel-mock addition) were independently verified and endorsed by the reviewer.

### Important: badge had no accessible name

**Finding**: `components/TopNav.tsx` (desktop badge, then at line 88; mobile badge, then at
line 146) rendered a bare `<span>{openAlertCount}</span>`. A screen reader would read the
Alerts link as "Alerts 5" — a number with no unit, which doesn't survive contact with the
brief's own stated purpose for the badge ("the single clearest signal that this is an
operations tool").

**Fix**: Added `aria-label={`${openAlertCount} open alerts`}` to both badge `<span>`s, exactly
as the reviewer's suggested snippet. Chose the `aria-label` approach over the offered
`sr-only`-sibling alternative because it keeps the badge's accessible name self-contained on
the element itself, and it's a strict one-attribute diff against the already-reviewed markup.

**Test**: Extended two existing assertions in `__tests__/unit/components/TopNav.test.tsx`
rather than adding new `it` blocks — `'should show a badge with the count when there are open
alerts'` (desktop, the reviewer's explicit minimum) and `'should render the badge in the
mobile menu too, once opened'` (mobile, added for symmetry) — each now also asserts
`expect(badge).toHaveAccessibleName('N open alerts')` alongside the pre-existing
`toHaveTextContent` check.

**Deletion-check evidence**: Removed `aria-label` from both spans (`replace_all`, so both
instances at once), reran the badge tests:

```
✕ should show a badge with the count when there are open alerts

    expect(element).toHaveAccessibleName()

    Expected element to have accessible name:
      7 open alerts
    Received:


✕ should render the badge in the mobile menu too, once opened

    expect(element).toHaveAccessibleName()

    Expected element to have accessible name:
      3 open alerts
    Received:

Tests:       2 failed, 4 skipped, 2 passed, 8 total
```

"Received:" is blank in both — the exact defect the reviewer named, caught precisely.
Reverted (restored from a pre-mutation backup, confirmed byte-identical via `diff`); reran the
full file: 8/8 green.

### Minor: factually wrong comment (fixed, since already in the file)

**Finding**: The comment above `handleAlertEvent`'s `useCallback` claimed memoization was
needed because "`usePusherAlerts`'s effect... re-subscribes when the callback identity
changes." That's false: `lib/pusher-context.tsx:168-193`'s effect depends only on `[ctx]`
(not on `callback`), and holds the callback in a `useRef` refreshed by a *separate* effect —
the hook's own doc comment says outright that "a caller that does not memoize will not cause a
re-subscribe."

**Fix**: Rewrote the comment to state the real reason — memoizing is still correct practice
for a stable identity and keeps the `useCallback`'s own dependency array honest — rather than
the disprovable claim. No behavior change; `useCallback` itself is untouched.

### Minor: badge JSX duplication — explicitly deferred, not fixed

Per the reviewer's instruction, left as-is: extracting only the badge into a shared helper
while every other piece of nav-item markup stays duplicated between the desktop and mobile
renderers would make the file *less* internally consistent, not more.

### Gate re-run (post-fix)

```
$ npx tsc --noEmit
(no output — 0 errors, exit 0)

$ pnpm lint
$ eslint
(no output — 0 problems, exit 0)

$ pnpm test
Test Suites: 113 passed, 113 total
Tests:       2585 passed, 2585 total
Snapshots:   0 total
Time:        40.699 s
Ran all test suites in 2 projects.

$ pnpm build
(exit 0; route table unchanged from the original submission)
```

Test count is unchanged at 2585/113 (two assertions were added inside existing `it` blocks
rather than as new tests, so the suite/test counts don't move) — no regressions from the
fix round.

### Commit

```
558c966 fix(alerting): give the nav alert badge an accessible name
```

2 files changed: `components/TopNav.tsx`, `__tests__/unit/components/TopNav.test.tsx`.
