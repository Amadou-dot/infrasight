# Task 13 Report: Bounded Pusher delivery

Branch: `feat/phase-4-alerting`
Worktree: `/home/yzel/github/infrasight-phase4`

Status: **DONE**

## Summary

Implemented all 8 steps from `task-13-brief.md` in order: created
`lib/alerting/notify.ts` (bounded envelope builders + `publishAlertEvents`),
wired it into both `safe*` wrappers in `lib/alerting/index.ts`, broadcast
manual resolutions from `PATCH /api/v2/alerts/[id]`, and fixed the cron
route's Pusher trigger to broadcast only readings that actually persisted.
Committed as two conventional commits (Step 8). All four gates are green on
the final committed state: `tsc --noEmit` 0 errors, `pnpm lint` 0 problems,
`pnpm test` 2466/2466 passing (102 suites) — up from the 2454/101 entry
baseline by exactly the 12 tests / 1 suite this task added, zero
regressions. `pnpm build` was not run, per this task's explicit global
constraint (pre-existing Clerk-key gap in this worktree's `.env.local`, not
this task's problem).

Because the ingest write path (`app/api/v2/readings/ingest/route.ts`) already
calls `safeEvaluateReadings` from Task 9, it picked up broadcasting for free
from the Step 4 change — no edit to that route was needed or made.

## Step-by-step

### Steps 1–3 — The notifier

Created `__tests__/unit/lib/alerting/notify.test.ts` and
`lib/alerting/notify.ts` verbatim from the brief's code blocks:
`ALERT_CHANNEL = 'InfraSight'`, `ALERT_EVENT_NAME = 'alert-event'`,
`ALERT_EVENT_MAX = 20`, `ALERT_EVENT_MAX_BYTES = 8192`,
`buildFiredEnvelope`/`buildResolvedEnvelope` (both bound on count first, then
measured JSON byte size, degrading to a `{ kind: 'storm', count, by_severity,
since }` envelope), and `publishAlertEvents(fired, resolved)` which triggers
each non-null envelope on `ALERT_CHANNEL`/`ALERT_EVENT_NAME`, swallowing and
logging any Pusher failure per-envelope.

### Step 4 — Wire into the safe wrappers

`lib/alerting/index.ts`: imported `publishAlertEvents` from `./notify`,
added the re-export line (`ALERT_EVENT_NAME`, `ALERT_EVENT_MAX`,
`ALERT_EVENT_MAX_BYTES`, `publishAlertEvents`), and inside each `try`:

- `safeEvaluateReadings`: `const result = await evaluateReadings(...); await
  publishAlertEvents(result.fired, result.resolved); return result;`
- `safeSweepStaleAlerts`: `const result = await sweepStaleAlerts(...); await
  publishAlertEvents([], result.resolved); return result;`

Both calls sit inside the existing try/catch, so a broadcast failure is
isolated exactly like an evaluation failure — it never drops the DB result
already computed, and never propagates past the safe wrapper.

### Step 5 — Broadcast manual resolutions

`app/api/v2/alerts/[id]/route.ts`: imported `publishAlertEvents` from
`@/lib/alerting` (the barrel, not `@/lib/alerting/notify` directly — this
matters, see the spy hazard below). Added a second `if (status ===
'resolved')` statement (kept as a separate single-statement `if`, matching
both the brief's literal code and this codebase's `curly: ['error',
'multi']` ESLint rule) that calls `publishAlertEvents([], [{ ...,
resolution: 'manual', resolved_at: new Date().toISOString(), actor: userId
}])`. `actor` is `userId` (the Clerk user id from `requireAdmin()`), never
`auditUser`/`getAuditUser(...)`, per the brief's explicit resolution of that
ambiguity and the doc comment at `types/v2/alert.types.ts:275-288`.
Acknowledgement is untouched — no broadcast added for it.

Added the exact test from the brief to
`__tests__/integration/api/alerts.integration.test.ts`
(`import * as alerting from '@/lib/alerting'`, spy on
`alerting.publishAlertEvents`, assert `resolvedArg[0].actor ===
'user_test_admin'` and does not contain `'@'`).

### Step 6 — Stop broadcasting readings that never persisted

`app/api/v2/cron/simulate/route.ts`: changed the Pusher trigger's third
argument from `newReadings` to
`insertedReadings.map(r => r.toObject({ versionKey: false }))`, and the
catch block's `readingsCount` from `newReadings.length` to
`insertedReadings.length`. Updated the surrounding comment to explain why
(rejected readings must never appear on a client tile as though stored).

Added a new test, `broadcasts only the readings that persisted, not every
reading generated`, to the `partial insert handling` describe block in
`__tests__/integration/api/simulate-cron.integration.test.ts`, reusing that
block's existing `jest.spyOn(ReadingV2, 'bulkInsertReadings')`
partial-insert stand-in pattern (3 candidate readings in, 2 "persisted"),
with one addition: each survivor is given a `toObject()` method so the
route's `r.toObject({ versionKey: false })` call behaves the way it would
against real Mongoose documents from `insertMany` (a real `insertMany`
without `{ lean: true }` returns hydrated documents; a plain object stand-in
would make `.toObject` throw, which the route's try/catch would silently
swallow — see "Things I was unsure about" for why this matters). The
assertion reads `pusherServer.trigger`'s **actual** captured call args (the
module-level `jest.mock('@/lib/pusher', ...)` already in this file), filtered
to the `'new-readings'` event, and checks its payload has length 2
(`insertedReadings.length`), not 3 (`newReadings.length`) — driven through
`bulkInsertReadings`, not through stubbing the trigger's argument directly.

## TDD evidence

### Steps 1–2 (notify.ts) — RED

```
$ pnpm test __tests__/unit/lib/alerting/notify.test.ts
FAIL node __tests__/unit/lib/alerting/notify.test.ts
  ● Test suite failed to run
    Configuration error:
    Could not locate module @/lib/alerting/notify mapped as:
    /home/yzel/github/infrasight-phase4/$1.
Test Suites: 1 failed, 1 total
Tests:       0 total
```

### Step 3 (notify.ts) — GREEN

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

**Deletion check on the bounding logic itself** (the actual behavior the
whole task exists for, not just the wiring): in `bound()`, temporarily
changed `if (alerts.length > ALERT_EVENT_MAX)` to `if (false &&
alerts.length > ALERT_EVENT_MAX)` and reran the file:

```
✕ should degrade to a storm above ALERT_EVENT_MAX
✕ should set storm.since to the earliest fired_at
✕ buildResolvedEnvelope › should apply the same bounds
Tests:       3 failed, 7 passed, 10 total
```

Exactly the three tests that exercise the count cap went red (the third
one's `since`-dependent and 25-alert storm assertions fail once the count
cap can't fire); reverted, reconfirmed 10/10. Then independently disabled
the byte-cap line (`if (false && Buffer.byteLength(...) >
ALERT_EVENT_MAX_BYTES)`) and reran:

```
✕ should degrade to a storm when the measured body exceeds the byte cap
Tests:       1 failed, 9 passed, 10 total
```

Exactly the one test targeting that path went red, isolated cleanly from the
count-cap tests. Reverted both lines to the brief's exact code and
reconfirmed 10/10 green (shown again in Step 7 below).

### Step 5 (manual-resolution broadcast) — GREEN + spy deletion check

```
$ pnpm test __tests__/integration/api/alerts.integration.test.ts
PASS node __tests__/integration/api/alerts.integration.test.ts
  PATCH /api/v2/alerts/[id]
    ✓ should acknowledge a firing alert
    ✓ should resolve a firing alert and record a manual resolution
    ✓ should broadcast a manual resolution with the user id, never an email
    ...
Tests:       35 passed, 35 total
```

**Spy-interception deletion check** (this is the exact hazard flagged in the
task: a `jest.spyOn` on the `@/lib/alerting` barrel is dead if the route
imports from `@/lib/alerting/notify` directly). The route imports
`publishAlertEvents` from `@/lib/alerting` — the same barrel the test spies
on — so I verified this is load-bearing by temporarily changing the route's
`if (status === 'resolved') await publishAlertEvents(...)` guard to
`if (false && status === 'resolved') await publishAlertEvents(...)` and
rerunning only the new test:

```
● should broadcast a manual resolution with the user id, never an email
  TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))
    > const [, resolvedArg] = spy.mock.calls[0];
Tests:       1 failed, 34 skipped, 35 total
```

`spy.mock.calls[0]` was `undefined` — the spy was genuinely never invoked
when the call site is gone, proving the spy intercepts the real call rather
than passing vacuously. Reverted the guard, reran the full file: 35/35 green
again.

### Step 6 (cron broadcast fix) — GREEN + wiring deletion check

```
$ pnpm test __tests__/integration/api/simulate-cron.integration.test.ts
    partial insert handling
      ✓ evaluates and reports only the readings bulkInsertReadings actually inserted
      ✓ broadcasts only the readings that persisted, not every reading generated
      ✓ must not count a reading bulkInsertReadings rejected toward the anomaly total
Tests:       60 passed, 60 total
```
(Baseline before this test existed: 59/59 — confirmed by running the suite
immediately after the Step 6 route edit but before adding the test, to prove
the route change alone caused no regressions in the existing partial-insert
tests, which don't provide `.toObject()` on their stand-ins — the resulting
`TypeError` is caught and logged by the route's own try/catch, exactly as
designed.)

**Wiring deletion check**: temporarily reverted the route's trigger call
back to the old `pusherServer.trigger('InfraSight', 'new-readings',
newReadings)` and ran only the new test:

```
● broadcasts only the readings that persisted, not every reading generated
  expect(received).toHaveLength(expected)
  Expected length: 2
  Received length: 3
Tests:       1 failed, 59 skipped, 60 total
```

Confirmed red — the mock correctly recorded all 3 generated readings, not
the 2 that "persisted." Reverted the route back to
`insertedReadings.map(r => r.toObject({ versionKey: false }))`, reran the
full file: 60/60 green again.

### Step 7 — scoped test run

```
$ pnpm test __tests__/unit/lib/alerting __tests__/integration/api
Test Suites: 26 passed, 26 total
Tests:       658 passed, 658 total
Time:        12.401 s
```

I specifically checked `__tests__/integration/api/readings-ingest.integration.test.ts`
(the other `safeEvaluateReadings` call site, from Task 9) because it does
**not** mock `@/lib/pusher` and has two tests that seed a real
`AlertRuleV2` and drive a real fire through the ingest endpoint — after Step
4, those now reach the real (uncredentialed-for-this-sandbox)
`pusherServer.trigger`. Confirmed this is harmless: grepping the full run
log for `Pusher alert-event trigger failed` shows exactly 4 occurrences
total across the *entire* 658-test run (1 from `notify.test.ts`'s own
"should swallow a Pusher failure" test, 1 from
`alerts.integration.test.ts`'s pre-existing "should resolve a firing alert"
test, and 2 from the two ingest alert-firing tests) — all caught, logged,
and fast (the whole 26-suite run took 12.4s). `readings-ingest.integration.test.ts`
passed in full. I did not modify that file — the brief's file list didn't
include it, and empirically nothing needed fixing there.

## Gate output (exact)

### `npx tsc --noEmit`

```
$ npx tsc --noEmit
EXIT_CODE=0
```
No output, 0 errors.

### `pnpm lint`

```
$ pnpm lint
$ eslint
EXIT_CODE=0
```
No output, 0 problems.

### `pnpm test` (full suite)

```
Test Suites: 102 passed, 102 total
Tests:       2466 passed, 2466 total
Snapshots:   0 total
Time:        40.331 s
```
Entry baseline was 2454 tests / 101 suites. Delta: +12 tests / +1 suite,
exactly `notify.test.ts` (10 tests, 1 new suite) + the one new assertion
each in `alerts.integration.test.ts` and
`simulate-cron.integration.test.ts`. Grepped the full run log:
`grep -c "^FAIL"` → 0, `grep -c "^PASS"` → 102.

### `pnpm build`

Not run. Per this task's explicit global constraints, this worktree's
`.env.local` has no `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` /
`CLERK_SECRET_KEY`, Clerk throws during prerender, this is pre-existing and
not this task's problem, and `tsc --noEmit` is the designated compile gate
instead. I did not attempt it and did not write any key anywhere.

All of the above (tsc, lint, full test suite) were re-run once more, fresh,
against the exact final committed state (after both commits, working tree
clean) as a final check: identical results (`tsc` exit 0, `lint` exit 0,
`102 passed, 102 total` / `2466 passed, 2466 total`).

## Commits

```
28b13e1 feat(alerting): broadcast bounded alert events over Pusher
4cb3d26 fix(cron): broadcast only the readings that persisted
```

Commit 1 (`28b13e1`) — `lib/alerting/notify.ts` (new),
`lib/alerting/index.ts`, `app/api/v2/alerts/[id]/route.ts`,
`__tests__/unit/lib/alerting/notify.test.ts` (new),
`__tests__/integration/api/alerts.integration.test.ts` (5 files,
+265/-2).

Commit 2 (`4cb3d26`) — `app/api/v2/cron/simulate/route.ts`,
`__tests__/integration/api/simulate-cron.integration.test.ts` (2 files,
+58/-3).

Both authored on branch `feat/phase-4-alerting` in
`/home/yzel/github/infrasight-phase4`. `git status --porcelain` empty
post-commit. `git add` was done by explicit file list (never `-A`/`.`) for
both commits, matching the brief's Step 8 exactly, and I confirmed via
`git status --porcelain=v1` immediately before each commit that the staged
set was precisely the files I intended and nothing else.

## Things I was unsure about / judgment calls made

1. **`readings-ingest.integration.test.ts` doesn't mock `@/lib/pusher`.**
   After Step 4, its two alert-firing tests now make a real (fast-failing,
   swallowed) `pusherServer.trigger` call using the real-looking Pusher
   credentials in this worktree's `.env.local`. I verified this is harmless
   (fails in milliseconds, caught by `notify.ts`'s own try/catch, no test
   assertion touches it) rather than papering over it with a mock, since the
   brief's file list deliberately did not include this file. If the
   orchestrating process wants that file to also mock `@/lib/pusher` for
   hygiene (matching the existing pattern and comment in
   `simulate-cron.integration.test.ts`, "Mock pusher to avoid network errors
   in tests"), that's a one-line addition but I left it out as out-of-scope
   for this task.
2. **`sweep.test.ts` calls `safeSweepStaleAlerts` directly, twice, without
   mocking `@/lib/pusher`.** I checked both call sites before touching
   anything: both are in tests that make `AlertV2.find` throw synchronously
   before `sweepStaleAlerts` can return a result, so the `await
   sweepStaleAlerts(...)` line itself rejects and control never reaches the
   `publishAlertEvents` call I added — confirmed by the full test run
   passing with no Pusher log lines attributable to that file.
3. **Kept the two `if (status === 'resolved')` statements separate** in
   `app/api/v2/alerts/[id]/route.ts` rather than merging them into one
   braced block, matching the brief's literal code shape and this
   codebase's `curly: ['error', 'multi']` lint rule (single-statement `if`
   without braces, even when the statement spans multiple lines, is the
   established style throughout `lib/alerting/evaluate.ts` and `sweep.ts`).
4. **`.toObject()` shim in the Step 6 test's mock.** Necessary, not
   cosmetic: without it, `insertedReadings.map(r => r.toObject(...))`
   throws before `pusherServer.trigger` is ever called (the exception
   happens while evaluating the call's arguments), which the route's own
   try/catch swallows — so the test would silently observe zero trigger
   calls rather than a wrong-length payload, and would need a different
   (weaker) assertion to pass at all. Mirroring what a real `insertMany`
   document actually provides was the correct fix, not a workaround.
5. **`ALERT_CHANNEL` export from `notify.ts`.** Not in the brief's
   "Produces" interface list, but present in the brief's own Step 3 code
   block (`export const ALERT_CHANNEL = 'InfraSight'`) and used internally
   by `trigger()`. Kept it as written since removing the `export` would
   deviate from the given code for no benefit and the constant mirrors the
   `'InfraSight'` string literal already used verbatim in the cron route.

---

## Fix round 1 (review findings)

Review came back with spec/quality approved and both test-integrity hazards
confirmed genuine (the reviewer independently traced the barrel-spy through
TypeScript's CommonJS codegen and ran the test standalone). Two Important
findings, ruled by the human: fix both. This section covers that work,
appended to the same report per instructions.

### Finding 1 — `publishAlertEvents` shared the DB call's `try`

**The bug.** In both `safeEvaluateReadings` and `safeSweepStaleAlerts`
(`lib/alerting/index.ts`), the broadcast call sat inside the same `try` as
the DB call, sharing its `catch`. The brief's own Step 4 code block showed
it this way, which is what I implemented — but a throw from the broadcast
path (envelope math in `notify.ts`, or a Pusher failure `trigger()`'s own
internal try/catch hadn't already absorbed) would land in the *outer*
catch: `recordAlert('evaluation_error')` mislabels a successful evaluation
as failed, and `return emptyEvaluationResult()` / `return { deleted: 0,
resolved: [] }` discards a `fired`/`resolved` result that had already
committed to the database. The module's own doc comment (lines 10–12)
promises isolation for "the call" — written about the DB call — and this
silently extended that promise to cover the broadcast without actually
providing it.

**The fix.** Gave the broadcast its own nested `try/catch` inside the outer
`try`, so it can never reach the outer `catch`:

```typescript
try {
  const result = await evaluateReadings(readings, devices);
  try {
    await publishAlertEvents(result.fired, result.resolved);
  } catch {
    // trigger() already logs internally; this is belt-and-suspenders so a
    // broadcast fault can never discard a committed evaluation result or
    // reach the catch below, which would mislabel it as evaluation_error.
  }
  return result;
} catch (error) {
  recordAlert('evaluation_error');   // now genuinely DB-only
  ...
  return emptyEvaluationResult();
}
```

Applied identically to `safeSweepStaleAlerts`. Also updated the top-of-file
doc comment: added a paragraph after the existing three-point list
explaining that the broadcast runs in its own nested try/catch specifically
so a broadcast fault can't be mistaken for (2)'s DB-failure path, spelling
out what would go wrong if it were removed (the exact bug just fixed).

**Test.** Added two tests to `__tests__/unit/lib/alerting/sweep.test.ts`'s
existing `describe('safe wrappers', ...)` block (the established home for
both safe-wrapper tests — it already covers their DB-failure paths):
`should return the real evaluation result, not the empty fallback, when
publishAlertEvents throws` and the sweep equivalent. Each seeds real data
so the DB call succeeds for real (a real rule + breaching reading; a real
stale alert), mocks `publishAlertEvents` to reject, and asserts (a) the
real `fired`/`resolved` result comes back — not the empty fallback — with
the DB state to match, and (b) `evaluationErrors` in the metrics snapshot
stays `0`.

**Why the spy targets `@/lib/alerting/notify`, not the `@/lib/alerting`
barrel:** `lib/alerting/index.ts` imports `publishAlertEvents` from `./notify`
directly (a relative import — the same module as `@/lib/alerting/notify`),
never re-importing its own barrel. A spy on the barrel's re-exported
property would mutate a *different* property than the one `index.ts`'s own
call sites read, which is exactly the dead-spy hazard flagged for Step 5's
PATCH-route test — just mirrored: there the route used the barrel and the
test had to match it; here the module under test uses the direct import and
the test has to match *that*. `import * as notifyModule from
'@/lib/alerting/notify'` plus `jest.spyOn(notifyModule, 'publishAlertEvents')`
targets the correct object.

**TDD evidence.**

RED — reran `sweep.test.ts` with only the two new tests selected, against
the *old* shared-try code (temporarily reverted both wrappers to `await
publishAlertEvents(...); return result;` inside the single try, no nested
catch):

```
● safe wrappers › should return the real evaluation result, not the empty fallback, when publishAlertEvents throws
  expect(received).toHaveLength(expected)
  Expected length: 1
  Received length: 0
  Received array:  []
    > expect(result.fired).toHaveLength(1);

● safe wrappers › should return the real sweep result, not the empty fallback, when publishAlertEvents throws
  Expected length: 1
  Received length: 0
    > expect(result.resolved).toHaveLength(1);

Tests:       2 failed, 18 skipped, 20 total
```

Exactly the bug: the DB call's real result (a fired alert; a resolved
alert) was silently replaced by the outer catch's empty fallback.

GREEN — reverted to the nested-try fix and reran the full file:

```
PASS node __tests__/unit/lib/alerting/sweep.test.ts
  safe wrappers
    ✓ should swallow an evaluation error and return an empty result
    ✓ should swallow a sweep error
    ✓ should return the real evaluation result, not the empty fallback, when publishAlertEvents throws
    ✓ should return the real sweep result, not the empty fallback, when publishAlertEvents throws
    ✓ should not throw when captureException itself throws (evaluator path)
    ✓ should not throw when captureException itself throws (sweep path)
Tests:       20 passed, 20 total
```

### Finding 2 — two integration test files made real outbound Pusher calls

**The gap.** After Task 13's wiring, `alerts.integration.test.ts:508-523`'s
"should resolve a firing alert" test (a manual resolve) and
`readings-ingest.integration.test.ts`'s two alert-firing tests (a breaching
ingested reading) all reach the real `pusherServer.trigger()`, since
neither file mocks `@/lib/pusher`. I had disclosed this myself in the
original report as a deliberate, verified-harmless judgment call (fake
`.env.local` credentials + swallowed failures meant no test actually broke)
— the reviewer correctly treated it as in-scope anyway, specifically
because `alerts.integration.test.ts` is a file *this task edited*, not
merely adjacent to it. Fair: "harmless today" and "not a source of
flakiness" are different claims, and real outbound network I/O in a test
suite is the latter regardless of whether it currently fails cleanly.

**The fix.** Added the same mock both `simulate-cron.integration.test.ts`
and `auth.integration.test.ts` already use, at the top of both files:

```typescript
jest.mock('@/lib/pusher', () => ({
  pusherServer: { trigger: jest.fn().mockResolvedValue(undefined) },
}));
```

**Composability check (the coordinator specifically asked for this).**
`alerts.integration.test.ts` already has `jest.spyOn(alerting,
'publishAlertEvents').mockResolvedValue(undefined)` in the Step 5 broadcast
test. That spy replaces the entire higher-level `publishAlertEvents`
function, so for that one test execution never reaches `pusherServer
.trigger` at all — the new lower-level mock is simply unused there, not
fought over. For every *other* test in the file (which don't touch the
`alerting` spy), `publishAlertEvents` now runs for real and calls the
newly-mocked `pusherServer.trigger`, which resolves cleanly instead of
hitting the network. Verified this holds, not just reasoned about it: reran
the barrel-spy deletion check from the original report (Step 5) with the
new Pusher mock present — sabotaged the route's `if (status === 'resolved')`
guard to `if (false && ...)` again and confirmed the broadcast test still
goes red the same way (`spy.mock.calls[0]` is `undefined`), then restored
it and confirmed green again. The two mocks compose correctly.

**Verification that nothing else broke.** Ran both edited files together:

```
PASS node __tests__/integration/api/readings-ingest.integration.test.ts
PASS node __tests__/integration/api/alerts.integration.test.ts
Test Suites: 2 passed, 2 total
Tests:       80 passed, 80 total
```

Grepped that run's full log for `Pusher.*trigger failed`: 0 matches (down
from 3 real occurrences pre-fix — 1 in `alerts.integration.test.ts`, 2 in
`readings-ingest.integration.test.ts` — confirmed by re-running the same
grep against the pre-fix log captured earlier in this task).

### Re-verification after both fixes

Scoped run (alerting unit suites + all three integration files touched
across this task):

```
$ pnpm test __tests__/unit/lib/alerting __tests__/integration/api/alerts.integration.test.ts __tests__/integration/api/readings-ingest.integration.test.ts __tests__/integration/api/simulate-cron.integration.test.ts
Test Suites: 8 passed, 8 total
Tests:       245 passed, 245 total
```

The only `Pusher.*trigger failed` log lines remaining anywhere are
synthetic/deliberate, not real network attempts: `notify.test.ts`'s own
"should swallow a Pusher failure" test (1), and the two pre-existing
`simulate-cron.integration.test.ts` "partial insert handling" tests whose
mocked readings lack a `.toObject()` (`r.toObject is not a function`,
caught by the route's own try/catch — unrelated to this fix round, present
since the original Step 6 work). Confirmed by grepping the full-suite log
and inspecting each match's context.

Gates, fresh on the final committed state:

```
$ npx tsc --noEmit
EXIT_CODE=0

$ pnpm lint
$ eslint
EXIT_CODE=0

$ pnpm test
Test Suites: 102 passed, 102 total
Tests:       2468 passed, 2468 total
Time:        39.198 s
```

Delta from the end of the original submission (102 suites / 2466 tests):
+2 tests, +0 suites — exactly the two new isolation-pinning tests added to
the existing `sweep.test.ts`, no new test files this round. `grep -c
"^FAIL"` on the full run log: 0.

### Commits (fix round 1)

```
82a4d96 fix(alerting): isolate the Pusher broadcast from the evaluation/sweep result
004a462 test(alerting): mock Pusher in alert-broadcast-adjacent integration tests
```

Commit `82a4d96` — `lib/alerting/index.ts`,
`__tests__/unit/lib/alerting/sweep.test.ts` (2 files, +98/-2). Finding 1.

Commit `004a462` — `__tests__/integration/api/alerts.integration.test.ts`,
`__tests__/integration/api/readings-ingest.integration.test.ts` (2 files,
+21/-0). Finding 2.

Both on branch `feat/phase-4-alerting`, stacked on the original two commits
(`28b13e1`, `4cb3d26`). `git status --porcelain` empty post-commit.

### Not addressed (by design)

The `AlertEvent` storm-variant ambiguity (a fired-storm and a
resolved-storm are wire-identical) was explicitly flagged by the
coordinator as **no action required** — the type predates this task,
Task 13's code matches it exactly, and it's being carried forward to
Task 14 (the toast UI consuming this shape). Not touched.

### Things I was unsure about in this round

1. **Two commits vs. one for the fixes.** Finding 1 is a production-code
   correctness fix with its own regression test; Finding 2 is test-only
   hygiene with no production code change. Split them the same way the
   original Step 8 split the broadcast feature from the cron payload fix,
   on the theory that "unrelated fixes get separate commits" is this task's
   established convention, not a one-off. Easy to squash if a single "fix
   round 1" commit was actually wanted.
2. **Where the two new isolation tests live.** Added them to
   `sweep.test.ts`'s `describe('safe wrappers', ...)` block rather than a
   new `lib/alerting/index.test.ts` file, matching the existing precedent
   that this block already hosts both wrappers' error-handling tests
   (despite the file's name suggesting sweep-only). If a dedicated file was
   expected instead, this is a mechanical split.
