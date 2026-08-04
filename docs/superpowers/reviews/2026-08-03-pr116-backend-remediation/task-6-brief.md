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

