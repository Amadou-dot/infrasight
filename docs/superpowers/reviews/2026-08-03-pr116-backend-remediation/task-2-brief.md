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

