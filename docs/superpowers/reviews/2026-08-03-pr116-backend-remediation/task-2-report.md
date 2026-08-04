# Task 2 report: Reconcile the evaluator's bulk write

**Commit:** `fd1966d` — fix(alerting): confirm the evaluator's writes before notifying or counting
**Branch:** `feat/phase-4-alerting` (worktree `/home/yzel/github/infrasight-phase4`), base `ee92de9`
**Files changed:** `lib/alerting/evaluate.ts`, `__tests__/unit/lib/alerting/evaluate.test.ts`

---

## What I implemented

Mirrors Task 1's shape in `sweep.ts`: the pre-write array is renamed to say it holds candidates,
the write's outcome is captured, and both the returned arrays and the counters are derived from
confirmed outcomes after the write.

| Brief item | Where | Notes |
|---|---|---|
| 1. Capture the `BulkWriteResult` | `evaluate.ts:401-420` | `deletedCount` is taken from the driver and becomes `result.pendingCleared`. See "judgment call" below. |
| 2. `insertOne` confirmed by `failedIndices` | `:457-459` | Unchanged semantics — an insert either inserts or reports a write error. |
| 3. One reconciliation query for notified update ops | `:422-443` | `AlertV2.find({ _id: { $in: notifiedUpdateIds }, 'audit.updated_at': now }).select({ _id: 1 }).lean()`, built into a `Set` of stringified ids. Only ops carrying a notification are queried; the query is skipped when that list is empty. |
| 4. `recordAlert` after the write | `:451-469` | All three call sites (immediate-fire insert, promotion, auto-resolve) moved into the confirmation loop. |
| 5. Duration on every exit path | `:110`, `:471-475` | Whole body wrapped in `try { … } finally { recordAlertEvaluationDuration(Date.now() - started); }`; the two inline calls removed. |
| 6a. `PendingNotification` comment | `:48-61` | Now states it is a candidate and describes the two confirmation mechanisms. |
| 6b. COST comment | `:7-11` | Now: two `find`s + one bulk write, plus one reconciliation `find` when any update op carries a notification, plus one rule-load query on a cache miss — and keeps the "does not scale with batch size" point. |

Plumbing: `PendingNotification` gained `confirmId` — present exactly when the op is a guarded
`updateOne` (required on the `resolved` variant, which is always an update; optional on `fired`,
which may be an insert). The pre-write array is `notificationCandidates`.

**The E11000 absorb logic is byte-identical** (`:404-415`), and the existing E11000 test at
`evaluate.test.ts:306-319` was not touched — the only removed line in the whole test diff is the
factories import line, which was extended in place.

### Judgment call: `pendingCleared` now comes from `deletedCount`

Brief item 1 says "capture the `BulkWriteResult`" without naming a consumer. In this function the
only count derived from a *guarded* op is `pendingCleared`: the `deleteOne` ops are filtered on
`status: 'pending'` and delete fewer than were queued when a concurrent evaluation promotes an
episode. That is the same defect class as Task 1's `deleted`/`toDelete.length`, and the controller
brief said explicitly to "use the driver's own counts (`deletedCount`) rather than candidate
counts", so `pendingCleared` is now the driver's count and the `pendingCleared++` local counter is
gone. Capturing the result and using it for nothing would have been an unused variable.

Because `ordered: false` still runs the surviving ops when an insert raises E11000, the absorb path
reads the count off the error (`MongoBulkWriteError` exposes a `deletedCount` getter); otherwise a
delete that landed alongside an absorbed duplicate would be reported as 0. Verified against a real
driver error, not a fabricated one (test 4 below).

---

## Anti-vacuity verification (Global Constraint 2)

Six new tests, five mutations. Every mutation was applied to the source, run, observed FAILING, then
reverted and observed PASSING. Command used throughout:

```
npx jest --selectProjects node --testPathPatterns "unit/lib/alerting/evaluate"   # (or -t "<name>")
```

### Test 1 — `should not report a promotion whose guarded update matched nothing`
### Test 2 — `should not report an auto-resolve whose guarded update matched nothing`

Both race the guarded update to a zero match by spying on `AlertV2.bulkWrite` with an implementation
that mutates the document and then calls through to the real one — landing the concurrent change
strictly between the function's read and its write. Test 1 promotes the episode to `firing` (killing
the `status: 'pending'` guard); test 2 resolves it as a human would via `PATCH /alerts/[id]` (killing
the `is_open: true` guard). Both use **fixed** racing timestamps, never `new Date()`: the
reconciliation query keys on `audit.updated_at === now`, and a same-millisecond racing write would
confirm the notification for the wrong reason.

**Mutation A** (reverts the update-confirmation half of item 3) — `evaluate.ts:457`:

```ts
-      const landed = candidate.confirmId
-        ? confirmedUpdateIds.has(String(candidate.confirmId))
-        : !failedIndices.has(i);
+      const landed = !failedIndices.has(i);
```

FAILING output:

```
● evaluateReadings › should not report a promotion whose guarded update matched nothing
  expect(received).toHaveLength(expected)
  Expected length: 0
  Received length: 1
  Received array:  [{"_id": "6a710720690ec79d86d3f5ed", ... "severity": "critical", "threshold": 30, "trigger_value": 36}]
  > 356 |     expect(result.fired).toHaveLength(0);

● evaluateReadings › should not report an auto-resolve whose guarded update matched nothing
  expect(received).toHaveLength(expected)
  Expected length: 0
  Received length: 1
  Received array:  [{"_id": "6a710720690ec79d86d3f5ff", "actor": "system", "device_id": "device_001", "resolution": "auto", ...}]
  > 403 |     expect(result.resolved).toHaveLength(0);

Tests:       2 failed, 2207 skipped, 2209 total
```

**Mutation B** (isolates the counter claim — increments at candidate time, as the pre-change code
did, while leaving `result.fired`/`result.resolved` correct) — `evaluate.ts:460`:

```ts
+      if (candidate.kind === 'fired') recordAlert('fired', { severity: candidate.alert.severity });
+      else recordAlert('resolved', { resolution: candidate.alert.resolution });
       if (!landed) continue;
```

FAILING output (proves the metric assertions are load-bearing on their own, not masked by the
array assertions):

```
● evaluateReadings › should not report a promotion whose guarded update matched nothing
  expect(received).not.toContain(expected) // indexOf
  Expected substring: not "alerts_fired_total{severity=\"critical\"}"

● evaluateReadings › should not report an auto-resolve whose guarded update matched nothing
  expect(received).not.toContain(expected) // indexOf
  Expected substring: not "alerts_resolved_total{resolution=\"auto\"}"

Tests:       2 failed, 2207 skipped, 2209 total
```

PASSING after restore:

```
✓ should not report a promotion whose guarded update matched nothing (19 ms)
✓ should not report an auto-resolve whose guarded update matched nothing (18 ms)
```

### Test 3 — `should count pending clears from the deletes that actually landed`

Two pending episodes both clear in one batch (two delete candidates); one of them races to `firing`
inside the `bulkWrite` spy, so its `status: 'pending'`-guarded `deleteOne` matches nothing.

**Mutation C** (restores the pre-change candidate counter): re-add `let pendingCleared = 0;`,
`pendingCleared++` in the delete branch, and `result.pendingCleared = pendingCleared;`.

FAILING output:

```
● evaluateReadings › should count pending clears from the deletes that actually landed
  Expected: 1
  Received: 2
  > 447 |     expect(result.pendingCleared).toBe(1);

Tests:       1 failed, 2208 skipped, 2209 total
```

PASSING after restore: `✓ should count pending clears from the deletes that actually landed (19 ms)`

### Test 4 — `should absorb a real duplicate key error and still count the delete that landed`

The only test in the repo that drives the absorb path with a **real** `MongoBulkWriteError` instead
of a hand-built object: one batch queues a `deleteOne` (device_001's cleared pending episode) and an
`insertOne` (device_002), and the spy opens a conflicting episode for device_002 first, so the
partial unique index raises E11000 while `ordered: false` lets the delete through.

**Mutation D** (drops the absorb path's count) — remove `evaluate.ts:419`:

```ts
-        deletedCount = (err as { deletedCount?: number }).deletedCount ?? 0;
```

FAILING output — which also proves the catch branch is genuinely taken (otherwise the success path
would have supplied the same 1 and the test would pass vacuously):

```
✕ should absorb a real duplicate key error and still count the delete that landed (17 ms)
  Expected: 1
  Received: 0

Tests:       1 failed, 28 passed, 29 total
```

PASSING after restore:
`✓ should absorb a real duplicate key error and still count the delete that landed (19 ms)`

### Test 5 — `should record evaluation duration when the bulk write throws`
### Test 6 — `should record evaluation duration on the empty-input early return`

**Mutation E** (reverts item 5 — record only on the normal return, as before):

```ts
+    recordAlertEvaluationDuration(Date.now() - started);
     return result;
   } finally {
-    recordAlertEvaluationDuration(Date.now() - started);
+    // mutation: duration is no longer recorded on every exit path
   }
```

FAILING output:

```
● evaluateReadings › should record evaluation duration when the bulk write throws
  Expected substring: "alert_evaluation_duration_ms_count 1"
  Received string:    "... alert_evaluation_duration_ms_count 0 ..."

● evaluateReadings › should record evaluation duration on the empty-input early return
  Expected substring: "alert_evaluation_duration_ms_count 1"
  Received string:    "... alert_evaluation_duration_ms_count 0 ..."

Tests:       2 failed, 2205 skipped, 2 passed, 2209 total
```

PASSING after restore:

```
✓ should record evaluation duration when the bulk write throws (7 ms)
✓ should record evaluation duration on the empty-input early return (3 ms)
```

---

## Full-suite, type, and lint results

```
$ npx jest --selectProjects node
Test Suites: 82 passed, 82 total
Tests:       2210 passed, 2210 total
Time:        32.4 s
```

2210 = the 2204 baseline + 6 new tests, same 82 suites. No regressions; the alerting suites alone go
73 → 79.

```
$ npx tsc --noEmit | grep -c "error TS"
39                       # unchanged pre-existing count; zero mention `lib/alerting`

$ npx eslint lib/alerting/evaluate.ts __tests__/unit/lib/alerting/evaluate.test.ts
                         # clean
```

Prettier was deliberately not run: `evaluate.ts`, `evaluate.test.ts` and `sweep.ts` all fail
`prettier --check` on `main` already, so formatting them would have inflated the diff with unrelated
churn. New lines were hand-kept under the 100-column limit (four pre-existing lines that the
re-indent pushed over were re-wrapped).

---

## Self-review findings (fixed before reporting)

1. **Duplicated test helper.** Two new tests each defined a local `readingFor(deviceId, value, at)`
   closure. Hoisted to one module-level helper beside `reading()`. The pre-existing fleet-wide test
   still uses its own inline idiom — left alone under scope discipline.
2. **Four lines pushed past 100 columns** by the `try` re-indent (`metricValue` guard, the `push`
   signature, the `firesImmediately` ternary, the `elapsedMs` expression). Re-wrapped in the file's
   own style.
3. **Metric assertions could have been vacuous.** Under Mutation A both new race tests fail on their
   *array* assertion first, so the `alerts_fired_total` / `alerts_resolved_total` assertions were
   never demonstrated to be load-bearing. Added Mutation B, which isolates exactly that claim.
4. **The absorb path's `deletedCount` was untested behavior.** Added test 4 (real E11000 through the
   partial unique index) rather than leaving a new line unverified — and Mutation D confirms the
   test really enters the catch branch.
5. **Comment accuracy re-checked against the code as written.** `:48-61` describes both confirmation
   mechanisms and matches `:457-459` exactly; `:7-11` matches the query shape at `:184`, `:193`,
   `:403`, `:436` and `rule-cache.ts`'s cache-miss load. `:396-398` explains why the delete count
   comes from the driver, and is true only because every `deleteOne` in this function is a pending
   clear — stated in the comment so a future delete op does not silently break it.

## Concerns

1. **`pendingCleared` was not in the brief's explicit list.** I changed it because item 1 has no
   other consumer in this function and the controller instruction named `deletedCount`. It is
   strictly more accurate than the candidate count and is covered by tests 3 and 4, but flagging it
   as the one place I went past a literal reading of items 1–6.
2. **`pendingOpened` is still a candidate count** (`evaluate.ts:271`). An `insertOne` for a pending
   episode that loses an E11000 race still increments it. Item 2 scopes insert confirmation to
   *notifications*, and fixing this needs a different mechanism (tracking pending-insert op indices
   against `failedIndices`), not a driver count — so I report it rather than fix it. Same class of
   defect, smaller blast radius: it is a number in a log, never a notification.
3. **Same-millisecond confirmation limit, inherited from Task 1.** The reconciliation keys on
   `audit.updated_at === now`; a concurrent writer that stamps the identical millisecond would be
   miscounted as confirmed. Inherent to the one-query design (the alternative is a per-pair
   `findOneAndUpdate`, which breaks the constant-cost property). Both new race tests use fixed
   timestamps specifically so they cannot pass through that hole.
4. **`AlertV2.init()` in test 4** builds the model's indexes for the rest of that file. Everything
   after it still passes (the fleet-wide test uses 20 distinct devices, so no duplicate open
   episodes), but it is a shared-state side effect worth knowing about if tests are reordered.

---

# Fix round 1 — Important 1: positive coverage for the relocated `recordAlert` calls

**Commit:** `746112d` — test(alerting): assert the fired and resolved counters still count
**File changed:** `__tests__/unit/lib/alerting/evaluate.test.ts` (test-only; `lib/alerting/evaluate.ts`
is byte-identical to `fd1966d`)

## The finding, confirmed

Reproduced before changing anything: deleting **both** `recordAlert` calls from
`evaluate.ts:462-468` left the entire node project green (82 suites, 2210 tests). Item 4 moved those
calls, and my new tests only constrained them from one side — they prove the counters do not
*over*-count in a zero-match race, and nothing proved they still count at all. The only positive
assertions on `alerts_fired_total` / `alerts_resolved_total` live in
`__tests__/unit/lib/metrics.test.ts:495-506`, which call `recordAlert` directly and never enter
`evaluateReadings`.

## What I changed

Two assertions, one per call site, added to existing green tests that already cover the happy path.
No new tests, no source change.

- `should open a firing alert immediately when for_duration_seconds is 0` (`:88-90`):
  `expect(getPrometheusMetrics()).toContain('alerts_fired_total{severity="critical"} 1');`
- `should auto-resolve a firing alert when the condition clears` (`:160`):
  `expect(getPrometheusMetrics()).toContain('alerts_resolved_total{resolution="auto"} 1');`

Both assert the value `1`, not just the label's presence, so a double count fails them too. Both are
exact-count-safe because `resetMetrics()` already runs in this describe's `beforeEach`. The first
carries a two-line comment naming the asymmetry it closes, so a future reader does not read it as
incidental.

The single `recordAlert('fired', …)` call site serves both the insert path and the confirmed-update
(promotion) path, so one assertion covers both; a second one on the promotion test would only guard
a divergence the code shape cannot have.

## Verification, both directions (Global Constraint 2)

Command: `npx jest --selectProjects node --testPathPatterns "unit/lib/alerting/evaluate"`

**Mutation F** — delete `recordAlert('fired', { severity: candidate.alert.severity });`
(`evaluate.ts:464`). FAILING:

```
✕ should open a firing alert immediately when for_duration_seconds is 0 (30 ms)
  Expected substring: "alerts_fired_total{severity=\"critical\"} 1"
  Received string:    "# HELP http_request_duration_ms HTTP request latency in milliseconds ...
Tests:       1 failed, 28 passed, 29 total
```

**Mutation G** — delete `recordAlert('resolved', { resolution: candidate.alert.resolution });`
(`evaluate.ts:467`). FAILING:

```
✕ should auto-resolve a firing alert when the condition clears (16 ms)
  Expected substring: "alerts_resolved_total{resolution=\"auto\"} 1"
  Received string:    "# HELP http_request_duration_ms HTTP request latency in milliseconds ...
Tests:       1 failed, 28 passed, 29 total
```

**Mutation F+G together** — the reviewer's exact reproduction, now caught. `npx jest --selectProjects node`:

```
Test Suites: 1 failed, 81 passed, 82 total
Tests:       2 failed, 2208 passed, 2210 total
```

(Before this round the same mutation gave `82 passed / 2210 passed`.)

**Restored** — `lib/alerting/evaluate.ts` back to the committed version (`git diff` on it is empty),
both assertions PASSING:

```
✓ should open a firing alert immediately when for_duration_seconds is 0 (31 ms)
✓ should auto-resolve a firing alert when the condition clears (17 ms)
Tests:       29 passed, 29 total
```

## Full-suite, type, and lint results after the fix

```
$ npx jest --selectProjects node
Test Suites: 82 passed, 82 total
Tests:       2210 passed, 2210 total

$ npx tsc --noEmit | grep -c "error TS"
39                       # unchanged pre-existing count

$ npx eslint __tests__/unit/lib/alerting/evaluate.test.ts
                         # clean
```

2210 unchanged — this round added assertions to existing tests, not new test cases. No regressions.
Every line added this round is within the file's 100-column style.

## Notes

- The three Minor findings (COST comment's unconditioned clauses, `EvaluationResult` mixing a
  driver-confirmed `pendingCleared` with a candidate `pendingOpened`, and the wider
  `audit.updated_at` false-confirm window versus the sibling's `audit.resolved_at`) were left
  untouched as instructed, for the whole-branch review.
- No new concerns from this round.
