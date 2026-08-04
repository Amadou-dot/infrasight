# Task 10 Report: Close the evaluator and model test gaps

Branch: `feat/phase-4-alerting`, starting at `b2d1c39`.

## Summary

Added 9 new tests across 4 files, closing 10a, 10b, 10d, and 10e as specified in the
brief (adjusted for line drift from the nine intervening commits), plus one gap in 10c
that the brief flagged as uncertain and that turned out to be real (sweep's own
`recordAlert('resolved', ...)` call site). The rest of 10c was already fully covered
and non-vacuous — verified, not just trusted. No source file was changed to make any
test pass; two source files were edited only transiently, for mutation verification,
and reverted before the final run. Full node project: **2272 passing / 85 suites**
(2263 baseline + 9). tsc: 39 errors, byte-identical list to baseline. ESLint: 311
problems, byte-identical output to baseline.

## What was added

| # | File | Test |
|---|------|------|
| 10a | `__tests__/unit/lib/alerting/evaluate.test.ts` | `should keep the AlertV2.find call count constant regardless of batch size` |
| 10b | `__tests__/unit/lib/alerting/evaluate.test.ts` | `should not delete a live pending episode when a stale non-breaching reading arrives out of order` |
| 10c (gap) | `__tests__/unit/lib/alerting/sweep.test.ts` | `should increment alerts_resolved_total on a real sweep resolve` |
| 10d | `__tests__/unit/lib/alerting/evaluate.test.ts` | `should let the partial unique index — not the in-memory map — dedupe two concurrent evaluateReadings calls` |
| 10e | `__tests__/integration/api/alerts.integration.test.ts` | `should filter by rule_id` |
| 10e | `__tests__/integration/api/alerts.integration.test.ts` | `should accept a comma-separated status list via the $in branch` |
| 10e | `__tests__/integration/api/alerts.integration.test.ts` | `should accept a comma-separated severity list via the $in branch` |
| 10e | `__tests__/integration/api/alerts.integration.test.ts` | `should sort by severity, not silently fall back to created_at` |
| 10e | `__tests__/integration/api/alert-rules.integration.test.ts` | `should sort by name, not silently fall back to created_at` |

No test was added to `__tests__/unit/models/AlertV2.test.ts` — the file is one of the
four the brief names as in-scope, but 10d's own scenario ("two concurrent
evaluateReadings calls") exercises the evaluator, not the model in isolation, so its
test lives in `evaluate.test.ts` next to the model-layer test it complements
(`AlertV2.test.ts:48`, unchanged).

## Brief verification: what changed since it was written

Confirmed by reading current code rather than trusting the brief's line numbers:

- **10a**: `evaluate.ts:6-13`'s COST comment now says "two `find`s and one bulk write,
  plus one reconciliation `find` when any update op carries a notification, plus one
  rule-load query on a cache miss" — this is the post-fd1966d shape. The existing
  "fleet-wide" test (`evaluate.test.ts:605`, now `:605-625`) still only asserts
  `bulkWrite` call count, never `AlertV2.find`, never varies batch size. Gap confirmed
  as described.
- **10b**: the guard is now at `evaluate.ts:314` (`if (existing && state.lastObservedAt
  <= toDate(existing.last_observed_at)) continue;`), not `:222`. Confirmed via `grep -n`
  that it is still the only guard on the pending-delete path — the `deleteOne` at
  `:439` (`push({ deleteOne: { filter: { _id: existing._id, status: 'pending' } } })`)
  still carries no `last_observed_at` predicate.
- **10c**: partly already covered, as the brief warned, but *more* was already covered
  than the brief's own "may still be missing" hedge suggested — see below.
- **10d**: unchanged and valid, with one correction — see below.
- **10e**: unchanged and valid. Line numbers moved (`alerts/route.ts` `SORT_FIELD_MAP`
  now at `:40`, `rule_id` filter at `:83`, `status`/`severity` `$in` branches at
  `:75`/`:79`); `alert-rules/route.ts`'s `SORT_FIELD_MAP` at `:29` matched exactly
  (that file wasn't touched by the intervening commits).

## 10c: what was already covered, and the one real gap

Checked before writing anything, per the brief's explicit instruction not to duplicate.

**Already covered, verified non-vacuous:**
- `alerts_fired_total` on a real fire — `evaluate.test.ts:116`, added by commit
  `746112d`.
- `alerts_resolved_total` on a real auto-resolve — `evaluate.test.ts:245`, added by
  `746112d`.
- `alert_evaluation_errors_total` (`getMetricsSnapshot().alerts.evaluationErrors`) in
  **both** the `safeEvaluateReadings` and `safeSweepStaleAlerts` error tests —
  `sweep.test.ts:327` and `:360`, added by commit `2879d08` (predates `746112d`). The
  brief said this "may still be missing"; it is not. I verified this is real coverage,
  not a coincidence: commenting out both `recordAlert('evaluation_error')` calls in
  `lib/alerting/index.ts` made both tests fail exactly on `expect(alerts
  .evaluationErrors).toBe(1)` (`Expected: 1, Received: 0`) — see the Verification
  section. I did not add anything for this; it would have been a duplicate.

**Gap found and closed:** `lib/alerting/sweep.ts:136` has its own, independent
`recordAlert('resolved', { resolution: alert.resolution })` call, inside `if
(resolveCandidates.length > 0)`. This is a *different* call site than evaluate.ts's —
resolving via the staleness sweep, not via an evaluator auto-resolve. Nothing in the
suite asserted on it: `grep -rn "alerts_resolved_total\|alertsResolved" __tests__/`
before my change hit only `evaluate.test.ts` and `metrics.test.ts` (which tests
`recordAlert` in isolation, not a caller). This matches the brief's original framing of
10c precisely ("nothing tests the callers") for this one call site specifically. Closed
with a new test in `sweep.test.ts` — see Verification.

The brief describes "seven `recordAlert`/`recordAlertEvaluationDuration` calls." As of
the current code there are six (`index.ts` x2, `sweep.ts` x1, `evaluate.ts` x3:
fired/resolved/duration) plus a *separate* counter family, `recordAlertRuleSkipped`
(added by `84eb30c`, after the brief), which is already covered by three tests in the
"per-rule error boundary" block. The discrepancy is explained by the intervening
commits reshaping the call sites; every current call site has positive coverage after
this task (six for the recordAlert/duration family, three for rule-skip).

## 10d: one correction to the brief's assumption

The brief asks to assert the stored `rule_id` "is a `Types.ObjectId`, not a string,"
implying the natural mutation is swapping the evaluator's write-site variable
(`state.ruleObjectId`, the pre-parsed ObjectId) for the raw `rule._id` (a string, per
`CachedAlertRule`). I tried exactly that mutation first and **it does not discriminate**:
Mongoose's `Model.bulkWrite()` casts `insertOne.document` fields against the schema
before sending to MongoDB, so a raw hex string written as `rule_id` still lands in the
database as a real `ObjectId` — confirmed by bypassing Mongoose's read-side casting too
(`AlertV2.collection.findOne(...)`, the raw driver, not the Mongoose query layer) and
seeing `new ObjectId(...)` in the raw document. Evaluate.ts's choice of
`state.ruleObjectId` over `rule._id` at that specific call site is good practice
(avoids a redundant parse, and is what protects the `$in` query construction, which
has no such casting safety net for an *invalid* string) — but it is not, by itself,
what keeps `rule_id` typed correctly in storage. Mongoose's own schema casting is a
second, independent layer that already covers the write site.

The assertion still has real value and is not vacuous — it just discriminates a
different mutation than the brief implied: changing the **schema's** field type
(`models/v2/AlertV2.ts`, `rule_id: { type: Schema.Types.ObjectId, ... }` →
`{ type: String, ... }`) makes it fail correctly, while the dedup (`countDocuments`)
assertion stays green (MongoDB can still enforce a unique index on a consistently-typed
string field). I verified the test against this corrected mutation instead — see
Verification. I did not change any source file to do this; both mutations were applied
and reverted for verification only.

## 10e: the `sortBy=severity` oddity

Confirmed and surfaced, not fixed, per the brief's instruction. `severity` has no
rank comparator — `SORT_FIELD_MAP` points it straight at the string field, so Mongo
sorts it lexically. Descending gives `warning → info → critical` (`'c' < 'i' < 'w'`,
so `critical` sorts *last* descending). A user asking for "most severe first" almost
certainly means `critical` first. The new `alerts.integration.test.ts` test
(`should sort by severity, not silently fall back to created_at`) documents and locks
in this exact behavior with an explanatory comment, without changing it. This is a
product decision (would need a `{critical: 0, warning: 1, info: 2}` rank map, likely
via `$addFields`/aggregation rather than a plain `.sort()`), left for separate triage.

## Verification (mutation → fail → revert → pass) for every test added

All commands run from `/home/yzel/github/infrasight-phase4`. Every mutation was applied
directly to the source file with Edit, run against the specific new test with
`-t "<name>"`, confirmed to fail **for the intended reason** (not a setup/import/crash
error), then reverted and reconfirmed green. `git diff --stat` on the source file was
checked empty after every revert.

### 10a — `should keep the AlertV2.find call count constant regardless of batch size`

**Mutation:** inserted an O(pairs) query loop in `evaluate.ts` right after
`if (pairs.size === 0) return emptyEvaluationResult();`:
```ts
for (const state of pairs.values()) {
  await AlertV2.find({ _id: state.ruleObjectId }).lean();
}
```
**Failing output:**
```
expect(received).toBe(expected) // Object.is equality
Expected: 2
Received: 51
  > 693 |     expect(largeBatchCalls).toBe(smallBatchCalls);
```
Intended reason confirmed: 2 = 1 real call + 1 loop iteration (1-device batch); 51 = 1
real call + 50 loop iterations (50-device batch, one pair per device since all 10
readings per device reduce to one pair). The failure is exactly the batch-size-scaling
signal the test exists to catch.

**Passing output (after revert):**
```
Tests:       39 skipped, 1 passed, 40 total
```

### 10b — `should not delete a live pending episode when a stale non-breaching reading arrives out of order`

**Mutation:** removed `evaluate.ts:314`
(`if (existing && state.lastObservedAt <= toDate(existing.last_observed_at)) continue;`).

**Failing output:**
```
expect(received).toBe(expected) // Object.is equality
Expected: 0
Received: 1
  > 250 |     expect(result.pendingCleared).toBe(0);
```
Intended reason confirmed: with the guard gone, the stale non-breaching reading reaches
the `status === 'pending'` branch and queues the unguarded `deleteOne`, which lands and
destroys the live episode — `pendingCleared` becomes 1 instead of 0, exactly the
destructive scenario the brief describes.

**Passing output (after revert):**
```
Tests:       39 skipped, 1 passed, 40 total
```

### 10c gap — `should increment alerts_resolved_total on a real sweep resolve`

**Mutation:** commented out `sweep.ts:136`
(`for (const alert of resolved) recordAlert('resolved', { resolution: alert.resolution });`).

**Failing output:**
```
expect(received).toBe(expected) // Object.is equality
Expected: 1
Received: undefined
  > 78 |     expect(resolvedCounts.device_inactive).toBe(1);
```
Intended reason confirmed: the sweep still resolves the alert correctly
(`result.resolved` still length 1, unaffected — the mutation only removed the metrics
call, not the resolve logic), but the counter never moves. `undefined` (never
incremented) vs. `1` is exactly the "metric wired to nothing" failure mode.

**Passing output (after revert):**
```
Tests:       17 skipped, 1 passed, 18 total
```

**Also verified (pre-existing coverage, not newly added):** commented out both
`recordAlert('evaluation_error')` calls in `lib/alerting/index.ts`. Both
`safe wrappers` tests failed exactly on `expect(alerts.evaluationErrors).toBe(1)`
(`Received: 0`), confirming that coverage is real, not coincidental. Reverted; `git
diff --stat` empty afterward.

### 10d — `should let the partial unique index — not the in-memory map — dedupe two concurrent evaluateReadings calls`

Two independent assertions, two independent mutations.

**Mutation A (dedup count):** `models/v2/AlertV2.ts`, the partial index's
`unique: true` → `unique: false`.

**Failing output:**
```
expect(received).toBe(expected) // Object.is equality
Expected: 1
Received: 2
  > 828 |       expect(await AlertV2.countDocuments({ is_open: true })).toBe(1);
```
Intended reason confirmed: without the unique constraint, both the nested "concurrent"
call's insert and the outer call's insert succeed, leaving two open episodes for the
same (rule, device) pair — the exact failure the partial unique index exists to
prevent, with the in-memory per-call map (`openByPair`) unable to help since it can't
see across two separate function invocations.

*(Assertion order note: I initially had a `result.fired` sanity check before the
`countDocuments` assertion; under this same mutation it failed first, at
`expect(result.fired).toHaveLength(0)` — a real but less direct signal. I reordered so
the brief's two required assertions are checked first, then reran this mutation to
confirm the failure lands exactly on `countDocuments`, as shown above.)*

**Passing output (after revert):**
```
Tests:       39 skipped, 1 passed, 40 total
```

**Mutation B, attempt 1 (rule_id type, write-site variable swap) — did NOT discriminate:**
`evaluate.ts:344`, `rule_id: state.ruleObjectId` → `rule_id: rule._id as unknown as
Types.ObjectId` (the raw string). Test still **passed**. Investigated why (see the 10d
correction section above): Mongoose's `bulkWrite` casts `insertOne.document` against
the schema regardless of the JS-level type passed in, confirmed by reading the raw
driver document (`AlertV2.collection.findOne(...)`, bypassing Mongoose's own query
casting) and seeing `rule_id: new ObjectId(...)`. Reverted (`git diff --stat` empty).

**Mutation B, attempt 2 (rule_id type, schema-level) — discriminates correctly:**
`models/v2/AlertV2.ts`, `rule_id: { type: Schema.Types.ObjectId, required: true }` →
`rule_id: { type: String, required: true }`.

**Failing output:**
```
expect(received).toBeInstanceOf(expected)
Expected constructor: ObjectId
Received value has no prototype
Received value: "6a719d3e9400de7c81fb79b3"
  > 830 |       expect(stored!.rule_id).toBeInstanceOf(Types.ObjectId);
```
Intended reason confirmed: `countDocuments({is_open:true})` stayed at 1 (MongoDB can
still enforce a unique index on a consistently-typed string field), isolating the
failure to exactly the type assertion — the assertion fails on the right thing, for the
mutation that actually breaks it.

**Passing output (after revert):**
```
Tests:       39 skipped, 1 passed, 40 total
```

### 10e — `should filter by rule_id`

**Mutation:** `app/api/v2/alerts/route.ts`, removed
`if (query.rule_id) filter.rule_id = query.rule_id;`.

**Failing output:**
```
expect(received).toHaveLength(expected)
Expected length: 1
Received length: 2
  > 113 |       expect(body.data).toHaveLength(1);
```
Intended reason confirmed: both alerts (different `rule_id`s) came back unfiltered —
exactly what dropping the filter predicts.

**Passing output (after revert):** `Tests: 32 skipped, 1 passed, 33 total`

### 10e — `should accept a comma-separated status list via the $in branch`

**Mutation:** `app/api/v2/alerts/route.ts:75`, `filter.status = statuses.length === 1
? statuses[0] : { $in: statuses }` → `filter.status = statuses[0]`.

**Failing output:**
```
expect(received).toEqual(expected) // deep equality
- Expected  - 1
+ Received  + 0
  Array [
    "device_acked",
-   "device_resolved",
  ]
```
Intended reason confirmed: only the first of the two requested statuses matched —
exactly the single-value-equality regression this test exists to catch.

**Passing output (after revert):** `Tests: 32 skipped, 1 passed, 33 total`

### 10e — `should accept a comma-separated severity list via the $in branch`

**Mutation:** same pattern, `filter.severity = severities.length === 1 ?
severities[0] : { $in: severities }` → `filter.severity = severities[0]`.

**Failing output:**
```
expect(received).toEqual(expected) // deep equality
- Expected  - 1
+ Received  + 0
  Array [
    "device_crit",
-   "device_info",
  ]
```
Intended reason confirmed, same shape as the status case.

**Passing output (after revert):** `Tests: 32 skipped, 1 passed, 33 total`

### 10e — `should sort by severity, not silently fall back to created_at`

**Mutation:** `app/api/v2/alerts/route.ts`, `SORT_FIELD_MAP` collapsed to `{}`.

**Failing output:**
```
expect(received).toEqual(expected) // deep equality
  Array [
-   "device_warn",
    "device_info",
    "device_crit",
+   "device_warn",
  ]
  > 214 |       expect(body.data.map(a => a.device_id)).toEqual(['device_warn', 'device_info', 'device_crit']);
```
Intended reason confirmed: the order fell back to `audit.created_at desc`
(`info, critical, warning` by device_id — the three alerts' actual created_at order,
newest first) instead of severity-lexical-desc, exactly the silent-fallback the test
exists to catch.

**Passing output (after revert):** `Tests: 32 skipped, 1 passed, 33 total`

### 10e — `should sort by name, not silently fall back to created_at` (alert-rules)

**Mutation:** `app/api/v2/alert-rules/route.ts`, `SORT_FIELD_MAP` collapsed to `{}`.

**Failing output:**
```
expect(received).toEqual(expected) // deep equality
  Array [
+   "Charlie",
    "Alpha",
    "Bravo",
-   "Charlie",
  ]
  > 116 |       expect(body.data.map(r => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
```
Intended reason confirmed: `[Charlie, Alpha, Bravo]` is the `audit.created_at`
ascending order (the test explicitly passes `sortDirection: 'asc'`, so the fallback
direction is also ascending) — the field mapping fell back to `created_at` while
direction stayed correct, precisely the SORT_FIELD_MAP-collapse signature.

**Passing output (after revert):** `Tests: 29 skipped, 1 passed, 30 total`

## Full-suite confirmation

- Focused pattern from the brief:
  `npx jest --selectProjects node --testPathPatterns "unit/lib/alerting|unit/models/AlertV2|integration/api/(alerts|alert-rules)"`
  → **7 suites, 172 tests, all passing.**
- Full node project: `npx jest --selectProjects node` →
  **85 suites, 2272 tests, all passing** (2263 baseline + 9 new = 2272, exact match,
  no unexplained deltas).
- `npx tsc --noEmit`: **39 errors**, `diff` against the pre-change output is empty
  (byte-identical error list).
- `npx eslint .`: **311 problems** (308 errors, 3 warnings), `diff` against the
  pre-change output is empty (byte-identical).
- `git status --short` before commit shows only the four test files touched; every
  `lib/`, `models/`, and `app/api/` file is clean.

## Did this need a source change?

No. Every mutation applied to `lib/alerting/evaluate.ts`, `lib/alerting/sweep.ts`,
`lib/alerting/index.ts`, `models/v2/AlertV2.ts`, `app/api/v2/alerts/route.ts`, and
`app/api/v2/alert-rules/route.ts` during this task was applied solely to *verify* a
test discriminates correctly, and was reverted immediately after. The committed diff
touches only test files.

## Files changed

- `__tests__/unit/lib/alerting/evaluate.test.ts` (+120: `Types` import, 10b, 10a, 10d)
- `__tests__/unit/lib/alerting/sweep.test.ts` (+20: 10c gap)
- `__tests__/integration/api/alerts.integration.test.ts` (+119: 10e x4)
- `__tests__/integration/api/alert-rules.integration.test.ts` (+30: 10e x1)

No files under `lib/`, `models/`, or `app/api/` are part of the committed diff.

## Self-review (fresh eyes)

- **Could any test pass for the wrong reason?** Checked each for a "trivially 0"
  failure mode. 10a's `largeBatchCalls === smallBatchCalls` could theoretically pass
  vacuously at `0 === 0` if evaluation silently no-op'd; guarded against with
  `expect(smallBatchCalls).toBeGreaterThan(0)` and `expect(result.fired)
  .toHaveLength(50)`. 10b's `pendingCleared === 0` could pass vacuously if the first
  call never created anything; guarded by the brief's own required
  `countDocuments({status:'pending'}) === 1` assertion, which I kept. 10d's dedup count
  could pass vacuously if the two calls never actually raced (e.g., if the second call
  saw the first's committed write and just updated); the nested call's own `nested
  .fired` is asserted to be length 1 *inside* the race, and the outer's `result.fired`
  is asserted to be 0, positively confirming both branches of the race actually
  happened, not just the final count.
- **Any assertion on a mock where real behavior was available?** 10a spies on
  `AlertV2.find` and asserts on the spy's call count — this is intentional and
  necessary (an internal query-count/cost property has no user-visible proxy; this
  matches the existing `bulkSpy.toHaveBeenCalledTimes(1)` pattern already in the
  file). 10d spies on `bulkWrite` only to construct deterministic interleaving
  (injecting a full nested `evaluateReadings` call between the outer call's read and
  write); every assertion in that test is against real state
  (`countDocuments`, `findOne().lean()`, `result.fired`, `nested.fired`), never against
  the spy itself. No other new test touches a mock.
- **10d's concurrency mechanism.** The brief says "two concurrent evaluateReadings
  calls." I used a deterministic `bulkWrite` interception (run a full nested
  `evaluateReadings()` call between the outer call's `find` and `bulkWrite`) rather
  than `Promise.all([evaluateReadings(...), evaluateReadings(...)])`. I considered the
  latter and rejected it: nothing guarantees both calls' `find()`s land before either
  `bulkWrite()` commits — if the timing didn't cooperate, the second call's `find`
  would see the first's already-committed episode and take the update branch instead
  of attempting a second insert, and the test would pass whether or not the partial
  unique index still existed (i.e., it would sometimes not test the thing at all). The
  deterministic version guarantees the race every run, matches this file's own
  established idiom for every other race test, and produces the exact same observable
  scenario (two independent invocations, neither able to see the other's uncommitted
  write via the in-memory `openByPair` map).
- **Order of assertions.** Found and fixed one real issue during self-review: 10d
  originally asserted `result.fired` before the brief's two required assertions, which
  meant the "drop the unique index" mutation was caught by the wrong (supporting)
  assertion first, masking whether the primary assertion actually discriminated. Caught
  this by re-running the same mutation after reordering and confirming the failure
  moved to the intended assertion (see 10d Mutation A above).
- **10d's second assertion, corrected.** The "obvious" mutation for `rule_id
  instanceof Types.ObjectId` (swap the evaluator's write-site variable) turned out not
  to discriminate at all, because Mongoose's `bulkWrite` casts against the schema
  independent of the evaluator's own choice of variable. Verified this by bypassing
  Mongoose's own casting on the read side too (raw driver `.collection.findOne`), so
  this isn't "the test happened not to catch it" — the mutation is genuinely
  neutralized one layer down. Found the schema-level mutation that does discriminate
  and used that instead. Documented both attempts in this report rather than silently
  picking the one that worked, since the discrepancy from the brief's implied mechanism
  is itself useful information.

## Concerns

None blocking. Two things worth flagging for whoever reads this next:

1. The `rule_id instanceof Types.ObjectId` protection in `evaluate.ts` (using
   `state.ruleObjectId` instead of re-deriving from `rule._id` at write time) is
   currently redundant with Mongoose's own schema casting on `bulkWrite`. That's
   fine — defense in depth — but it means `rule-cache.ts:24-32`'s comment ("Writing
   that straight into `AlertV2.rule_id` would produce documents whose `rule_id` type
   depends on cache state") is not quite accurate for the *current* write path
   specifically (it's accurate for a hypothetical write path that bypassed Mongoose's
   casting, e.g. a raw driver call). Not something this task's scope covers changing,
   just flagging the comment slightly overstates the current single point of failure.
2. `sortBy=severity` sorting lexically rather than by severity rank is now locked in by
   a test, per the brief's instruction to surface rather than fix it. Whoever triages
   this should know the fix is not a one-line change — MongoDB's plain `.sort()`
   can't apply a custom rank ordering; it would need an aggregation pipeline stage
   (e.g. `$addFields` with a `$switch` mapping severity to a rank) ahead of the sort.
