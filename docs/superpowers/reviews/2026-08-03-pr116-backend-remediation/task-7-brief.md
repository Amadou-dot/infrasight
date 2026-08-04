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

