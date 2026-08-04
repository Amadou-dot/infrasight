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
