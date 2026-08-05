# Task 14 Report: Client subscription and toasts

Branch: `feat/phase-4-alerting`
Worktree: `/home/yzel/github/infrasight-phase4`

Status: **DONE**

## Summary

Implemented all steps (0 through 8, including 5b) from `task-14-brief.md` in
order. Step 0 gave the `storm` envelope a direction (`of: 'fired' |
'resolved'`) and gave the two silent nested broadcast catches in
`lib/alerting/index.ts` a voice (log + Sentry report). Steps 1–4 added
`usePusherAlerts` to `lib/pusher-context.tsx`, copying `usePusherReadings`'s
exact ref/effect shape (including the `[callback]` dependency array) onto a
second callback set bound to a second event (`alert-event`) on the same
`InfraSight` subscription — no new Pusher subscription created. Steps 5/5b
added `components/alerts/AlertToaster.tsx` (toasts only on `fired`; `resolved`
reconciles the React Query cache silently) with a dedicated branching test
that includes both negative cases the brief calls out by name (resolved batch,
resolved storm) plus positive-case deletion checks. Step 6 mounted
`<AlertToaster />` in `app/layout.tsx`, next to the pre-existing
`<ToastContainer />` — **it was already mounted; I did not need to add it**.

All four gates are green on the final committed state: `tsc --noEmit` 0
errors, `pnpm lint` 0 problems, `pnpm build` clean, `pnpm test` 2480/2480
passing across 104 suites — up from the 2468/102 entry baseline by exactly
the 12 tests / 2 suites this task added, zero regressions.

One real conflict surfaced between two parts of the brief itself: Step 1's
verbatim test code constructs a bare `{ kind: 'storm', count, by_severity,
since }` object typed as `AlertEvent`, which no longer type-checks once Step
0 makes `of` required on that variant. Fixed by adding `of: 'fired'` to that
one object literal (see "Judgment calls" below — this is the only deviation
from the brief's literal code).

Committed as two conventional commits (Step 8), with one deliberate extension
to the literal `git add` file lists in Step 8's code block — see "Judgment
calls" below.

## Step-by-step

### Step 0 — Storm direction + broadcast-catch observability

**(1) Wire type.** `types/v2/alert.types.ts`: added
`of: 'fired' | 'resolved'` to `AlertEvent`'s `storm` variant, with the exact
doc comment from the brief. Also updated the file's top-of-file comment,
which previously said "Nothing imports from this file yet" — no longer true
once `lib/pusher-context.tsx` imports `AlertEvent` in Step 3, so I corrected
it to describe the real consumer. Verified zero imports still holds:
`grep -n "^import" types/v2/alert.types.ts` matches nothing (exit 1).

**(2) `notify.ts`.** `stormEnvelope(alerts, of)` now takes the direction as a
parameter and stamps it on the returned envelope; `bound()` threads a third
`of` parameter through to both of its `stormEnvelope(...)` call sites;
`buildFiredEnvelope` passes `'fired'`, `buildResolvedEnvelope` passes
`'resolved'`.

**(3) `lib/alerting/index.ts`.** Both nested `catch {}` blocks (one in
`safeEvaluateReadings`, one in `safeSweepStaleAlerts`, both wrapping
`publishAlertEvents(...)`) now bind the error, call `logger.error('Alert
broadcast failed after a committed write', { error: ... })`, and call the
module's existing `reportToSentry(error)` — verbatim per the brief's code
block. Still does not rethrow.

**Tests.** Extended `__tests__/unit/lib/alerting/notify.test.ts`'s three
storm-producing assertions (`should degrade to a storm above
ALERT_EVENT_MAX`, `should degrade to a storm when the measured body exceeds
the byte cap`, and `buildResolvedEnvelope`'s `should apply the same bounds`)
to assert `of: 'fired'` / `of: 'resolved'` respectively — covering both the
count-triggered and byte-triggered storm paths, and both directions.

Extended the two existing "isolation" tests in
`__tests__/unit/lib/alerting/sweep.test.ts` (`should return the real
evaluation result, not the empty fallback, when publishAlertEvents throws`
and its sweep equivalent) — these are the exact tests the brief means by
"the existing isolation tests only assert that the result survives, which
passes just as well against an empty catch." Added `errorSpy`/`captureSpy`
and assertions that `logger.error` was called with the documented message
and that `reportToSentry` reached `captureException` with the same
`{ subsystem: 'alerting' }` tag shape used elsewhere in the file.

### Steps 1–4 — `usePusherAlerts`

Created `__tests__/unit/lib/pusher-alerts.test.tsx` verbatim from the brief
(Step 1), ran it to confirm red (Step 2: `usePusherAlerts is not a
function`), then extended `lib/pusher-context.tsx` (Step 3):

- `AlertsCallback` type, exported.
- `PusherContextValue` gains `subscribeAlerts` / `unsubscribeAlerts`.
- `PusherProvider` gains `alertCallbacksRef` (a second `Set`), binds
  `channel.bind('alert-event', alertHandler)` on the *same* channel
  subscription alongside the existing `new-readings` bind, and unbinds both
  in the same cleanup function before the single `pusher.unsubscribe(...)`.
- `usePusherAlerts` copies `usePusherReadings`'s exact shape verbatim,
  including the ref-refresh effect's `[callback]` dependency array
  (`lib/pusher-context.tsx:171-175`) — did **not** touch
  `usePusherReadings` itself, per the explicit instruction not to.

Ran the test again (Step 4): 6/6 passing, in the `jsdom` project (confirms
the `.tsx` extension routed it correctly per `jest.config.js`'s two
projects).

### Step 5 — `AlertToaster`

Created `components/alerts/AlertToaster.tsx` verbatim from the brief's code
block: a `TOAST_TYPE` map from `AlertSeverity` to toast function name, a
`handleEvent` `useCallback` that switches on `event.kind`, and
`usePusherAlerts(handleEvent)`. `fired` toasts once per alert (mapped by
severity) then invalidates; `resolved` invalidates only; `storm` invalidates
always and toasts only `if (event.of === 'fired')`.

### Step 5b — Branching tests + deletion checks

Created `__tests__/unit/components/AlertToaster.test.tsx`, mocking
`next/navigation` (`useRouter`), `react-toastify` (`toast.{error,warning,
info}`), and `@/lib/pusher-context` (`usePusherAlerts`) so the test can
capture the `handleEvent` callback `usePusherAlerts` was called with and
invoke it directly with a hand-built `AlertEvent`. Rendered under a real
`QueryClient`/`QueryClientProvider` (matching this repo's existing
`useAlerts.test.tsx` convention for hook tests that need `useQueryClient()`
to resolve) and spied on `queryClient.invalidateQueries`.

Six tests, covering the brief's table exactly plus two structural checks:
renders nothing; registers exactly one handler; fired batch → `toast.error`
×1 + `toast.info` ×1 (severity-mapped) + invalidate; **resolved batch → no
toast at all, invalidate still fires**; fired storm → one `toast.error`
mentioning `312` + invalidate; **resolved storm → no toast at all, invalidate
still fires**. The two bolded rows are the brief's required negatives.

### Step 6 — Mount

`app/layout.tsx`: imported `AlertToaster` from `@/components/alerts/AlertToaster`
and rendered `<AlertToaster />` immediately after the existing
`<ToastContainer />`, both inside `<PusherProvider>` (needed for
`usePusherAlerts`) and inside `<QueryClientProvider>` (needed for
`useQueryClient`). **`<ToastContainer />` was already mounted** at
`app/layout.tsx:54-60` before this task touched the file — I did not add it.
This means the app's existing `toast.*` call sites (in `FloorPlan.tsx`,
`ScheduleList.tsx`, `ScheduleServiceModal.tsx`, `GenerateReportModal.tsx`,
`CreateDeviceModal.tsx`, `devices/page.tsx`, `devices/deleted/page.tsx`) have
in fact had somewhere to render all along.

### Step 7 — Build verification

`npx tsc --noEmit` initially failed — see "A brief self-conflict" below for
the one real type error found and fixed. After that fix: `tsc --noEmit` 0
errors, `pnpm lint` 0 problems, `pnpm build` clean (exit 0, all 30 routes
generated, no mongoose-in-client-component error). Full output under "Gate
output" below.

### Step 8 — Commit

Two conventional commits; see "Commits" below. One deliberate extension to
the brief's literal `git add` file lists — see "Judgment calls."

## A brief self-conflict, found and fixed

Step 1's test code (given verbatim) contains:

```typescript
const envelope: AlertEvent = {
  kind: 'storm',
  count: 312,
  by_severity: { info: 0, warning: 12, critical: 300 },
  since: '2026-08-01T12:00:00.000Z',
};
```

Once Step 0 makes `of` required on the `storm` variant, this object literal
no longer satisfies `AlertEvent`. `ts-jest` runs with `isolatedModules: true`
(no cross-file type checking), so `pnpm test` passed this file both before
and after Step 0's type change — the break only surfaces under `npx tsc
--noEmit`, which is exactly the STRICT, zero-tolerance gate this task is
bound by:

```
__tests__/unit/lib/pusher-alerts.test.tsx(75,11): error TS2322: Type '{ kind: "storm"; count: number; ... }' is not assignable to type 'AlertEvent'.
  Property 'of' is missing in type '...' but required in type '{ kind: "storm"; of: "resolved" | "fired"; ... }'.
```

Fixed by adding `of: 'fired'` to that one literal. This test only asserts
that `usePusherAlerts` forwards whatever envelope Pusher delivers, unexamined
— the hook has no branching on `kind`/`of` — so the direction chosen is
inert to the test's intent; `'fired'` was picked arbitrarily. This is the
only place I departed from the brief's given code text, and it was forced by
the two Step 0/Step 1 code blocks being mutually inconsistent once both are
applied — not a discretionary rewrite.

## TDD evidence

### Step 0a — storm `of` (notify.test.ts) — RED then GREEN

Extended the test assertions first, before touching `notify.ts` production
code:

```
$ pnpm test __tests__/unit/lib/alerting/notify.test.ts
  ● buildFiredEnvelope › should degrade to a storm above ALERT_EVENT_MAX
    - Expected  - 1
    + Received  + 0
    @@ ... @@
        "count": 25,
        "kind": "storm",
    -   "of": "fired",
      }
  ● buildFiredEnvelope › should degrade to a storm when the measured body exceeds the byte cap
    -   "of": "fired",
  ● buildResolvedEnvelope › should apply the same bounds
    -   "of": "resolved",
Tests:       3 failed, 7 passed, 10 total
```

Implemented the `notify.ts` change, reran:

```
PASS node __tests__/unit/lib/alerting/notify.test.ts
  buildFiredEnvelope
    ✓ should return null for an empty list
    ✓ should tag a small batch as fired
    ✓ should carry exactly ALERT_EVENT_MAX alerts without degrading
    ✓ should degrade to a storm above ALERT_EVENT_MAX
    ✓ should set storm.since to the earliest fired_at
    ✓ should degrade to a storm when the measured body exceeds the byte cap
  buildResolvedEnvelope
    ✓ should apply the same bounds
  publishAlertEvents
    ✓ should send both envelopes on the single alert-event name
    ✓ should send nothing when both lists are empty
    ✓ should swallow a Pusher failure
Tests:       10 passed, 10 total
```

### Step 0b — broadcast-catch observability (sweep.test.ts) — RED then GREEN

Extended the two existing isolation tests first, before touching
`lib/alerting/index.ts`:

```
$ pnpm test __tests__/unit/lib/alerting/sweep.test.ts -t "publishAlertEvents throws"
  ● safe wrappers › should return the real evaluation result, not the empty fallback, when publishAlertEvents throws
    expect(jest.fn()).toHaveBeenCalledWith(...expected)
    Expected: "Alert broadcast failed after a committed write", ObjectContaining {"error": "pusher exploded"}
    Number of calls: 0
  ● safe wrappers › should return the real sweep result, not the empty fallback, when publishAlertEvents throws
    Expected: "Alert broadcast failed after a committed write", ObjectContaining {"error": "pusher exploded"}
    Number of calls: 0
Tests:       2 failed, 18 skipped, 20 total
```

Confirmed the failure was for the right reason (empty `catch {}` calls
neither `logger.error` nor `captureException`, so the spies saw zero calls —
not a wrong-message mismatch). Implemented the `lib/alerting/index.ts` fix,
reran the full file:

```
PASS node __tests__/unit/lib/alerting/sweep.test.ts
Test Suites: 5 passed  [full alerting dir]
Tests:       105 passed, 105 total
```

### Steps 1–2 (`usePusherAlerts`) — RED

```
$ pnpm test __tests__/unit/lib/pusher-alerts.test.tsx
  ● usePusherAlerts › should bind the alert-event name
    TypeError: (0 , pusher_context_1.usePusherAlerts) is not a function
  ... (all 6 tests fail the same way)
Test Suites: 1 failed, 1 total
Tests:       6 failed, 6 total
```

### Steps 3–4 (`usePusherAlerts`) — GREEN

```
PASS jsdom __tests__/unit/lib/pusher-alerts.test.tsx
  usePusherAlerts
    ✓ should bind the alert-event name (12 ms)
    ✓ should deliver a fired envelope to subscribers (3 ms)
    ✓ should deliver a storm envelope (3 ms)
    ✓ should not break the readings subscription (3 ms)
    ✓ should unbind both events on unmount (5 ms)
    ✓ should stop delivering after a subscriber unmounts (3 ms)
Tests:       6 passed, 6 total
```

(This run is after the `of: 'fired'` self-conflict fix above; the test's own
logic was green from the first implementation, the type error only affects
`tsc`, not `jest`.)

### Step 5b (`AlertToaster`) — GREEN on first run

Since Step 5 (implementation) precedes Step 5b (test) in the brief's own
step order, there is no "RED before the component exists" cycle here the way
there is for `usePusherAlerts`. The brief substitutes deletion-check rigor
instead — see below.

```
PASS jsdom __tests__/unit/components/AlertToaster.test.tsx
  AlertToaster
    ✓ renders nothing (12 ms)
    ✓ registers exactly one alert-event handler via usePusherAlerts (3 ms)
    ✓ toasts once per fired alert, mapped by severity, and invalidates the alerts cache (4 ms)
    ✓ does NOT toast for a resolved batch, but still invalidates the alerts cache (5 ms)
    ✓ toasts once for a FIRED storm, mentioning the count, and invalidates (3 ms)
    ✓ does NOT toast for a RESOLVED storm, but still invalidates (2 ms)
Tests:       6 passed, 6 total
```

## Deletion-check evidence (Step 5b's two negative cases)

This is the failure mode the brief specifically warns this project keeps
hitting: a suite that only asserts the positive (toast-raising) cases passes
just as happily against a component that toasts unconditionally. Both
negatives were verified by actually deleting the guarded behavior in
`components/alerts/AlertToaster.tsx`, confirming red, then reverting.

**Mutation 1 — deleted the `of === 'fired'` guard** (storm case always
toasts):

```diff
-          if (event.of === 'fired')
-            toast.error(`${event.count} alerts firing`, {
-              onClick: () => router.push('/alerts'),
-            });
+          toast.error(`${event.count} alerts firing`, {
+            onClick: () => router.push('/alerts'),
+          });
```

```
$ pnpm test __tests__/unit/components/AlertToaster.test.tsx
FAIL jsdom __tests__/unit/components/AlertToaster.test.tsx
    ✓ renders nothing
    ✓ registers exactly one alert-event handler via usePusherAlerts
    ✓ toasts once per fired alert, mapped by severity, and invalidates the alerts cache
    ✓ does NOT toast for a resolved batch, but still invalidates the alerts cache
    ✓ toasts once for a FIRED storm, mentioning the count, and invalidates
    ✕ does NOT toast for a RESOLVED storm, but still invalidates

  ● AlertToaster › does NOT toast for a RESOLVED storm, but still invalidates
    expect(jest.fn()).not.toHaveBeenCalled()
    Expected number of calls: 0
    Received number of calls: 1
    1: "312 alerts firing", {"onClick": [Function onClick]}

Tests:       1 failed, 5 passed, 6 total
```

Exactly the intended test failed, for exactly the intended reason (the
resolved-storm case now raises the same "N alerts firing" toast), and only
that one — the other five, including the fired-storm positive case, stayed
green, confirming they don't accidentally cover this branch. Reverted.

**Mutation 2 — deleted the resolved-batch silent path** (made it also toast,
one per alert):

```diff
         case 'resolved':
-          // No toast: reconcile silently.
+          for (const alert of event.alerts) toast.info(`${alert.device_id} resolved`);
           queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
           break;
```

```
$ pnpm test __tests__/unit/components/AlertToaster.test.tsx
FAIL jsdom __tests__/unit/components/AlertToaster.test.tsx
    ✓ renders nothing
    ✓ registers exactly one alert-event handler via usePusherAlerts
    ✓ toasts once per fired alert, mapped by severity, and invalidates the alerts cache
    ✕ does NOT toast for a resolved batch, but still invalidates the alerts cache
    ✓ toasts once for a FIRED storm, mentioning the count, and invalidates
    ✓ does NOT toast for a RESOLVED storm, but still invalidates

  ● AlertToaster › does NOT toast for a resolved batch, but still invalidates the alerts cache
    expect(jest.fn()).not.toHaveBeenCalled()
    Expected number of calls: 0
    Received number of calls: 2
    1: "device_001 resolved"
    2: "device_001 resolved"

Tests:       1 failed, 5 passed, 6 total
```

Again, exactly the intended test failed, isolated cleanly from the other
five. Reverted to the brief's exact Step 5 code (confirmed via `git diff` /
`Read` showing the restored file byte-for-byte matches what Step 5 wrote),
reconfirmed 6/6 green (shown above under Step 5b GREEN).

## Gate output (exact)

### `npx tsc --noEmit`

```
$ npx tsc --noEmit; echo "EXIT CODE: $?"
EXIT CODE: 0
```
No output, 0 errors. (This is the post-fix run; see "A brief self-conflict"
above for the one error found and fixed before this.)

### `pnpm lint`

```
$ pnpm lint; echo "EXIT CODE: $?"
$ eslint
EXIT CODE: 0
```
No output, 0 problems.

### `pnpm test` (full suite)

```
Test Suites: 104 passed, 104 total
Tests:       2480 passed, 2480 total
Snapshots:   0 total
Time:        39.571 s
```
Entry baseline (per this task's global constraints) was 2468 tests / 102
suites. Delta: +12 tests / +2 suites — exactly `pusher-alerts.test.tsx` (6
tests, 1 suite) + `AlertToaster.test.tsx` (6 tests, 1 suite). No `FAIL` lines
in the run.

### `pnpm build`

```
$ pnpm build; echo "EXIT CODE: $?"
   ▲ Next.js 16.0.10 (Turbopack)
   Creating an optimized production build ...
 ✓ Compiled successfully in 3.6s
   Running next.config.js provided runAfterProductionCompile ...
 ✓ Completed runAfterProductionCompile in 270ms
   Running TypeScript ...
   Collecting page data using 23 workers ...
   Generating static pages using 23 workers (30/30) ...
 ✓ Generating static pages using 23 workers (30/30) in 1101.2ms
   Finalizing page optimization ...
[... 30 routes listed, including all existing /api/v2/* routes ...]
EXIT CODE: 0
```
Clean. No mongoose-in-client-component error, confirming
`types/v2/alert.types.ts` picked up no server-only import.

All four gates were run fresh, in this order (tsc, lint, full test, build),
against the final working-tree state before either commit, and the full test
suite was re-run once more (implicitly unchanged, since committing doesn't
alter file content) to produce the numbers quoted above.

## Commits

```
9b759d2 feat(alerting): subscribe to alert events and toast on fire
b3b93e2 feat(alerting): tag storm envelopes with their direction
```

Commit `b3b93e2` — `types/v2/alert.types.ts`, `lib/alerting/notify.ts`,
`lib/alerting/index.ts`, `__tests__/unit/lib/alerting/notify.test.ts`,
`__tests__/unit/lib/alerting/sweep.test.ts` (5 files, +71/-21). All three
Step 0 concerns plus their tests.

Commit `9b759d2` — `lib/pusher-context.tsx`,
`components/alerts/AlertToaster.tsx` (new),
`__tests__/unit/lib/pusher-alerts.test.tsx` (new),
`__tests__/unit/components/AlertToaster.test.tsx` (new), `app/layout.tsx` (5
files, +481/-5).

Both authored on branch `feat/phase-4-alerting` in
`/home/yzel/github/infrasight-phase4`. `git status` clean post-commit (`git
add` by explicit file list, never `-A`/`.`, for both commits). Did not touch
`/home/yzel/github/infrasight` or `/home/yzel/github/infrasight-docs`.

## Judgment calls / things I was unsure about

1. **Extended Step 8's literal `git add` lists to include
   `lib/alerting/index.ts` and `__tests__/unit/lib/alerting/sweep.test.ts` in
   the first commit.** Step 8's code block only lists
   `types/v2/alert.types.ts lib/alerting/notify.ts
   __tests__/unit/lib/alerting/notify.test.ts` for commit 1 — omitting
   `index.ts` and its test entirely from *either* commit, which would leave
   Step 0's second concern (the broadcast-catch observability fix) either
   uncommitted or force it into commit 2's alert-UI commit, where it doesn't
   belong thematically. The brief's own "Ambiguity I am resolving for you up
   front" section is explicit that this file is one of Step 0's three
   concerns and that "All three ... belong in the first commit." I followed
   that explicit instruction over the (apparently incomplete) literal `git
   add` list, on the reasoning that the ambiguity-resolution section exists
   specifically to override gaps like this one. Flagging this clearly in
   case the intent was actually different — the diff is easy to reshuffle
   between the two commits if so.
2. **The `of: 'fired'` fix to the brief's own Step 1 test code** — covered
   above under "A brief self-conflict." Necessary for the STRICT `tsc
   --noEmit` gate; the alternative (leaving the type error in) was not
   viable under this task's constraints.
3. **`AlertToaster.test.tsx`'s mocking/rendering conventions were not
   specified beyond "mock react-toastify, next/navigation, and
   usePusherAlerts."** I additionally wrapped the render in a real
   `QueryClient`/`QueryClientProvider` and spied on `invalidateQueries`
   (rather than mocking `@tanstack/react-query` outright), matching this
   repo's existing convention in `__tests__/unit/lib/useAlerts.test.tsx` for
   tests that need a working `useQueryClient()`. No existing component test
   in this repo does this (`useAlerts.test.tsx` tests hooks directly, not a
   component), so this is a new but small precedent, not a deviation from an
   established one.
4. **Did not add extra assertions on `router.push`'s onClick wiring beyond
   `expect.objectContaining({ onClick: expect.any(Function) })`.** The
   brief's Step 5b table doesn't ask for navigation-on-click coverage, and
   `router.push` is exercised by `TopNav`/other existing navigation tests
   elsewhere in the repo; adding it here would be testing implementation
   detail beyond the component's stated job (deciding which events toast).
5. **Did not modify `usePusherReadings`** — confirmed it already has the
   `[callback]`-array shape described in the brief and left it untouched, as
   instructed.

No other ambiguities encountered. All eight steps (0 through 8, including
5b) were completed as specified, with the two departures above both
necessary and disclosed.
