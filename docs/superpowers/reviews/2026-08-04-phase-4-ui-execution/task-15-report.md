# Task 15 Report: Alert badges, list, and /alerts page

Branch: `feat/phase-4-alerting` (worktree `/home/yzel/github/infrasight-phase4`)
Commit: `3d0513e` — `feat(alerting): add alert badges, list, and /alerts page`

## Summary

All 8 steps from `task-15-brief.md` implemented, plus one deliberate addition
(`AlertList.test.tsx`, not in the brief's literal file list — see "Deviations
from the brief" below) required by the orchestrator's explicit instruction to
cover the disabled-not-hidden requirement with a real, deletion-checked test.

All four gates pass with zero tolerance:

- `npx tsc --noEmit` — 0 errors
- `pnpm lint` — 0 problems
- `pnpm test` — 2519/2519 passing, 107/107 suites (baseline was 2480/104; delta
  is exactly the 39 new tests across 3 new suites — no regressions)
- `pnpm build` — clean; `/alerts` prerenders as static (`○`)

## Step-by-step

### Steps 1–4: Badges

Wrote `__tests__/unit/components/AlertBadges.test.tsx` verbatim from the brief.
Confirmed it failed (module not found) before creating
`components/alerts/AlertSeverityBadge.tsx` (verbatim from the brief) and
`components/alerts/AlertStatusBadge.tsx` (written to the brief's spec: same
`Record<AlertStatus, {label, className, icon}>` shape as
`ScheduleStatusBadge.tsx`, mapping `pending`→`Clock`/gray, `firing`→`Zap`/red,
`acknowledged`→`Eye`/amber, `resolved`→`CheckCircle`/green). Confirmed pass.

**Failing run** (before the components existed):
```
FAIL jsdom __tests__/unit/components/AlertBadges.test.tsx
  ● Test suite failed to run
    Configuration error:
    Could not locate module @/components/alerts/AlertSeverityBadge mapped as:
    /home/yzel/github/infrasight-phase4/$1.
Test Suites: 1 failed, 1 total
Tests:       0 total
```

**Passing run** (after):
```
PASS jsdom __tests__/unit/components/AlertBadges.test.tsx
  AlertSeverityBadge
    ✓ should render info (25 ms)
    ✓ should render warning (4 ms)
    ✓ should render critical (5 ms)
    ✓ should hide the icon when showIcon is false (2 ms)
  AlertStatusBadge
    ✓ should render firing (3 ms)
    ✓ should render acknowledged (2 ms)
    ✓ should render resolved (2 ms)
    ✓ should render pending (2 ms)
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

### Step 5, reordered per the orchestrator's ambiguity resolution

The task instructions explicitly override the brief's step order here: "Write
`useAlertFilterParams` first, with its own test, before `AlertList`." Followed
that:

1. Wrote `__tests__/unit/components/useAlertFilterParams.test.tsx` (18 tests,
   see "TDD evidence" below) before the hook existed. Confirmed it failed
   (module not found).
2. Wrote `components/alerts/useAlertFilterParams.ts`. Confirmed all 18 tests
   pass.
3. Did the three deletion checks named in the task instructions (see below).
4. Wrote `components/alerts/AlertList.tsx` per the brief's Step 5 code, with
   one necessary fix (see "Deviations from the brief").
5. Wrote `__tests__/unit/components/AlertList.test.tsx` (13 tests) to cover
   the disabled-not-hidden requirement and general AlertList behavior, since
   it was named as an "exposed spot" for this task despite not being in the
   brief's literal file list.

### Step 6: `app/alerts/page.tsx`

Restructured the brief's given code into `AlertsPageContent` + a default
export that wraps it in `<Suspense>`, mirroring `app/devices/page.tsx:432-445`
exactly (that file's comment: "The filter state is read from the URL, which
requires a Suspense boundary."). Fallback is a centered spinner using the same
spinner markup `AlertList` itself uses for its loading state (there's no
existing alerts-specific skeleton component to reuse, unlike `devices` which
has `DeviceCardSkeleton`).

### Step 7: Verify build and tests — see "Gate output" below.

### Step 8: Commit — see "Commit" below.

## TDD evidence: useAlertFilterParams (18 tests)

**Failing run** (before the hook existed):
```
FAIL jsdom __tests__/unit/components/useAlertFilterParams.test.tsx
  ● Test suite failed to run
    Configuration error:
    Could not locate module @/components/alerts/useAlertFilterParams mapped as:
    /home/yzel/github/infrasight-phase4/$1.
Test Suites: 1 failed, 1 total
Tests:       0 total
```

**Passing run** (after):
```
PASS jsdom __tests__/unit/components/useAlertFilterParams.test.tsx
  useAlertFilterParams
    reading state from the URL
      ✓ should default to open/all/page-1 when the URL is bare
      ✓ should restore a filtered view from a shared link
      ✓ should fall back to page 1 for a genuinely unparseable page
      ✓ should fall back to page 1 for an out-of-range page
      ✓ should fall back to "all" for an unrecognized severity rather than passing it through
      ✓ should fall back to "open" for an unrecognized status rather than passing it through
    writing state to the URL
      ✓ should put the selected status in the URL
      ✓ should put the selected severity in the URL
      ✓ should put an explicit page in the URL
      ✓ should keep the current status/severity when only the page changes
      ✓ should return to a bare path when the only non-default filter is reset
      ✓ should never write "status=open" or "severity=all" to the URL
      ✓ should never write "page=1" to the URL
      ✓ should reset page to 1 in the same write when status changes, starting from page 3
      ✓ should reset page to 1 in the same write when severity changes, starting from page 3
      ✓ should preserve an already-selected severity when status changes, dropping page 3 to 1
    initialFilters seeding
      ✓ should seed status from initialFilters when the URL does not specify one
      ✓ should let an explicit URL parameter win over initialFilters
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
```

## Deletion-check evidence: the three pinned useAlertFilterParams rules

Per the task instructions: "For every test you write, ask: would this fail if
the behavior it names were deleted? Actually delete the line and confirm red
before claiming green." Did this for all three rules named in the brief's
"Ambiguity I am resolving for you" section, one at a time, reverting between
each.

### Rule 1 — page resets to 1 in the same URL write as a filter change

Broke it by changing `setStatus`/`setSeverity` to pass the *current* `page`
instead of hardcoding `1`:
```diff
- (nextStatus: string) => navigate({ status: nextStatus, severity, page: 1 }),
+ (nextStatus: string) => navigate({ status: nextStatus, severity, page }),
```
Result: **4 tests failed**, all directly about this rule — e.g.:
```
- Expected: "/alerts?severity=warning"
+ Received: "/alerts?severity=warning&page=3"
```
Reverted; re-ran; all 18 pass again.

### Rule 2 — default values omitted from the query string

Broke it by removing the `!== DEFAULT_*` guards in `buildQueryString`, always
setting `status`/`severity`/`page`:
```diff
- if (status !== DEFAULT_STATUS) params.set('status', status);
- if (severity !== DEFAULT_SEVERITY) params.set('severity', severity);
- if (page > 1) params.set('page', String(page));
+ params.set('status', status);
+ params.set('severity', severity);
+ params.set('page', String(page));
```
Result: **9 tests failed**, including the two written specifically to assert
*absence* via `URLSearchParams.has()` rather than just value equality:
```
- Expected: "/alerts?status=firing"
+ Received: "/alerts?status=firing&severity=all&page=1"
```
Reverted; re-ran; all 18 pass again.

### Rule 3 — unparseable values fall back to defaults

Broke it in two parts. First, removed the enum validation:
```diff
- return isValidStatus(raw) ? raw : DEFAULT_STATUS;
+ return raw;
```
(same for severity), and loosened the page fallback to `raw || 1`. Result:
only the 2 enum tests failed (`severity=purple` → `"purple"`,
`status=bogus` → `"bogus""`) — the page tests for `banana`/`0` still passed
*coincidentally*, because `Number('banana') || 1` and `0 || 1` both still
evaluate to `1`. That meant my first attempt at breaking the page fallback
wasn't a genuine deletion for those two specific test inputs, so I re-did it
with a break that actually removes the fallback entirely:
```diff
- const raw = Number(searchParams.get('page'));
- return Number.isInteger(raw) && raw > 0 ? raw : 1;
+ return Number(searchParams.get('page'));
```
Result: **5 tests failed** (the bare-URL default test plus all four
unparseable-input tests: page=banana, page=0, severity=purple, status=bogus),
confirming real coverage this time:
```
✕ should default to open/all/page-1 when the URL is bare
✕ should fall back to page 1 for a genuinely unparseable page
✕ should fall back to page 1 for an out-of-range page
✕ should fall back to "all" for an unrecognized severity...
✕ should fall back to "open" for an unrecognized status...
Tests: 5 failed, 13 passed, 18 total
```
Reverted both changes; re-ran; all 18 pass again. Confirmed no
`DELETION-CHECK` comments remain in the source (`grep` returned nothing).

## Deletion-check evidence: disabled-not-hidden (AlertList)

Wrote `AlertList.test.tsx`'s
`'should render Acknowledge and Resolve PRESENT but DISABLED for a non-admin, with an explanatory tooltip'`
test to assert both presence (`toBeInTheDocument()`) and disabled state
(`toBeDisabled()`) plus the tooltip (`toHaveAttribute('title', ...)`). Broke
it two different ways, one at a time:

**Break A — always enabled** (remove the `!isAdmin` gate from `disabled`):
```diff
- disabled={!isAdmin || acknowledge.isPending}
+ disabled={acknowledge.isPending}
```
Result: the disabled-for-non-admin test went red (button found, but not
disabled):
```
✕ should render Acknowledge and Resolve PRESENT but DISABLED for a non-admin...
Tests: 1 failed, 12 passed, 13 total
```
Reverted; re-ran; 13/13 pass.

**Break B — hidden entirely instead of disabled** (add `isAdmin` to the
render guard, the actual anti-pattern the demo-mode rule forbids):
```diff
- {alert.status === 'firing' && (
+ {alert.status === 'firing' && isAdmin && (
```
(same for the Resolve guard). Result: same test went red, this time because
`getByRole('button', { name: /acknowledge/i })` throws — the button does not
exist for a non-admin:
```
✕ should render Acknowledge and Resolve PRESENT but DISABLED for a non-admin...
Tests: 1 failed, 12 passed, 13 total
```
This is exactly the failure mode named in the task instructions: "A test that
only checks `toBeDisabled()` on a button that does not exist will throw" —
confirmed. Reverted; re-ran; 13/13 pass. Confirmed no `DELETION-CHECK`
comments remain in `components/alerts/AlertList.tsx`.

The companion test (`'... ENABLED for an admin, with no tooltip'`) guards the
inverse failure mode named in the instructions — a test that only checks
presence would pass against a permanently-disabled button; asserting
`not.toBeDisabled()` for the admin case rules that out too.

## AlertList.test.tsx — full run (13 tests, all passing after revert)

```
PASS jsdom __tests__/unit/components/AlertList.test.tsx
  AlertList
    rendering rows
      ✓ should render severity, status, rule name, device id, and a plain-language condition
      ✓ should call onDeviceClick with the device id when the device button is clicked
    loading, error, and empty states
      ✓ should show a spinner while loading
      ✓ should show an error message when the query fails
      ✓ should show "No open alerts." when the list is empty
    admin gating on Acknowledge/Resolve (disabled, never hidden)
      ✓ should render Acknowledge and Resolve PRESENT but DISABLED for a non-admin, with an explanatory tooltip
      ✓ should render Acknowledge and Resolve ENABLED for an admin, with no tooltip
      ✓ should not render Acknowledge for an alert that is not firing, regardless of role
      ✓ should not render Resolve for an alert that is already resolved (not open)
    admin actions
      ✓ should acknowledge with the alert id and toast success on completion
      ✓ should resolve with the alert id and toast success on completion
    pagination
      ✓ should disable the previous-page control on page 1
      ✓ should disable the next-page control when a page comes back short of PAGE_SIZE
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

Mocking follows the codebase's established pattern for this exact pitfall:
`DashboardStatCards.test.tsx` mocks `@/lib/query/hooks` at the literal module
specifier the component under test imports from (not a barrel it doesn't
import through), so the mock actually intercepts. `AlertList.test.tsx` mocks
`@/lib/query/hooks`, `@/lib/auth/rbac-client`, and
`@/components/alerts/useAlertFilterParams` the same way — all three are the
exact paths `AlertList.tsx` imports from (the last one resolves to the same
file as `AlertList.tsx`'s relative `./useAlertFilterParams` import, since Jest
mocks by resolved module identity, not literal specifier text).

## Gate output (Step 7 + the orchestrator's global constraints)

**`npx tsc --noEmit`**
```
(no output — exit 0)
```

**`pnpm lint`**
```
$ eslint
(no output — exit 0)
```

**`pnpm test __tests__/unit/components`**
```
Test Suites: 15 passed, 15 total
Tests:       185 passed, 185 total
```
(12 pre-existing suites + 3 new = 15; matches.)

**`pnpm build`**
```
✓ Compiled successfully in 3.6s
✓ Completed runAfterProductionCompile in 260ms
   Running TypeScript ...
   Collecting page data using 23 workers ...
✓ Generating static pages using 23 workers (31/31) in 1035.8ms
   Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /alerts          <-- static, prerendered — confirms the Suspense fix worked
├ ○ /analytics
...
```
No prerender error on `/alerts`.

**Full `pnpm test` (whole repo)**
```
Test Suites: 107 passed, 107 total
Tests:       2519 passed, 2519 total
Time:        39.856 s
```
Baseline entering this task (confirmed by running the full suite before
touching any files): **104 suites / 2480 tests, all passing**. Delta is
exactly +3 suites / +39 tests (8 badge + 18 filter-param + 13 AlertList), and
every one of the original 2480 still passes. No regressions.

## Commit

```
3d0513e feat(alerting): add alert badges, list, and /alerts page
 8 files changed, 1076 insertions(+)
 create mode 100644 __tests__/unit/components/AlertBadges.test.tsx
 create mode 100644 __tests__/unit/components/AlertList.test.tsx
 create mode 100644 __tests__/unit/components/useAlertFilterParams.test.tsx
 create mode 100644 app/alerts/page.tsx
 create mode 100644 components/alerts/AlertList.tsx
 create mode 100644 components/alerts/AlertSeverityBadge.tsx
 create mode 100644 components/alerts/AlertStatusBadge.tsx
 create mode 100644 components/alerts/useAlertFilterParams.ts
```

Single commit, conventional style, made only at the end per the task
constraints. Working tree clean afterward.

## Deviations from the brief (and why)

1. **`setPage(page: number)`, not a functional updater.** The brief's
   "Ambiguity I am resolving for you" section gives the authoritative
   interface: `setPage: (page: number) => void`. But the brief's own
   `AlertList.tsx` example code calls `setPage(p => p - 1)` /
   `setPage(p => p + 1)` — passing a function where the interface declares a
   `number`. Under the strict zero-error `tsc` gate this is a real type
   error (a function is not assignable to `number`), and no amount of
   internal-implementation cleverness fixes it, because the *declared*
   return type of the hook is what the AlertList call site sees. I kept the
   interface exactly as specified (it's explicitly the ambiguity-resolution,
   i.e. authoritative, source) and changed the two call sites to
   `setPage(page - 1)` / `setPage(page + 1)`, using the `page` value already
   destructured in scope — identical runtime behavior, just spelled to match
   the real contract. Confirmed via `tsc --noEmit` (0 errors) and the
   pagination tests in `AlertList.test.tsx`.

2. **Added `__tests__/unit/components/AlertList.test.tsx`**, which is not in
   the brief's literal "Files" list (only `AlertBadges.test.tsx` and
   `useAlertFilterParams.test.tsx` are listed there). The orchestrator's task
   instructions separately and explicitly name "the disabled-not-hidden
   requirement" as one of two "exposed spots" for this task in the
   "failure mode this project keeps hitting" section, which is exactly the
   pattern of "a claimed behavior with no test at all." Since the brief's
   file list would have left that requirement unverified, I added the test
   file and did the full deletion-check on it (see above). I also included a
   handful of adjacent AlertList tests (loading/error/empty states, mutation
   wiring, pagination disable logic) rather than a single isolated test, on
   the reasoning that a component with this much real branching logic
   shouldn't ship with only one assertion in its suite — consistent with the
   rigor `AlertToaster.test.tsx` (Task 14) already established in this
   codebase.

3. **`useAlertFilterParams` validates `status`/`severity` against known
   enums** (`open`/`firing`/`acknowledged`/`resolved` and
   `all`/`critical`/`warning`/`info`), even though the interface stub types
   both fields as plain `string`. This was necessary to satisfy the brief's
   explicit example — "`?severity=purple` is `all`" — which requires
   *something* to recognize `purple` as invalid. I kept the return type as
   `string` (per the interface) but added internal validation functions.

## Things I was unsure about

- **`initialFilters` seeding for `status`/`severity`** is implemented per the
  brief's prose ("initialFilters seeds only what the URL does not already
  specify") but is not exercised by the one real caller in this task
  (`app/alerts/page.tsx` passes no `initialFilters` at all). It's written for
  Task 16/17 forward-compatibility (e.g. a future alert-detail or
  rule-detail view passing `device_id` or similar). I added two tests for it
  but did not do a full deletion-check pass on that piece specifically, since
  it wasn't named as a pinned rule or an exposed spot — flagging in case a
  future task's usage reveals the seeding contract needs to be stricter than
  what I inferred from the prose.
- **`/alerts/rules` link** in the page header (Task 17, not yet built) and
  `/alerts/${alert._id}` links per row (Task 16, not yet built) both point to
  routes that don't exist yet. This is consistent with how the plan
  sequences tasks (mirrors the codebase's existing pattern of forward links
  to not-yet-built routes), and Next's `Link` doesn't fail a build over an
  unbuilt destination, but flagging it explicitly in case that's not the
  intended reading.
- I did not add an `AlertListSkeleton`-equivalent component for the
  `/alerts` page's Suspense fallback (unlike `devices`, which reuses
  `DeviceCardSkeleton`); I used an inline spinner instead since no such
  component exists yet for alerts and the brief didn't ask for one.

---

# Fix round 1 (review findings)

Commit: `1f875ec` — `fix(alerting): use useAdminAction, add relative timestamp, fix pagination a11y`

Review came back "Needs fixes" with three Important findings, all addressed
below. Two Minor items (the `onError` handler's missing `instanceof Error`
guard, and `initialFilters` unable to distinguish "never set" from
"explicitly reset to default") were explicitly marked deferred by the
coordinator — left untouched.

## Finding 1 — use `useAdminAction()`, not hand-rolled `useRbac` gating

**Change.** `components/alerts/AlertList.tsx`: replaced `const { isAdmin } =
useRbac();` with two calls, `const ackAction = useAdminAction(); const
resolveAction = useAdminAction();` (mirroring `app/analytics/page.tsx:18,51-55`'s
`reportAction` shape — two calls rather than one shared value, naming the two
gated actions distinctly). Removed the `ADMIN_ONLY_TOOLTIP` constant and the
`useRbac` import entirely (nothing else in the file used it). Both buttons now
read:

```tsx
{ackAction.visible && alert.status === 'firing' && (
  <Button
    disabled={ackAction.disabled || acknowledge.isPending}
    title={ackAction.tooltip}
    ...
```

(same shape for `resolveAction`/Resolve). The stale comment claiming
"disabled, never hidden" was replaced with one describing the real
three-branch contract.

**Test rewrite.** `useAdminAction`/`useRbac` are deliberately **not** mocked
in `AlertList.test.tsx` — only `@clerk/nextjs`'s `useAuth` is stubbed, exactly
like `__tests__/unit/lib/rbac-client.test.ts` does for `useRbac` directly.
This exercises the real gating chain end to end rather than proving only that
`AlertList` reads some mock correctly (which is exactly the class of bug this
finding was about — the previous version's own logic was wrong, not just
undertested). A `signedInAs(orgRole)` helper drives `useAuth`'s return value;
`setDemoMode(...)` drives `process.env.NEXT_PUBLIC_DEMO_MODE` (save/restored
around the suite, same pattern `rbac-client.test.ts` uses for its own env
var). Confirmed empirically that `.env.local`'s real values
(`NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS="infrasight"`,
`NEXT_PUBLIC_DEMO_MODE=true`) do not leak into the Jest process — the
existing, currently-green `rbac-client.test.ts` asserts `isAdmin: true` with
`orgSlug: 'users'`, which would be impossible if "infrasight" were the live
allowlist — so `orgSlug: 'users'` in my tests is safe, and the explicit
`delete`/set on `NEXT_PUBLIC_DEMO_MODE` per test is authoritative regardless.

Three branches, three tests, all in `describe('admin gating on
Acknowledge/Resolve (via useAdminAction)')`:

```
✓ should render Acknowledge and Resolve ENABLED for an admin, with no tooltip
✓ should render Acknowledge and Resolve PRESENT but DISABLED with a tooltip for a non-admin in demo mode
✓ should HIDE Acknowledge and Resolve entirely for a non-admin outside demo mode
```

**Deletion-check evidence** (three breaks, one at a time, on the Acknowledge
button's wiring; reverted between each):

1. Dropped `ackAction.disabled` from the `disabled` prop (→ always enabled
   when visible):
   ```
   ✕ should render Acknowledge and Resolve PRESENT but DISABLED with a tooltip for a non-admin in demo mode
   Tests: 1 failed, 18 passed, 19 total
   ```
2. Dropped `ackAction.visible &&` from the render guard (→ always renders
   regardless of role/demo-mode):
   ```
   ✕ should HIDE Acknowledge and Resolve entirely for a non-admin outside demo mode
   Tests: 1 failed, 18 passed, 19 total
   ```
3. Forced `disabled={true || ...}` (→ always disabled):
   ```
   ✕ should render Acknowledge and Resolve ENABLED for an admin, with no tooltip
   ✕ should acknowledge with the alert id and toast success on completion
   Tests: 2 failed, 17 passed, 19 total
   ```
   (The second failure is expected collateral: `fireEvent.click` on a
   `disabled` button does not dispatch a click in jsdom, so the interaction
   test correctly fails too — further confirming the assertions are load-bearing.)

Reverted after each break; final state 19/19 passing, no `DELETION-CHECK`
markers left in source (`grep` confirmed clean).

## Finding 2 — missing relative timestamp

**Change.** Added `formatRelativeTime(isoString: string): string` to
`AlertList.tsx` (exported, alongside `describeCondition`, for the same
reason — Task 16's detail view is a likely consumer). Implementation is the
standard "divisions" algorithm (largest-unit-first stepping) wrapping the
built-in `Intl.RelativeTimeFormat` — no `date-fns` dependency added, per the
instruction. Verified the exact output strings against this Node runtime
before writing tests (`node -e`): `"30 seconds ago"`, `"5 minutes ago"`,
`"2 hours ago"`, `"3 days ago"` all confirmed literally.

Each row now renders:
```tsx
{/* fired_at is unset while an episode is still pending; breached_since always exists. */}
<span className="text-sm text-muted-foreground">
  {formatRelativeTime(alert.fired_at ?? alert.breached_since)}
</span>
```

**Tests added:**
- A dedicated `describe('formatRelativeTime')` block (4 tests: seconds,
  minutes, hours, days), using `jest.useFakeTimers()` +
  `jest.setSystemTime(...)` per case for determinism.
- The main row-rendering test now also asserts `'5 minutes ago'` is present
  (fixed "now" is 5 minutes after the fixture's `fired_at`, chosen to match
  the fixture's existing `last_observed_at` value).
- A dedicated fallback test: `makeAlert({ fired_at: undefined, breached_since:
  '2026-08-01T10:00:00.000Z' })` against the same fixed "now", asserting
  `'2 hours ago'` renders — proving the fallback path, not just the happy path.

**Deletion-check evidence** (two breaks, reverted between each):

1. Removed the entire relative-timestamp `<span>`:
   ```
   ✕ should render severity, status, rule name, device id, a plain-language condition, and a relative timestamp
   ✕ should fall back to breached_since for the relative timestamp when fired_at is absent
   Tests: 2 failed, 17 passed, 19 total
   ```
2. Reverted, then specifically dropped the `?? alert.breached_since` fallback
   (used `alert.fired_at as string` alone):
   ```
   ✕ should fall back to breached_since for the relative timestamp when fired_at is absent
   Tests: 1 failed, 18 passed, 19 total
   ```
   Precisely the fallback test failed — the always-present-fired_at test was
   unaffected, confirming the two tests each cover a distinct piece of the
   requirement.

Reverted after each break; final state 19/19 passing, no `DELETION-CHECK`
markers left in source.

## Finding 3 — pagination buttons have no accessible name

**Change.** Added visible text to both pagination buttons in `AlertList.tsx`,
matching `ScheduleList.tsx:337-353`'s exact arrangement: `<ChevronLeft
/>Previous` and `Next<ChevronRight />`.

**Test change.** Both pagination tests in `AlertList.test.tsx` now use
`screen.getByRole('button', { name: /previous/i })` /
`screen.getByRole('button', { name: /next/i })` instead of
`container.querySelector('.mt-4')` + positional `querySelectorAll('button')`
indexing.

**Deletion-check evidence.** Reverted to icon-only buttons (no visible text):
```
✕ should disable the previous-page control on page 1, discoverable by its accessible name
✕ should disable the next-page control when a page comes back short of PAGE_SIZE, discoverable by its accessible name
Tests: 2 failed, 17 passed, 19 total
```
Both threw (`getByRole` found no matching element) rather than failing an
assertion — the exact "tell" the coordinator described: there was nothing
accessible to query by. Reverted; final state 19/19 passing, no
`DELETION-CHECK` markers left in source.

## Gate output (fix round 1)

**`npx tsc --noEmit`**
```
(no output — exit 0)
```

**`pnpm lint`**
```
$ eslint
(no output — exit 0)
```

**`pnpm build`**
```
✓ Compiled successfully
✓ Generating static pages using 23 workers (31/31) in 1314.0ms
...
├ ○ /alerts   <-- still static, Suspense boundary unaffected by these changes
```

**Full `pnpm test`**
```
Test Suites: 107 passed, 107 total
Tests:       2525 passed, 2525 total
Time:        39.177 s
```
Entering this fix round: 107 suites / 2519 tests (from the original Task 15
submission). Delta is exactly +6 tests (`AlertList.test.tsx` grew from 13 to
19 tests), 0 suites added/removed, no regressions anywhere else.

## Commit

```
1f875ec fix(alerting): use useAdminAction, add relative timestamp, fix pagination a11y
 2 files changed, 179 insertions(+), 66 deletions(-)
```

Single commit on top of `3d0513e`, conventional style. Working tree clean
afterward.

## Things I was unsure about, this round

- **Two `useAdminAction()` calls vs. one shared value.** Since the hook takes
  no arguments, `ackAction` and `resolveAction` are always structurally
  identical for a given render — calling it twice is slightly redundant
  computation (trivial cost) in exchange for each button's gating reading as
  self-contained. I followed the coordinator's example literally rather than
  hoisting to a single `adminAction` shared by both buttons; flagging in case
  a single shared call was actually intended and the example was illustrative
  rather than prescriptive.
- **`formatRelativeTime`'s unit thresholds** (7 days → weeks, ~4.345 weeks →
  months, 12 months → years) are a standard, commonly-used formulation but are
  my own choice, not specified anywhere — nothing in this codebase exercises
  the week/month/year branches (alerts are 7-day-TTL data, so in practice only
  the seconds/minutes/hours/days branches will ever fire), so those upper
  branches are unexercised by any test. Flagging in case a reviewer wants
  explicit coverage there too, though I judged it low-value given the TTL.
