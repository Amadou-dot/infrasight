# Task 16 Report: Alert detail page

Branch: `feat/phase-4-alerting` (worktree `/home/yzel/github/infrasight-phase4`)
Commit: `0b18496` — `feat(alerting): add deep-linkable alert detail page`

## Summary

Implemented `components/alerts/AlertDetailView.tsx` and `app/alerts/[id]/page.tsx`
per `task-16-brief.md`, plus `__tests__/unit/components/AlertDetailView.test.tsx`
(from the brief, extended) and `__tests__/unit/components/AlertDetailPage.test.tsx`
(not in the brief's literal file list — added deliberately; see "Deviations from
the brief" below).

All four gates pass with zero tolerance:

- `npx tsc --noEmit` — 0 errors
- `pnpm lint` — 0 problems (exit 0)
- `pnpm test` — 2549/2549 passing, 109/109 suites (baseline was 2525/107; delta is
  exactly the 24 new tests across 2 new suites — no regressions)
- `pnpm build` — clean; `/alerts/[id]` compiles as `ƒ` (dynamic), matching
  `/devices/[id]`

## What was implemented

### `components/alerts/AlertDetailView.tsx`

Presentational component, `'use client'`, props
`{ alert: AlertV2Response; bracketingReadings: BracketingReading[]; loading: boolean; forDurationSeconds?: number }`:

- Header: rule name, `AlertSeverityBadge`, `AlertStatusBadge`.
- Condition in plain language via `describeCondition(alert)` (imported from
  `AlertList.tsx`, not reimplemented), with ` for ${humanizeDuration(...)}`
  appended when `forDurationSeconds` is truthy (0/undefined both suppress it).
- Lifecycle timeline: `breached_since -> fired_at -> audit.acknowledged_at ->
  audit.resolved_at`, each step rendered only when its timestamp exists. The
  acknowledged/resolved steps show the actor. The resolved step shows
  `audit.resolution` via a label map (`manual`/`auto`/`stale`/`device_inactive`)
  that deliberately never uses the word "resolved" (the status badge already
  says that; see "collision avoidance" below) and phrases `stale`/`device_inactive`
  as a closure, not a fix — "closed — stale (no recent readings)" /
  "closed — device went inactive" vs. "closed automatically — back within
  threshold" for `auto`.
- Values block: `trigger_value`, `last_value`, `threshold` always; `resolved_value`
  only when `!== undefined` (strict check, since `0` is a legitimate value).
- Device link: `<Link href={'/devices/' + alert.device_id}>{alert.device_id}</Link>`.
- Bracketing readings as a simple table (`Timestamp`/`Value` columns). `loading`
  gates this section specifically — the alert itself is always already-loaded by
  the time this component renders (the page only renders it once
  `useAlertDetail` has settled), so `loading` was designed to mean "the
  bracketing-readings query is still in flight," and the page wires it to that
  query's own `isLoading` (see "Deviations from the brief").
- Acknowledge/Resolch buttons: **self-contained**, calling `useAcknowledgeAlert()`
  / `useResolveAlert()` directly and gated with `useAdminAction()` (two separate
  calls, matching `AlertList.tsx`'s exact pattern) — `ackAction.visible && alert.status
  === 'firing'`, `resolveAction.visible && alert.is_open`. Toasts on
  success/error via `react-toastify`, mirroring `AlertList.tsx`'s `act()` helper.

### `app/alerts/[id]/page.tsx`

Follows `app/devices/[id]/page.tsx`'s shape:

- `useAlertDetail(alertId, { include_device: true }, { retry: false })` — the
  explicit `retry: false` is required per the interface notes (the hook's own
  defaults don't set it, and the global QueryClient default is `retry: 2`,
  which would spin the loading spinner through ~3s of backoff before a 404
  ever settled).
- `useQuery` for bracketing readings, `fired_at ± 15m` (falls back to
  `breached_since` when `fired_at` is absent), calling the existing
  `v2Api.readings.list({ device_id, startDate, endDate })` — no new endpoint.
- 404 handling: `apiCall()` (`lib/api/v2-client.ts`) always throws
  `ApiClientError`, including network failures, so
  `error instanceof ApiClientError && error.statusCode === 404` reliably
  narrows a genuine 404. Only that case calls `notFound()`. Any other error
  (network, 500) renders a retry banner instead, calling `refetch()` — the
  same distinction `useDeviceDetail` draws for the devices page (see
  "Deviations from the brief": the brief's literal Step 4 code treated every
  post-load error as not-found).

## TDD evidence

### `AlertDetailView.tsx`

**Failing run** (before the component existed):

```
FAIL jsdom __tests__/unit/components/AlertDetailView.test.tsx
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/components/alerts/AlertDetailView mapped as:
    /home/yzel/github/infrasight-phase4/$1.
      20 | import { AlertDetailView } from '@/components/alerts/AlertDetailView';
         | ^

Test Suites: 1 failed, 1 total
Tests:       0 total
```

**Passing run** (after, including the tests added beyond the brief's literal 6):

```
PASS jsdom __tests__/unit/components/AlertDetailView.test.tsx
  AlertDetailView
    ✓ should state the condition in plain language (33 ms)
    ✓ should mention the duration when the rule has one (7 ms)
    ✓ should render the lifecycle timeline (8 ms)
    ✓ should show acknowledged and resolved steps once they exist (7 ms)
    ✓ should link to the device (26 ms)
    ✓ should render the bracketing readings (7 ms)
    resolution wording (auto vs stale/device_inactive)
      ✓ should describe an automatic resolution distinctly from a stale/inactive closure (13 ms)
    actors on the timeline
      ✓ should show the actor beside both the acknowledged and closed steps (9 ms)
    resolved_value is conditional
      ✓ should not render a closing value when resolved_value is absent (manual/swept resolution) (6 ms)
      ✓ should render the closing value when auto-resolution attributes one (5 ms)
    bracketing readings loading state
      ✓ should show a loading indicator for the readings table while it loads (9 ms)
      ✓ should show an empty state once loaded with no bracketing readings (7 ms)
    admin gating on Acknowledge/Resolve (via useAdminAction)
      ✓ should render Acknowledge and Resolve ENABLED for an admin, with no tooltip (14 ms)
      ✓ should render Acknowledge and Resolve PRESENT but DISABLED with a tooltip for a non-admin in demo mode (10 ms)
      ✓ should HIDE Acknowledge and Resolve entirely for a non-admin outside demo mode (4 ms)
      ✓ should not render Acknowledge for an alert that is not firing, regardless of role (7 ms)
      ✓ should not render Resolve for an alert that is already resolved (not open) (5 ms)
    admin actions
      ✓ should acknowledge with the alert id and toast success on completion (8 ms)
      ✓ should resolve with the alert id and toast success on completion (7 ms)

Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
```

### `app/alerts/[id]/page.tsx`

**Failing run** (before the page existed):

```
FAIL jsdom __tests__/unit/components/AlertDetailPage.test.tsx
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/app/alerts/[id]/page mapped as:
    /home/yzel/github/infrasight-phase4/$1.
      26 | import AlertDetailPage from '@/app/alerts/[id]/page';
         | ^

Test Suites: 1 failed, 1 total
Tests:       0 total
```

(First real run after creating the page also failed for a second, unrelated
reason — mocking `@tanstack/react-query` wholesale broke
`lib/query/queryClient.ts`'s top-level `new QueryClient(...)`, since the mock
factory replaced the `QueryClient` export too:
`TypeError: react_query_1.QueryClient is not a constructor`. Fixed by
spreading `jest.requireActual('@tanstack/react-query')` into the mock and
only overriding `useQuery`.)

**Passing run** (after both fixes):

```
PASS jsdom __tests__/unit/components/AlertDetailPage.test.tsx
  AlertDetailPage
    ✓ should show a loading spinner while the alert is loading, and not render the view or 404 (27 ms)
    ✓ should render the styled not-found state for an alert id that does not resolve (404) (4 ms)
    ✓ should show a retry banner (not the 404 page) for a non-404 error (9 ms)
    ✓ should render AlertDetailView once the alert loads, and not call notFound (4 ms)
    ✓ should pass retry: false to useAlertDetail so a 404 does not spin through retries first (6 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

## Deletion-check evidence

Per the task instructions: "For every test you write, ask: would this fail if
the behavior it names were deleted? Delete the line and confirm red before
claiming green." Did this for all of the named loading/error-404/admin-gating
states, plus a few of the brief's own core assertions as extra insurance. Each
mutation was applied, run, confirmed red, then reverted and confirmed green
again (final full-suite green run is in "Gate output" below).

### Loading state (page)

Disabled the spinner guard: `{isLoading && (...)}` → `{false && isLoading && (...)}`.

```
✕ should show a loading spinner while the alert is loading, and not render the view or 404 (23 ms)
  expect(received).toBeInTheDocument()
  received value must be an HTMLElement or an SVGElement.
  Received has value: null
    > 111 |     expect(container.querySelector('.animate-spin')).toBeInTheDocument();
```

Reverted; other 4 page tests stayed green throughout.

### Error/404 state (page) — two checks

**(a) The `notFound()` call itself.** Disabled it:
`if (!isLoading && isNotFound) notFound();` → `if (false && !isLoading && isNotFound) notFound();`

```
✕ should render the styled not-found state for an alert id that does not resolve (404) (4 ms)
  expect(jest.fn()).toHaveBeenCalledTimes(expected)
  Expected number of calls: 1
  Received number of calls: 0
```

**(b) The 404-vs-other-error distinction** (my own addition beyond the brief's
literal code, which treated every post-load error as not-found). Widened the
check: `error instanceof ApiClientError && error.statusCode === 404` →
`error instanceof ApiClientError` (no status check).

```
✕ should show a retry banner (not the 404 page) for a non-404 error (4 ms)
  expect(jest.fn()).not.toHaveBeenCalled()
  Expected number of calls: 0
  Received number of calls: 1
```

Both reverted; confirmed green again.

### Admin-gating state (component) — four checks

**(a) Visibility gate.** Hardcoded `ackAction.visible` / `resolveAction.visible`
to `true`:

```
✕ should HIDE Acknowledge and Resolve entirely for a non-admin outside demo mode (8 ms)
  expected document not to contain element, found <button ... >Acknowledge</button> instead
```

**(b) Disabled gate.** Hardcoded `ackAction.disabled` / `resolveAction.disabled`
to `false`:

```
✕ should render Acknowledge and Resolve PRESENT but DISABLED with a tooltip for a non-admin in demo mode (13 ms)
  expect(element).toBeDisabled()
  Received element is not disabled: <button ... title="Admin only · this is a read-only demo" />
```

Both reverted; confirmed green again. (Note: per the mandated pattern, these
tests stub only Clerk's `useAuth` — not `@/lib/auth/rbac-client` itself — so
the real `useRbac`/`useAdminAction` chain runs end to end, the same way
`AlertList.test.tsx` does. Confirmed the local `jest.mock('@clerk/nextjs', ...)`
actually overrides `__tests__/setup/jest.setup.jsdom.ts`'s module-level mock
(which has no `useAuth`) by running the file — it fails loudly with "useAuth is
not a function" if the override doesn't take, and it didn't.)

### Extra insurance beyond the required three states

**Bracketing-readings loading indicator** (the component's own `loading` prop,
distinct from the page-level spinner above). Disabled the branch:
`{loading ? (...) : ...}` → `{false ? (...) : ...}`

```
✕ should show a loading indicator for the readings table while it loads (8 ms)
  received value must be an HTMLElement or an SVGElement. Received has value: null
```

**Resolution-wording distinctness** (the explicit "`stale`/`device_inactive`
must read distinctly from `auto`" requirement). Hardcoded the label to the
literal string `'closed'` regardless of `audit.resolution`:

```
✕ should describe an automatic resolution distinctly from a stale/inactive closure (8 ms)
  Unable to find an element with the text: /back within threshold/i.
```

**Actor beside acknowledged/resolved steps.** Removed the
`` ` by ${actor}` `` interpolations on both steps:

```
✕ should show the actor beside both the acknowledged and closed steps (12 ms)
  Unable to find an element with the text: /acknowledged.*alice/i.
```

**Device link** (one of the brief's core 6, checked as extra insurance since
the "42"/"resolved" collision analysis below made me want independent
confirmation the assertions bite). Corrupted the href:
`` `/devices/${alert.device_id}` `` → `` `/devicez/${alert.device_id}` ``

```
✕ should link to the device
  Expected the element to have attribute: href="/devices/device_001"
  Received: href="/devicez/device_001"
```

All eight mutations above were reverted after confirming red, and the full
`AlertDetailView`/`AlertDetailPage` suites were re-run green after every
single revert (not just at the end) — shown throughout this section and in
the final gate output below.

## A collision hazard worth recording

The brief's default alert fixture has `trigger_value: 42`, and the
"bracketing readings" test's fixture also includes a reading with `value: 42`.
`screen.getByText('42')` does an *exact* match and throws if more than one
element's own direct text-node content equals `"42"`. Testing Library's
`getNodeText` only concatenates an element's *direct* text-node children (not
descendant elements' text), so `<span>Trigger value: {42}</span>` is safe
(its own text is `"Trigger value: 42"`, not `"42"`) but a
`DeviceDetailView`-style split `<span>Trigger value</span><span>{42}</span>`
would NOT be (the value span's own text would be exactly `"42"`, colliding
with the readings table's `<td>42</td>`). The Values block therefore keeps
each label+value in a single element rather than splitting them, and the same
applies to the `RESOLUTION_LABELS` wording avoiding the word "resolved" (the
status badge already renders exactly `"Resolved"` as its own direct text, so
a second element containing that substring would make
`getByText(/resolved/i)` ambiguous in the "acknowledged and resolved steps"
test). Both were designed in up front and confirmed by the first clean test
run (no debugging cycle needed), and are the reason `AlertDetailView.tsx`
carries inline comments calling this out.

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

### `pnpm test` (full suite, final run after all deletion-check reverts)

```
Test Suites: 109 passed, 109 total
Tests:       2549 passed, 2549 total
Snapshots:   0 total
Time:        39.797 s
Ran all test suites in 2 projects.
```

Baseline entering this task was 2525 tests / 107 suites (per the task's global
constraints). Delta: +2 suites (`AlertDetailView.test.tsx`,
`AlertDetailPage.test.tsx`), +24 tests (19 + 5). No other suite's count
changed — no regressions.

### `pnpm build`

```
   ▲ Next.js 16.0.10 (Turbopack)
   - Environments: .env.local
 ✓ Compiled successfully in 3.9s
   Running next.config.js provided runAfterProductionCompile ...
 ✓ Completed runAfterProductionCompile in 245ms
   Running TypeScript ...
   Collecting page data using 23 workers ...
   Generating static pages using 23 workers (31/31) in 1136.9ms
   Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /alerts
├ ƒ /alerts/[id]
├ ○ /analytics
...
├ ƒ /devices/[id]
...

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

`/alerts/[id]` compiles as `ƒ` (dynamic, server-rendered on demand), matching
`/devices/[id]`'s classification exactly. Build exit code 0.

## Commit

```
0b18496 feat(alerting): add deep-linkable alert detail page
```

4 files changed, 960 insertions: `components/alerts/AlertDetailView.tsx`,
`app/alerts/[id]/page.tsx`, `__tests__/unit/components/AlertDetailView.test.tsx`,
`__tests__/unit/components/AlertDetailPage.test.tsx`.

## Deviations from the brief

1. **`AlertDetailPage.test.tsx` added** (not in the brief's literal "Files"
   list, which only names `AlertDetailView.test.tsx`). Required to produce
   deletion-check evidence for the loading and error/404 states, both of
   which live in the page, not in `AlertDetailView`. Precedent: Task 15 added
   `AlertList.test.tsx` beyond its brief's file list under the same kind of
   instruction. Unlike `app/devices/[id]/page.tsx` (untested directly because
   its loading/404 logic lives in the separately-tested `useDeviceDetail`
   hook), this page inlines `useAlertDetail` + a raw `useQuery` with no
   extracted hook, so the page itself needed the direct test.

2. **`AlertDetailView.test.tsx`'s RBAC mock replaced.** The brief's literal
   Step 1 code mocks `@/lib/auth/rbac-client` wholesale
   (`jest.mock('@/lib/auth/rbac-client', () => ({ useAdminAction: () => ({...}) }))`).
   Used instead: stub only `@clerk/nextjs`'s `useAuth` and let the real
   `useRbac`/`useAdminAction` chain run, matching `AlertList.test.tsx` and the
   explicit "This was a human ruling during Task 15's review" instruction.
   Also necessary practically: the brief's literal test doesn't mock
   `@/lib/query/hooks`, but `AlertDetailView` calls `useAcknowledgeAlert()`/
   `useResolveAlert()` directly (see point 3), and `useMutation()` throws
   without a `QueryClientProvider` in scope — so `@/lib/query/hooks` needed
   mocking regardless, following the same file's own precedent for mocking
   mutation hooks at their exact import specifier.

3. **`AlertDetailView` owns its mutations, not the page.** The brief calls it
   "presentational" and says it takes "already-loaded data as props," which
   could read as zero internal hooks. But its own prop signature has no
   `onAcknowledge`/`onResolve` callback, and Step 3 explicitly says "Acknowledge
   / Resolve buttons via `useAdminAction()`" as part of building this
   component — so I read "presentational" as "driven by props for its core
   *data* (alert, readings), self-contained for its own actions," exactly
   mirroring `AlertList.tsx` (also self-contained, also described loosely).
   This is a judgment call; if a future task wants a callback-prop variant
   (e.g., for a drawer with different mutation wiring), that would be a
   breaking prop-signature change to `AlertDetailView`.

4. **404 narrowed to a real 404, not "any post-load error."** The brief's
   literal Step 4 code: `if (!isLoading && !alert && error) notFound();` —
   treats a network failure or 500 identically to a genuine 404. Since
   `apiCall()` (`lib/api/v2-client.ts`) always throws `ApiClientError`
   (network errors included, wrapped as `statusCode: 500, code:
   'NETWORK_ERROR'`), narrowing to `error instanceof ApiClientError &&
   error.statusCode === 404` was straightforward and low-risk, and matches
   the precedent the interface notes point at (`useDeviceDetail` draws the
   same distinction for the devices page). Other errors get a retry banner
   instead of the app's 404 page. Covered by its own test and deletion check.

5. **`loading` prop scoped to bracketing readings, not the whole view.** The
   brief's props list includes `loading: boolean` alongside
   `bracketingReadings`, but its own Step 4 page code hardcodes
   `loading={false}` always (the page's `{alert && !isLoading && (...)}` guard
   means `AlertDetailView` is only ever rendered once the alert itself has
   loaded, so a page-wide "loading" flag passed into it would always be
   `false` and the prop would be dead code). I wired the page's real
   `readingsLoading` (from the bracketing-readings `useQuery`) into it
   instead, and gave the prop a concrete, testable meaning: gates the
   readings-table section specifically. Covered by its own test and deletion
   check.

## Uncertain / worth flagging

- **`forDurationSeconds` is not wired up end to end.** It's an accepted,
  tested prop on `AlertDetailView`, but the page never passes it — doing so
  would require fetching the firing `AlertRuleV2` by `rule_id` (the alert wire
  shape doesn't carry `for_duration_seconds`), which is a new data dependency
  outside this task's stated scope (no new endpoint; the brief's page code
  doesn't fetch the rule either). Left as an optional prop a future task can
  wire once it has the rule in hand.
- Point 3 above (mutations owned by the view, not the page) is the one
  judgment call in this report I'd most want a second opinion on if the
  reviewer disagrees with the "presentational" reading.
- Did not attempt a live browser/E2E walkthrough (Task 20 is explicitly
  "End-to-end coverage" as its own later task); verification here is unit
  tests + the four strict gates only.

---

## Fix round 1 (review response)

Commit: `27022f4` — `fix(alerting): pin bracketing-readings query to limit/asc-sort`

Review came back spec ✅, 0 Critical, 1 Important, 3 Minor deferred (not
touched — see "Deferred items" below). All three judgment calls from the
original report were independently endorsed (mutations-in-the-view precedent
checked against `DeviceDetailView` directly; 404 narrowing confirmed to
mirror `useDeviceDetail`; the "42"/"Resolved" text-collision reasoning
re-derived from `getNodeText` semantics). The 404-contract question the
reviewer flagged as unverifiable-from-diff was independently resolved by the
coordinator (`route.ts:73` throws `ALERT_NOT_FOUND` at 404;
`alerts.integration.test.ts:455-465` asserts both) — no action needed on my
end.

### The Important finding

**Bracketing-readings fetch was under-specified and untested — `page.tsx:34-58`.**

Two real problems, exactly as described:

1. `v2Api.readings.list({ device_id, startDate, endDate })` omitted `limit`
   and sort. `paginationSchema` defaults `limit` to 20;
   `app/api/v2/readings/route.ts:104-105` defaults to `sortBy: 'timestamp'`,
   `sortDirection` unset → descending. A ±15-minute window therefore silently
   capped at the 20 newest readings, discarding the early part of the window
   — the part that shows a breach developing — on any device reporting
   faster than ~90s. No error; a plausible-looking partial table.
2. Nothing exercised the query's actual parameters. The old
   `AlertDetailPage.test.tsx` mocked `@tanstack/react-query`'s `useQuery`
   wholesale (`() => ({ data: [], isLoading: false })`), so the real
   `queryFn` — and therefore the missing `limit`/sort — never ran under test.
   `AlertDetailView.test.tsx` only ever received `bracketingReadings` as a
   prop, never through the page.

### A landmine found while fixing it

Writing `v2Api.readings.list({ ..., sortBy: 'timestamp', sortDirection: 'asc' })`
does not compile against the current `ListReadingsQuery`. I re-verified the
param names as instructed rather than trusting my Task 16 pass, and this time
found a real discrepancy: `types/v2/reading.types.ts`'s hand-written
`ListReadingsQuery` (the type `v2Api.readings.list()` is actually declared
against — confirmed via `types/v2/index.ts`'s re-export, not the
Zod-inferred type from `lib/validations/v2/reading.validation.ts`) only has a
vestigial `sort?: string` field ("timestamp:desc" style). The real route
(`app/api/v2/readings/route.ts:104-105`) reads `query.sortBy`/
`query.sortDirection` as separate fields — matching `listReadingsQuerySchema`'s
`createSortSchema(readingSortFields)` — and never reads `sort` at all. I
confirmed by grep that no caller in the codebase sets `.sort` on a readings
query, and that the sibling types `ListDevicesQuery`
(`types/v2/device.types.ts:333,335`) and `ListSchedulesQuery`
(`types/v2/schedule.types.ts:122,124`) already use the `sortBy`/
`sortDirection` shape — `ListReadingsQuery` was simply never updated to
match.

Fixed the type rather than working around it with a cast: added
`sortBy?: 'timestamp' | 'value' | 'anomaly_score' | 'confidence_score'` (the
literal union matches `readingSortFields`, tighter than `ListDevicesQuery`'s
bare `string` but consistent with `ListSchedulesQuery`'s stricter style) and
`sortDirection?: 'asc' | 'desc'`, both purely additive and optional — cannot
break any existing caller. Left the vestigial `sort` field in place rather
than removing it, to keep this fix narrowly scoped to the Important finding;
noted in its docstring that it's dead and why.

### The fix

`app/alerts/[id]/page.tsx`: both the `queryFn`'s call to
`v2Api.readings.list` and the `queryKey` now include
`limit: 100, sortBy: 'timestamp', sortDirection: 'asc'`. `limit: 100` is the
endpoint's maximum (comfortably covers a 30-minute window at any realistic
cadence); ascending puts the bracketing table in chronological order
(breach developing downward), which is what a forensic timeline wants.

### Test restructuring

`AlertDetailPage.test.tsx` no longer mocks `@tanstack/react-query` at all —
that mock is exactly what hid the bug, per the review. Replaced with:

- A real `QueryClient`/`QueryClientProvider` per test (`renderPage()` helper),
  `retry: false` so a mocked rejection would settle immediately rather than
  retrying into a timeout.
- `@/lib/api/v2-client` mocked surgically — `jest.requireActual(...)` spread,
  only `v2Api.readings.list` overridden — so the real `ApiClientError` class
  (already used to build 404/500 fixtures for the other tests) stays intact
  and every other `v2Api` namespace stays real (nothing else touches them
  from this render tree, but there was no reason to strip them).
- `@/lib/query/hooks`'s `useAlertDetail` stays mocked, as before — this file
  is still scoped to the page's own orchestration, not `useAlertDetail`'s
  internals.
- Three new tests under `describe('bracketing readings query')`:
  1. Asserts the *exact* object passed to `v2Api.readings.list` for a known
     `fired_at` — `device_id`, `startDate`/`endDate` centred ±15m, `limit: 100`,
     `sortBy: 'timestamp'`, `sortDirection: 'asc'`.
  2. Asserts the window centres on `breached_since` when `fired_at` is absent
     (via `expect.objectContaining`, scoped to just the two dates — the
     limit/sort assertion already lives in test 1).
  3. Asserts no fetch happens before the alert (and its `device_id`) has
     loaded.

All 5 pre-existing tests in the file needed no behavioral changes, only
`render(<AlertDetailPage />)` → `renderPage()`; re-ran them and confirmed all
5 still green under the new setup.

### TDD / deletion-check evidence for this fix

**Red against the original (pre-fix) code**, before restoring the fix,
confirming the new test actually catches the shipped bug:

```
✕ should request an explicit limit and ascending sort, windowed +/-15m on fired_at (10 ms)
  expect(jest.fn()).toHaveBeenCalledWith(...expected)
  - Expected
  + Received
    Object {
      "device_id": "device_001",
      "endDate": "2026-08-01T12:20:00.000Z",
  -   "limit": 100,
  -   "sortBy": "timestamp",
  -   "sortDirection": "asc",
      "startDate": "2026-08-01T11:50:00.000Z",
    },
```

**Red with only `limit` dropped** (the reviewer's specifically requested
check, fix otherwise in place):

```
✕ should request an explicit limit and ascending sort, windowed +/-15m on fired_at (8 ms)
    Object {
      "device_id": "device_001",
      "endDate": "2026-08-01T12:20:00.000Z",
  -   "limit": 100,
      "sortBy": "timestamp",
      "sortDirection": "asc",
      "startDate": "2026-08-01T11:50:00.000Z",
    },
```

**Red with `sortDirection` flipped to `'desc'`** (proving the test pins the
*value*, not just presence of the key):

```
✕ should request an explicit limit and ascending sort, windowed +/-15m on fired_at (11 ms)
      "limit": 100,
      "sortBy": "timestamp",
  -   "sortDirection": "asc",
  +   "sortDirection": "desc",
      "startDate": "2026-08-01T11:50:00.000Z",
```

**Red with the `fired_at ?? breached_since` fallback removed** (proving the
fallback test is load-bearing, not just window math copied from test 1):

```
✕ should fall back to breached_since when fired_at is absent (...) (1008 ms)
  expect(jest.fn()).toHaveBeenCalledTimes(expected)
  Expected number of calls: 1
  Received number of calls: 0
```

(1008ms — `waitFor`'s default ~1s timeout expiring because the query never
fired at all once `range` collapsed to `null`, which is itself confirmation
the fallback is what enables the fetch.)

All four mutations reverted after each red confirmation; full file re-run
green after every revert, not just at the end.

**Final passing run** (full file, fix in place):

```
PASS jsdom __tests__/unit/components/AlertDetailPage.test.tsx
  AlertDetailPage
    ✓ should show a loading spinner while the alert is loading, and not render the view or 404 (32 ms)
    ✓ should render the styled not-found state for an alert id that does not resolve (404) (6 ms)
    ✓ should show a retry banner (not the 404 page) for a non-404 error (10 ms)
    ✓ should render AlertDetailView once the alert loads, and not call notFound (8 ms)
    ✓ should pass retry: false to useAlertDetail so a 404 does not spin through retries first (6 ms)
    bracketing readings query
      ✓ should request an explicit limit and ascending sort, windowed +/-15m on fired_at (8 ms)
      ✓ should fall back to breached_since when fired_at is absent (pending episodes are never visible, but defend anyway) (16 ms)
      ✓ should not request readings before the alert (and its device_id) has loaded (4 ms)

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

### Gate output (fix round)

```
npx tsc --noEmit    -> 0 errors (no output, exit 0)
pnpm lint            -> 0 problems (exit 0)
pnpm test             -> Test Suites: 109 passed, 109 total
                         Tests:       2552 passed, 2552 total
                         (was 2549/109 entering this fix round; +3 new tests,
                         same 2 suites — no regressions)
pnpm build            -> clean; /alerts/[id] still ƒ (dynamic), exit 0
```

### Deferred items (per the coordinator's instruction — NOT fixed)

1. `components/alerts/AlertList.tsx:75`'s "Shared with AlertDetailView
   (Task 16)" comment on `formatRelativeTime` is now stale —
   `AlertDetailView.tsx` uses absolute timestamps (`formatTimestamp`, its own
   local helper) and never imports `formatRelativeTime`. The absolute-time
   choice itself was confirmed fine; only the comment is wrong.
2. This report's "### Admin-gating state (component) — four checks" header
   (line 226) is wrong: the section body only contains two checks, (a)
   visibility gate and (b) disabled gate. Left as originally written per
   instruction — not correcting it here.
3. Loading spinners (`.animate-spin` divs, including the ones this task
   added) have no `role="status"`. Pre-existing convention across the app
   (`DeviceDetailPage`, `AlertList`, etc. all use the same bare div), not a
   regression introduced here.

### Anything I'm still unsure about

None new. The `sort`-field discovery reinforced rather than changed my
existing uncertainty about point 3 in the original report (mutations owned
by `AlertDetailView`) — no bearing on this fix.
