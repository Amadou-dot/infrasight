# Plan: PR 116 review fixes — Phase 4 alerting backend

Fixes the Critical and Important findings from the multi-agent backend review of PR #116
(posted at https://github.com/Amadou-dot/infrasight/pull/116#issuecomment-5171323964).

## Context

Branch `feat/phase-4-alerting`, worktree `/home/yzel/github/infrasight-phase4`, head `c5395ff`.
The Phase 4 alerting backend is complete (tasks 1–11 of 20); there is no UI yet. These fixes
land before tasks 12–20 build on the subsystem, because several findings become user-visible
the moment Task 13 wires Pusher delivery.

Key subsystem facts an implementer needs:

- `lib/alerting/evaluate.ts` reduces a batch of readings to one decision per (rule, device)
  pair, then issues **two `find`s and one `bulkWrite`** — constant in batch size.
- `lib/alerting/sweep.ts` runs on the cron path only; it resolves alerts whose device stopped
  reporting (`device_inactive`) or whose last observation aged out (`stale`).
- Dedup is enforced by a partial unique index on `{rule_id, device_id}` filtered to
  `is_open: true` (`models/v2/AlertV2.ts:167`). E11000 from that index is absorbed as a benign
  race; every other write error rethrows.
- Both write paths call only the `safe*` wrappers in `lib/alerting/index.ts`, which must never
  throw — a broken evaluator must never drop readings.

## Global Constraints

These bind every task. A task is not done until all of them hold.

1. **Work in `/home/yzel/github/infrasight-phase4`** on branch `feat/phase-4-alerting`. Never
   switch branches, never rebase, never force-push.
2. **Every behavioral change needs a test that fails without it.** Before claiming a test
   covers a fix, revert the source change (or apply the stated mutation), run the test, and
   confirm it FAILS; then restore and confirm it PASSES. Report both results. This branch's
   documented recurring failure mode is tests that pass for the wrong reason — a test that
   passes with the fix reverted is worse than no test.
3. **Never weaken, skip, or delete an existing test to make a suite green.** If an existing
   test genuinely encodes wrong behavior, say so in your report and explain why; do not
   silently change its assertions.
4. **Run the tests covering the code you touched** and paste the command and its real output
   into your report. Never claim a result you did not observe.
5. **Follow `CLAUDE.md`**: `withErrorHandler` + `jsonSuccess`/`jsonPaginated` in routes,
   `requireAdmin()` for mutations and `requireOrgMembership()` for reads, the
   `mongoose.models.X || mongoose.model()` pattern, no imports from `_deprecated`.
6. **Do not introduce new TypeScript or ESLint errors.** The repo has pre-existing ones
   (39 type, 311 lint); your diff must not add to either count.
7. **Do not touch `.superpowers/`**, the plan file, or the ledger.
8. **Match surrounding style.** Comment density, naming, and idiom should look like the file
   you are editing. Do not add explanatory comments to code that does not need them.
9. **Scope discipline.** Implement exactly what your task specifies. If you spot an unrelated
   problem, report it — do not fix it.
10. **Commit your work** with a message describing the behavior change, not the process.

---

## Task 1: Reconcile the sweep's bulk write and close the stale-resolve race

**Files:** `lib/alerting/sweep.ts`, `__tests__/unit/lib/alerting/sweep.test.ts`

### 1a. Close the stale-resolve race

`sweepStaleAlerts` snapshots open alerts at line 33, then writes at line 96. Between those, a
concurrent `evaluateReadings` on the ingest path can record a fresh breaching observation. The
resolve op's filter is only `{ _id, is_open: true }`, so the sweep closes an alert that is
actively breaching, stamped `resolution: 'stale'`. The evaluator's equivalent op guards with
`last_observed_at: { $lt: state.lastObservedAt }` (`evaluate.ts:345`); the sweep must mirror it.

Add `last_observed_at: { $lt: cutoff }` to the resolve filter **only when the resolution is
`'stale'`**. Leave the `'device_inactive'` branch filtered on `{ _id, is_open: true }` alone — a
device absent from `reportingDeviceIds` has no fresh observation by definition, so the cutoff
predicate would wrongly skip it.

Note the current precedence: `const resolution = deviceInactive ? 'device_inactive' : 'stale'`.
An alert that is both inactive and stale takes the `device_inactive` path and therefore keeps
the unguarded filter. Preserve that precedence.

### 1b. Reconcile the result against what MongoDB actually did

`resolved[]`, the `recordAlert('resolved', …)` calls, and the returned `deleted` count are all
produced **before** `bulkWrite` and never reconciled. Every op carries a guard that can
legitimately match zero documents, so all three can report transitions that did not happen.
Once Task 13 broadcasts `SweepResult.resolved` over Pusher this becomes a user-visible defect.

Required:

- Capture the `BulkWriteResult` from `AlertV2.bulkWrite(...)`.
- `deleted` must be the driver's actual `deletedCount`, not `toDelete.length`.
- `resolved[]` must contain only episodes whose `updateOne` actually matched.
- `recordAlert('resolved', { resolution })` must fire once per **confirmed** resolution, after
  the write — not once per candidate, before it.

`BulkWriteResult` exposes aggregate counts, not per-op match status, so confirm the resolve set
with **one** follow-up query. Every resolve op in a given run stamps `audit.resolved_at` with the
same `now` value, which makes the confirmed set exactly:

```ts
AlertV2.find({ _id: { $in: candidateIds }, 'audit.resolved_at': now }).select({ _id: 1 }).lean()
```

Emit and count only the ids that query returns. One extra query per sweep is acceptable; a
per-alert `findOneAndUpdate` loop is not.

### 1c. Project the snapshot read

Line 33 loads full documents for every open alert. Add a `.select()` limited to the fields the
loop actually reads (`_id`, `rule_id`, `device_id`, `status`, `severity`, `last_observed_at`).
Do **not** add a `.limit()` — silently skipping alerts is worse than a large read.

### 1d. Replace the vacuous race test

`__tests__/unit/lib/alerting/sweep.test.ts:125-147` claims to cover the `status: 'pending'`
guard on the `deleteMany` (the guard added in commit `e3ac047` to prevent destroying a fired
alert's history). It does not: it promotes the alert to `firing` at line 134, **before** calling
`sweepStaleAlerts` at line 136, so the sweep's own `find` already sees `firing`, `toDelete` stays
empty, and the guarded `deleteMany` is never constructed. `expect(result.deleted).toBe(0)` passes
trivially — the whole sweep suite still passes with the guard deleted.

Replace it with a test where the promotion lands **between** the sweep's read and its write. Spy
on `AlertV2.bulkWrite` with an implementation that first runs
`AlertV2.updateOne({ _id }, { $set: { status: 'firing' } })` and then calls through to the real
implementation. Assert the document still exists afterwards and was not deleted.

**Verify per Global Constraint 2:** delete the `status: 'pending'` predicate from the
`deleteMany` filter at `sweep.ts:94` and confirm this test FAILS.

### 1e. New tests

- The 1a guard: an alert stale at snapshot time whose `last_observed_at` is refreshed past
  `cutoff` before the write must NOT be resolved as `'stale'`. Verify it fails without 1a.
- The 1b reconciliation: `deleted` reflects actual deletions, and an alert resolved by a
  concurrent writer between read and write does not appear in `resolved[]`. Verify each fails
  without 1b.
- `sweep.test.ts:185-194` (`safeSweepStaleAlerts` swallows an error) currently asserts
  `{ deleted: 0, resolved: [] }`, which is byte-identical to the empty-database early return at
  `sweep.ts:34`. Strengthen it to also assert the spy was called and `logger.error` fired, the
  way its sibling at `:151-183` already does.

---

## Task 2: Reconcile the evaluator's bulk write

**Files:** `lib/alerting/evaluate.ts`, `__tests__/unit/lib/alerting/evaluate.test.ts`

Same class of defect as Task 1b, in the hotter path. `failedIndices` (`evaluate.ts:380-397`) is
populated **only** from `extractWriteErrors`, so it catches write errors and nothing else. A
guarded `updateOne` that matches **zero** documents is a driver success and never lands in
`failedIndices`, so its notification survives the filter at `:405-410` and its `recordAlert` has
already fired at push time.

Both guarded update ops can legitimately match zero under concurrency:

- pending→firing promotion, filter `{ _id, status: 'pending', last_observed_at: { $lt: … } }`
  (`:284-297`) — a concurrent evaluation already promoted it.
- auto-resolve, filter `{ _id, is_open: true, last_observed_at: { $lt: … } }` (`:341-361`) — a
  concurrent writer advanced the observation, or a human resolved it via `PATCH /alerts/[id]`.

Required:

1. Capture the `BulkWriteResult`.
2. `insertOne` notifications stay confirmed the way they are today: an insert is confirmed
   unless its index is in `failedIndices`.
3. `updateOne` notifications must be confirmed against what actually matched. Use **one**
   follow-up query, the same technique as Task 1b: every op in a run stamps `audit.updated_at`
   with the same `now`, so

   ```ts
   AlertV2.find({ _id: { $in: notifiedUpdateIds }, 'audit.updated_at': now }).select({ _id: 1 }).lean()
   ```

   returns exactly the confirmed set. Query only the ids of update ops that carry a
   notification — silent refresh ops have none and must not be queried. Skip the query entirely
   when that id list is empty.
4. Move every `recordAlert('fired', …)` and `recordAlert('resolved', …)` call to after the
   write, driven by the confirmed set, so the counters match reality.
5. `recordAlertEvaluationDuration` must be recorded on **every** exit path, including when
   `bulkWrite` rethrows at `:392` and when the function returns early at `:100`. Use
   `try { … } finally { recordAlertEvaluationDuration(Date.now() - started); }`.
6. Correct the two now-false comments:
   - `:47-51` — `PendingNotification` is described as "dropped if that op failed", which was
     never true for update ops. Describe what the code now guarantees.
   - `:7-13` — the COST comment must account for the reconciliation query. State the real
     shape: two `find`s, one `bulkWrite`, plus one reconciliation `find` when any update op
     carries a notification, plus one rule-load query on a cache miss. Keep the existing point
     that the count does not scale with batch size — that remains true and is the reason the
     comment exists.

### Tests

- A pending→firing promotion whose update matches zero documents must NOT appear in
  `result.fired` and must NOT increment `alerts_fired_total`. Construct it by advancing
  `last_observed_at` past the batch's value (or promoting the episode) between the evaluator's
  read and its write — spy `AlertV2.bulkWrite` and mutate inside the spy, as in Task 1d.
- An auto-resolve whose update matches zero must NOT appear in `result.resolved`.
- Duration is recorded when `bulkWrite` throws.
- The existing E11000 test at `evaluate.test.ts:306-319` must still pass unchanged.

Verify each new test fails without the corresponding change.

---

## Task 3: Per-rule error boundary in the evaluator

**File:** `lib/alerting/evaluate.ts` (plus a metric if one is needed)

`METRIC_ACCESSORS[rule.metric](reading)` at `:127` is typed as a total
`Record<AlertMetric, fn>`, but `rule.metric` reaches it from a `.lean()` read or a Redis JSON
round trip — neither re-validates. Any value outside `value | anomaly_score | battery_level`
makes this `undefined(reading)` → `TypeError`. `new Types.ObjectId(rule._id)` at `:171` and
`:244` throws `BSONError` on a non-hex string the same way.

The only catch is the outermost wrapper in `lib/alerting/index.ts`, so **one malformed rule
aborts evaluation for every rule, every device, and every reading in the batch** — and since
rules change almost never, for every subsequent batch too. Not transient: permanent, silent,
fleet-wide. Reachable from a seed or migration script writing directly, or a stale cache entry
written before a schema change.

Required:

1. A rule that throws during matching or metric extraction must be skipped, with evaluation
   continuing to the next rule. Scope the boundary so one bad rule cannot take out the batch.
2. Guard the accessor lookup explicitly rather than relying on the catch: if
   `METRIC_ACCESSORS[rule.metric]` is not a function, skip that rule.
3. Guard the two `new Types.ObjectId(rule._id)` conversions so an invalid rule id skips the
   rule instead of aborting the batch.
4. Log each skipped rule with `{ ruleId, ruleName, metric, error }` at `error` level, and count
   it. Add a counter to `lib/monitoring/metrics.ts` if no suitable one exists — follow the
   existing `recordAlert` shape and export it through `lib/monitoring/index.ts`.
5. Do not log once per reading — a fleet-wide bad rule would flood the log. Log at most once per
   rule per evaluation call.

### Tests

- A batch containing one rule with an unknown `metric` and one valid rule: the valid rule still
  fires, and the batch is not aborted.
- A rule with a non-hex `_id`: same expectation.
- The failure counter increments, asserted via `getMetricsSnapshot()`.

Verify each fails without the boundary.

---

## Task 4: Make `for_duration_seconds` symmetric

**File:** `lib/alerting/evaluate.ts`

The new-episode branch decides purely on the rule (`:236`):

```ts
const firesImmediately = (rule.for_duration_seconds ?? 0) === 0;
```

while the promotion branch six lines later uses in-batch elapsed time (`:276-278`):

```ts
const elapsedMs = state.lastObservedAt.getTime() - toDate(existing.breached_since).getTime();
if (elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000) { /* fire */ }
```

So a batch carrying a 120-second continuous breach against a `for_duration_seconds: 60` rule
only opens a `pending` episode and waits for a second request — yet the identical batch fires
immediately if a pending episode happens to already exist. The reduction already computes both
`breachedSince` and `lastObservedAt`, so the two branches can share one predicate.

This is **not** covered by the documented "not a timeline replay" trade-off at `:106-109`: that
decision governs how the batch reduces, and both branches already reduce identically. The
asymmetry is unintended.

Required: the new-episode branch must fire immediately when the batch's own breach span already
satisfies `for_duration_seconds`:

```ts
const elapsedMs = state.lastObservedAt.getTime() - (state.breachedSince as Date).getTime();
const firesImmediately = elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000;
```

Keep `fired_at: now` (not the in-batch timestamp) so it matches the promotion branch.

If Task 2 changed how `state.breachedSince` is narrowed, use whatever that task left in place
rather than reintroducing a cast.

### Tests

- One batch, continuous breach spanning longer than `for_duration_seconds` → alert opens with
  status `firing` and a `fired_at`, and appears in `result.fired`.
- One batch spanning less than `for_duration_seconds` → alert opens `pending`, no `fired_at`,
  not in `result.fired`.
- Boundary: elapsed exactly equal to `for_duration_seconds * 1000` fires (`>=`).
- `for_duration_seconds: 0` still fires immediately (existing behavior preserved).

Verify the first test fails against the current code.

---

## Task 5: Make alerting failures observable

**Files:** `lib/alerting/index.ts`, `app/api/v2/readings/ingest/route.ts`,
`app/api/v2/cron/simulate/route.ts`

`lib/monitoring/metrics.ts:185` states the error counter is "the only signal that alerting has
silently stopped working." That signal is unreachable in production:

- `logger.error` is `console.error` only (`lib/monitoring/logger.ts:124`).
- `captureException` is exported from `@/lib/monitoring` — the same barrel these wrappers
  already import from — and is never called by any alerting code. Repo-wide it is used only in
  `instrumentation.ts` and `app/global-error.tsx`, neither of which sees a swallowed error.
- The counter is a module-level object, so it resets on every serverless cold start.
- `/api/v2/metrics` requires a Clerk admin session (which no Prometheus scraper can present)
  **and** `ENABLE_METRICS=true`, which `example.env:57` ships as `false`.

Net: the evaluator can throw on every batch, ingest keeps returning 201, `alerts_v2` stops
growing, and the only trace is a console line.

Required:

1. Both `safeEvaluateReadings` and `safeSweepStaleAlerts` call
   `captureException(error, { tags: { subsystem: 'alerting' } })` alongside the existing log and
   counter. Keep the wrappers non-throwing — if `captureException` itself can throw, guard it.
2. Both call sites capture the returned result instead of discarding it, and log at `info` when
   `fired.length || resolved.length`, including the affected rule ids and device ids. An alert
   firing is currently the only domain event in the subsystem that is never logged; the rule
   mutation routes already log properly.
3. Do not change either route's response body or status — alerting is not part of their
   contract, and Global Constraint on failure isolation still holds.

### Tests

- `captureException` is called when the evaluator throws, and when the sweep throws.
- The `evaluation_error` counter increments, asserted via `getMetricsSnapshot()`.
- Both write paths still succeed when the evaluator throws (this is the existing isolation
  guarantee — do not regress it).

---

## Task 6: Cron path must evaluate only readings that persisted

**Files:** `app/api/v2/cron/simulate/route.ts`,
`__tests__/integration/api/simulate-cron.integration.test.ts`

`await ReadingV2.bulkInsertReadings(newReadings)` (`:62`) discards its return value.
`bulkInsertReadings` is `insertMany(docs, { ordered: false })` (`models/v2/ReadingV2.ts:399`),
which skips documents that fail validation and returns only those inserted, without throwing.
Line 75 then evaluates the **entire** `newReadings` array — including readings that were never
written — and line 87 reports `count: newReadings.length` as though everything landed.

This is the same class of bug the PR author knowingly parked on the ingest path, but worse: the
ingest path at least computes `batch.length - insertResult.length` into `results.rejected`,
while the cron path has no comparison at all. The cron path carries every reading in the live
deployment.

Required:

1. Capture the return of `bulkInsertReadings` and pass only the inserted subset to
   `safeEvaluateReadings`.
2. Report the true inserted count in the response, and surface a rejected count the way the
   ingest path does.
3. Leave `safeSweepStaleAlerts` receiving the full device set — the sweep's reporting set is
   about which devices were *emitted for*, not which readings persisted.

### Tests

- Mock `bulkInsertReadings` to return a strict subset; assert `safeEvaluateReadings` receives
  only that subset, and the response reports the true count with the rejected remainder.
- The existing cron tests must still pass.

Verify the new test fails against the current code.

---

## Task 7: `verify-indexes` must check the dedup index's shape

**Files:** `scripts/v2/verify-indexes.ts`, `scripts/v2/create-indexes-v2.ts`, plus a new unit test

`checkIndexExists` (`verify-indexes.ts:95-106`) compares key fields and the `unique` flag only —
never `partialFilterExpression`. So a **plain** unique index on `{rule_id, device_id}` passes
verification with a green check.

That index would be catastrophic and silent: it permits exactly one alert document ever per
(rule, device) pair, so the first resolved episode permanently blocks every future episode for
that device — and the evaluator absorbs each resulting E11000 as a benign race
(`evaluate.ts:392-396`). Alerting goes permanently silent for any device that ever alerted once,
with no error and no metric movement. The entire dedup design rests on the partial filter, and
it is the one property the verifier cannot see.

`create-indexes-v2.ts` closes no part of this: it skips purely by name (`:264`), so a
pre-existing mis-shaped `rule_device_open_unique` prints `⏭️ [SKIP]` and is never corrected.

Required:

1. `ExpectedIndex` gains an optional `partialFilterExpression`. `checkIndexExists` compares it
   against the live index (order-insensitive structural equality) and fails on mismatch,
   including the case where one side has a filter and the other does not.
2. The alerts dedup entry (`verify-indexes.ts:53-58`) declares
   `partialFilterExpression: { is_open: true }`.
3. Note that the current field comparison is a subset match, so `rule_device_resolved_at`
   satisfies `rule_device_open_unique`'s field check and only the `unique` flag separates them.
   Make the key comparison exact (same fields, same order) so the two cannot be confused.
4. `create-indexes-v2.ts`: when an index with the expected name already exists but its shape
   differs (keys, `unique`, or `partialFilterExpression`), it must report a loud mismatch rather
   than `[SKIP]`, and the script must exit non-zero. **Do not auto-drop** — dropping a unique
   index against production data is not a decision a script should make unattended. Print the
   exact `db.collection.dropIndex(...)` / re-run instruction instead.
5. Extract `checkIndexExists` (and any comparison helper) as named exports so they are unit
   testable without a live database.

### Tests

New unit test file under `__tests__/unit/` covering `checkIndexExists`:

- A plain unique index on `{rule_id, device_id}` is REJECTED when the expectation declares
  `partialFilterExpression: { is_open: true }`.
- The correct partial unique index is ACCEPTED.
- An index with the right filter but `unique: false` is REJECTED.
- `rule_device_resolved_at` does not satisfy the `rule_device_open_unique` expectation.

Verify the first test fails against the current `checkIndexExists`.

---

## Task 8: Make the client-facing wire contract true

**Files:** `types/v2/alert.types.ts`, `app/api/v2/alerts/route.ts`,
`app/api/v2/alerts/[id]/route.ts`, `app/api/v2/alert-rules/route.ts`,
`app/api/v2/alert-rules/[id]/route.ts`

Nothing in the repo references `AlertV2Response`, `AlertRuleV2Response`, `CreateAlertRuleBody`,
`UpdateAlertRuleBody`, `ListAlertsQueryParams`, or `AlertEvent` — every occurrence is the
definition or the barrel re-export in `types/v2/index.ts`. Because no route is typed against
them, they are unverified prose, and they have already drifted. Tasks 12–20 will build the
client against these types, so they must be correct before that starts.

Required:

1. **Fix the false header claim.** `types/v2/alert.types.ts:4-5` states
   "`lib/pusher-context.tsx` imports AlertEvent from this file." That file contains zero
   occurrences of "alert". State that it is consumed once Task 13/14 lands.
2. **Fix `UpdateAlertRuleBody`.** It is `Partial<CreateAlertRuleBody>`, which permits
   `{ threshold: 5 }` — a request `updateAlertRuleSchema` always rejects, because
   `{metric, comparison, threshold, selector}` must move as an atomic group
   (`lib/validations/v2/alert-rule.validation.ts:144-154`). Model that group so a partial
   condition is not expressible.
3. **Fix `CreateAlertRuleBody`.** `selector` is optional in the type but required and non-empty
   when `metric === 'value'` (`alert-rule.validation.ts:64-67`). Model the per-metric shape as a
   discriminated union on `metric`, so the two states the schema always rejects become
   unrepresentable. Threshold bounds (`anomaly_score` ∈ [0,1], `battery_level` ∈ [0,100]) stay
   in Zod — TypeScript has no refinement types — but document them on the union arms.
4. **Account for `__v`.** It ships in every alert and alert-rule response and appears in no wire
   type. Strip it at the response boundary in all four route files rather than adding it to the
   contract: `.lean()` reads get a `__v: 0` projection or equivalent, `.toObject()` calls use
   `{ versionKey: false }`. Keep using `jsonSuccess`/`jsonPaginated`.
5. **Fix the false caching rationale.** `app/api/v2/alerts/route.ts:11-12` justifies not caching
   because the list "is already pushed over Pusher". Nothing publishes alerts over Pusher — both
   call sites discard the evaluator's result. The decision not to cache may still be right;
   restate it on a true premise.
6. **Defuse the `actor` privacy trap.** `types/v2/alert.types.ts:171` requires `actor` to be the
   Clerk **user ID**, "Never an email — this payload reaches every connected client." But the
   manual-resolve handler has `auditUser` in scope (`app/api/v2/alerts/[id]/route.ts:147-148`),
   and `getAuditUser` is `user?.email || userId` (`lib/auth/index.ts:262`) — the email whenever
   one exists. Whoever wires Task 13 will reach for the variable that is already there and
   broadcast admin emails to every browser. Make the comment name `userId` from `requireAdmin()`
   explicitly as the value to use, and say plainly that `auditUser`/`getAuditUser` must not be
   used for this field.

`ResolvedAlert.resolution` includes `'manual'`, which that payload can never carry today (no
manual path broadcasts). Leave the union as-is — Task 13 will use it — but note the gap in your
report rather than changing it.

### Tests

Type-level correctness is enforced by `tsc`, so the runnable coverage here is the `__v` change:
assert in the alert and alert-rule integration tests that responses do not carry `__v`. Verify
those assertions fail against the current code.

---

## Task 9: Close the write-path integration test gaps

**Files:** `__tests__/integration/api/readings-ingest.integration.test.ts`,
`__tests__/integration/api/simulate-cron.integration.test.ts`,
`__tests__/integration/api/alerts.integration.test.ts`,
`__tests__/integration/api/alert-rules.integration.test.ts`

Mutation testing against the current suite found these behaviors have **no** covering test —
each mutation below broke zero of 2201 tests.

### 9a. Selector matching is never wired-verified on either write path

The PR widens the device projection on both write paths specifically so selectors work
(`readings/ingest/route.ts:149` and `cron/simulate/route.ts:46`, both adding `type`, `location`,
`metadata.tags`). Reverting both projections to their pre-PR shape breaks zero tests, because
both existing write-path alerting tests use `selector: { types: ['temperature'] }`, which needs
no device fields at all. A projection regression would silently disable every building, floor,
zone, and tag-scoped rule in the deployment.

Add to **each** write path: a rule whose selector uses `building_id`, `floor`, `zone`, and
`tags` against a device carrying those exact values — assert the alert fires. Add the negative
twin (a device on a different floor) so the test proves matching rather than mere field
presence.

**Mutation to verify against:** revert both projections to `{ _id: 1 }` (ingest) and
`{ _id: 1, type: 1, location: 1 }` (cron); both new tests must FAIL.

### 9b. Cron-path failure isolation is untested

`readings-ingest.integration.test.ts:1324` covers the ingest path well — it asserts
`expect(spy).toHaveBeenCalledTimes(1)` to prove the rejection was actually reached. The cron
path has no equivalent, and it is the only caller of `safeSweepStaleAlerts`, so a throwing sweep
is uncovered anywhere. Pointing the cron route at the raw throwing `evaluateReadings` /
`sweepStaleAlerts` instead of the `safe*` wrappers breaks zero tests.

Add two tests to the cron suite: spy `evaluateReadings` (then `sweepStaleAlerts`) to reject;
assert the response is 200, assert `ReadingV2.countDocuments()` matches the emitted device
count, and assert the spy was called.

### 9c. RBAC is untested on two endpoints

The guards are present and correct in code on all eight endpoints — this is a test gap, not a
security hole. But removing `requireOrgMembership()` from `app/api/v2/alerts/[id]/route.ts:46`
and `app/api/v2/alert-rules/[id]/route.ts:48` breaks zero tests, so a future refactor could drop
either silently.

Add member-role coverage for `GET /alerts/[id]` and `GET /alert-rules/[id]`. Also add
unauthenticated coverage — `mockAuthAsUnauthenticated` already exists in
`__tests__/setup/auth-helpers.ts:58` and is used elsewhere in the repo, but neither new test
file imports it.

Verify each new test fails against the corresponding mutation.

---

## Task 10: Close the evaluator and model test gaps

**Files:** `__tests__/unit/lib/alerting/evaluate.test.ts`, `__tests__/unit/models/AlertV2.test.ts`,
`__tests__/integration/api/alerts.integration.test.ts`,
`__tests__/integration/api/alert-rules.integration.test.ts`

Same mutation-testing source as Task 9.

### 10a. The cost guarantee has no test

`evaluate.ts:6-13` states the module's central design property — constant query count regardless
of batch size. Inserting an O(pairs) query loop breaks zero tests.
`evaluate.test.ts:321-341` is named "should handle a fleet-wide rule across many devices in one
write" but only asserts `bulkWrite` was called once; it never counts `AlertV2.find` and never
varies the batch size.

Add a two-point comparison: spy `AlertV2.find`, run with 1 reading / 1 device, record the call
count; reset; run with 500 readings / 50 devices; assert the count is **identical**.

Note: Task 2 adds a conditional reconciliation query. Write this test against whatever the
post-Task-2 shape is — the invariant under test is that the count does not vary with batch
size, not that it equals a specific number.

### 10b. Out-of-order readings can destroy a live pending episode

`evaluate.ts:222` is the only protection on the pending-delete path — the `deleteOne` at `:334`
carries no `last_observed_at` guard, unlike every update op around it. Removing line 222 breaks
zero of 192 alerting tests. The existing test at `evaluate.test.ts:224-235` does not cover it:
that scenario is a *breaching* reading against a *firing* episode, where the DB-level filter
masks the guard's absence.

Add the discriminating test:

```
rule: for_duration_seconds 600, threshold gt 30
evaluate([reading(35, 12:10)])  -> opens pending, last_observed_at = 12:10
evaluate([reading(20, 12:00)])  -> stale non-breach arrives late
assert result.pendingCleared === 0
assert AlertV2.countDocuments({ status: 'pending' }) === 1
```

**Mutation to verify against:** delete line 222; the test must FAIL.

### 10c. Alerting metrics are wired to nothing that is tested

Commenting out all seven `recordAlert` / `recordAlertEvaluationDuration` calls across
`lib/alerting/` breaks zero of 2201 tests. `__tests__/unit/lib/metrics.test.ts` tests the
recorder functions in isolation; nothing tests the callers.

Assert via `getMetricsSnapshot()` that `alerts_fired_total` and `alerts_resolved_total` increment
on a real fire and a real resolve, and that `alert_evaluation_errors_total` increments in the
`safeEvaluateReadings` and `safeSweepStaleAlerts` error tests.

Note: Task 2 moves these calls after the write and reconciles them. Write these assertions
against the post-Task-2 behavior — counters must reflect **confirmed** transitions.

### 10d. Index-enforced dedup is proven only at the model layer

Dropping the partial unique index fails exactly one test
(`__tests__/unit/models/AlertV2.test.ts:48`), which builds documents by hand.
`evaluate.test.ts:155` ("should not open a second episode while one is already open") still
passes — it exercises the in-memory `openByPair` map, not the index.

That matters because `lib/alerting/rule-cache.ts:24-32` documents the exact failure mode: a
string `rule_id` would not collide with ObjectId-typed documents and the partial unique index
would silently stop deduplicating.

Add: `await AlertV2.init()`, then two concurrent `evaluateReadings` calls on the same fresh
breaching pair; assert `countDocuments({ is_open: true }) === 1` and that the stored `rule_id`
is a `Types.ObjectId`, not a string.

### 10e. List sort and filter branches are uncovered

Collapsing both `SORT_FIELD_MAP`s (`alerts/route.ts:33`, `alert-rules/route.ts:29`) to `{}`
breaks zero tests — every `sortBy` would silently fall back to `audit.created_at`. Also
uncovered on `GET /api/v2/alerts`: the `rule_id` filter (`:76`) and the multi-value `$in`
branches for `status` (`:68`) and `severity` (`:72`).

Add coverage for each. While doing so, note in your report that `sortBy=severity` sorts
lexically, so descending yields `warning → info → critical` — almost certainly not what a user
asking for "most severe first" expects. Do **not** change that behavior in this task; surface it
so it can be decided separately.

---

## Out of scope

Deliberately excluded — these were reported but are not part of this plan:

- The unbounded `AlertV2.find({ is_open: true })` in the sweep beyond the projection in Task 1c.
- Redis-less deployments turning the rule cache into a per-call query, and cache stampede
  protection.
- `GET /api/v2/alerts?status=pending` returning an empty 200 rather than rejecting.
- `STALE_AFTER_SECONDS` validation and documentation.
- Dead `RuleBuckets.maxCooldownSeconds` / `ruleCount`.
- `compare()`'s `default: return false` discarding exhaustiveness.
- `EvaluableDevice` modelling the document rather than the projection.
- Rule lifecycle: disabled or soft-deleted rules leaving open alerts to be swept as `stale`.
- The `CLAUDE.md` endpoint count (still says 25; it is 33).
- The parked `validReadings` issue on the ingest path (the author's documented decision).
