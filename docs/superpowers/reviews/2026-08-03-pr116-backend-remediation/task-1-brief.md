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

