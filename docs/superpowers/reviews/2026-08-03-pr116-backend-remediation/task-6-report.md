# Task 6 Report: Cron path must evaluate only readings that persisted

Branch `feat/phase-4-alerting`, worktree `/home/yzel/github/infrasight-phase4`.
Started at `0a5c7aa`. Commit: `2480e01`.

## What I implemented

### Item 1 — capture the inserted subset, pass it to `safeEvaluateReadings`

`app/api/v2/cron/simulate/route.ts`:

```ts
const insertedReadings = await ReadingV2.bulkInsertReadings(newReadings);
const rejectedCount = newReadings.length - insertedReadings.length;
...
const evaluation = await safeEvaluateReadings(insertedReadings, devices);
```

`bulkInsertReadings` (`models/v2/ReadingV2.ts:399`) is `this.insertMany(readingsWithTimestamp, {
ordered: false })`. With `ordered: false`, documents that fail validation are silently skipped and
the call resolves with only the documents that were actually written, never throwing. Its return
value — `IReadingV2[]` — was previously discarded; the route now captures it as `insertedReadings`
and treats it as the sole ground truth for everything downstream. `IReadingV2[]` is structurally
assignable to `safeEvaluateReadings`'s `EvaluableReading[]` parameter (`= Partial<IReadingV2>[]`),
so no cast was needed.

### Item 2 — response fields, and what each is now derived from

| Field | Before | After | Why |
|---|---|---|---|
| `count` | `newReadings.length` | `insertedReadings.length` | Same field name preserved (existing tests in `auth.integration.test.ts` and this file assert on `data.count`; brief didn't ask for a rename, and "existing cron tests must still pass"). Now means what it always should have: how many readings this run actually persisted. |
| `rejected` | *(did not exist)* | `newReadings.length - insertedReadings.length` | New field, mirroring `results.rejected` in `app/api/v2/readings/ingest/route.ts` — the brief's explicit in-repo precedent ("staying consistent with it matters more than inventing a new shape"). I kept the cron route's existing flat response shape (no `data` wrapper — this route never used `jsonSuccess()`) rather than adopting ingest's nested `{ inserted, rejected }` shape; the *concept* (report the rejected remainder) matches ingest, the field name (`rejected`) matches ingest, but the route's overall shape is left as this route's own established shape, since the brief's items 1-3 don't ask for a response-shape migration and Task 5 (`2879d08`) just landed logging conventions on this same handler that I was told not to disturb. |
| `anomalies` | `newReadings.filter(r => r.quality?.is_anomaly === true).length` | `insertedReadings.filter(r => r.quality.is_anomaly === true).length` | This is the trap called out in the task brief. A reading that `bulkInsertReadings` rejected was never passed to `safeEvaluateReadings` and does not exist in the DB — no alert can reference it, no query can find it. Counting it toward `anomalies` would report a data point that is unobservable everywhere else in the system, which is exactly the kind of "reports what happened as though everything landed" bug this task exists to fix. I dropped the `?.` optional-chain on `.is_anomaly` deliberately: `insertedReadings: IReadingV2[]` (not `Partial<...>`), so `quality` and `quality.is_anomaly` are both guaranteed present per `IReadingV2`'s interface — the chain was only ever needed for `Partial<IReadingV2>`. |

### Item 3 — `safeSweepStaleAlerts` left untouched

Still receives the full device set (`new Set(devices.map(device => String(device._id)))`),
unmodified — confirmed by diff (the line is byte-identical before/after). Per the brief and the
ruling already recorded on this branch, the sweep's reporting concern is which devices were
emitted for, not which readings persisted, so it is orthogonal to this task's fix.

### What I did not touch (scope discipline)

- **Pusher trigger** (`pusherServer.trigger('InfraSight', 'new-readings', newReadings)`) still
  broadcasts the full generated batch, including readings that may have been rejected. This is
  arguably the same class of bug (real-time clients would learn about a reading that doesn't
  exist in the DB), but it is not named in the brief's items 1-3, and "implement exactly what the
  brief specifies — nothing more" argues against fixing it here. Flagging as a candidate for a
  future task; see Concerns.
- **Task 5's fired/resolved logging block** (`2879d08`) — untouched, still reads
  `evaluation.fired`/`evaluation.resolved` off the same `evaluation` variable, now fed by
  `insertedReadings` instead of `newReadings`. This is exactly the intended interaction: the log
  now correctly reflects alerts derived only from persisted readings.
- No metrics recording (e.g. an `recordIngestion`-style call) was added to the cron path — not
  requested, and the route records no metrics today.
- No rename of `count` → `inserted` — see table above.

## Files changed

- `app/api/v2/cron/simulate/route.ts` — the fix (17 insertions, 7 deletions in the diff).
- `__tests__/integration/api/simulate-cron.integration.test.ts` — two new tests plus three import
  additions (114 insertions).

## What I tested, and the anti-vacuity verification

Two new tests, both in a new `describe('partial insert handling', ...)` block at the end of
`simulate-cron.integration.test.ts`.

### Test 1 — `evaluates and reports only the readings bulkInsertReadings actually inserted`

Creates 3 active devices, mocks `ReadingV2.bulkInsertReadings` to return only the first 2 of the 3
candidate readings it's called with (captured via closure into `insertedSubset` so the test can
assert exact reference identity, not just a length match), spies on `evaluateReadings` to inspect
what it was called with, then asserts:
- `data.count === 2`, `data.rejected === 1` (response reflects the persisted subset, not the
  generated batch of 3)
- `evaluateSpy.mock.calls[0][0]` is (`toBe`, reference equality) exactly `insertedSubset` — proves
  the route forwards `bulkInsertReadings`'s actual return value, not a reconstructed array that
  merely looks the same.

### Test 2 — `must not count a reading bulkInsertReadings rejected toward the anomaly total`

Targets the specific trap called out in the task: mocks `generateSimulatedReadings` itself (for
full determinism, removing reliance on the simulator's real ~2-5% random anomaly rate) to return
exactly two fixed readings — one normal, one anomalous — then mocks `bulkInsertReadings` to
"persist" only the normal one. Asserts `data.count === 1`, `data.rejected === 1`, and critically
`data.anomalies === 0` (not 1) — if `anomalies` were still derived from the full generated batch
(which includes the rejected, anomalous reading), it would report 1.

### Mutation verification (both directions, real output)

**Mutation applied**: reverted `app/api/v2/cron/simulate/route.ts` to the exact pre-fix version
(`git show HEAD:...` from before my change — i.e. `await ReadingV2.bulkInsertReadings(newReadings)`
with the return value discarded, `safeEvaluateReadings(newReadings, devices)`, `count:
newReadings.length`, no `rejected` field, `anomalyCount` from `newReadings`), tests unchanged.

**Failing output before** (`pnpm test -- --selectProjects node --testPathPatterns
"integration/api/simulate-cron"`):

```
partial insert handling
  ✕ evaluates and reports only the readings bulkInsertReadings actually inserted (14 ms)
  ✕ must not count a reading bulkInsertReadings rejected toward the anomaly total (13 ms)

● ... evaluates and reports only the readings bulkInsertReadings actually inserted
  expect(received).toBe(expected) // Object.is equality
  Expected: 2
  Received: 3
    > expect(data.count).toBe(2);

● ... must not count a reading bulkInsertReadings rejected toward the anomaly total
  expect(received).toBe(expected) // Object.is equality
  Expected: 1
  Received: 2
    > expect(data.count).toBe(1);

Test Suites: 1 failed, 1 total
Tests:       2 failed, 55 passed, 57 total
```

**Restored, passing output after**:

```
partial insert handling
  ✓ evaluates and reports only the readings bulkInsertReadings actually inserted (17-18 ms)
  ✓ must not count a reading bulkInsertReadings rejected toward the anomaly total (12-15 ms)

Test Suites: 1 passed, 1 total
Tests:       57 passed, 57 total
```

I also ran a third, targeted variant to specifically pin the trap the brief warned about — a
*partial* fix that corrects the `evaluateReadings` call to use `insertedReadings` but leaves
`count`/`anomalies`/`rejected` computed from `newReadings` (i.e. exactly the mistake the brief
described: "If you switch the evaluation to the inserted subset but leave those two reading from
the full array, the route will still misreport"). Same two tests, same failure signature
(`data.count` expected 2/1, received 3/2) — confirming the tests catch not just a full revert but
specifically the "fixed evaluate, forgot the response" half-fix. Reverted immediately after
confirming.

All three variants (full revert, partial-fix trap, real fix) were applied via direct file
swaps/edits to `route.ts` and verified by rerunning the focused suite each time — not inferred.

### Full suite

`npx jest --selectProjects node` (no path filter, per the task's noted arg-forwarding quirk):

```
Test Suites: 82 passed, 82 total
Tests:       2228 passed, 2228 total
```

Baseline was 2226/82; 2228 = 2226 + 2 new tests, 0 unexplained regressions. Ran twice (once before
commit, once after) with identical results.

Also re-ran the two tests flagged as intermittently flaky under parallel load, in isolation, per
the task's instruction:
- `npx jest --selectProjects node -t "should have calibration offset in valid range"` → 1 passed.
- `npx jest --selectProjects node --testPathPatterns "device-history"` → 19 passed.

### Static checks

- `npx tsc --noEmit -p tsconfig.json` — 54 pre-existing errors, all in files I did not touch
  (confirmed identical count via `git stash`/`git stash pop` before and after my change); zero
  errors in either file I changed.
- `npx eslint app/api/v2/cron/simulate/route.ts __tests__/integration/api/simulate-cron.integration.test.ts`
  — clean, no output.
- `npx prettier --check` on both files reports pre-existing formatting warnings (confirmed via
  `git stash` that both files already failed this check before my change — likely because the
  project doesn't enforce prettier in CI/the file predates the current prettier config). I left
  formatting as-is rather than running `--write`, since that would reformat unrelated pre-existing
  code in both files, well beyond this task's scope. `eslint` — the lint gate CLAUDE.md documents
  (`pnpm lint`) — is clean.

## Self-review (fresh eyes)

- **Completeness**: all three brief items implemented; nothing left half-done. Verified the
  `safeSweepStaleAlerts` line is byte-identical before/after via diff.
- **Comment accuracy**: re-read every comment I added against the actual code next to it and
  against `models/v2/ReadingV2.ts`'s real `bulkInsertReadings` implementation. All accurate — no
  comment claims behavior the code doesn't have.
- **Naming**: `insertedReadings`/`rejectedCount`/`anomalyCount` (variables) →
  `count`/`rejected`/`anomalies` (response fields) follows the file's own pre-existing convention
  (`anomalyCount` → `anomalies` already existed before my change); I didn't invent a new pattern.
- **YAGNI**: checked the diff twice for scope creep — Pusher, metrics, and the `count` field name
  were all deliberately left alone (see "What I did not touch" above).
- **Tests verify behavior, not mocks**: Test 1's `evaluateSpy.mock.calls[0][0]).toBe(...)`
  assertion does inspect a mock's call arguments, but that's the literal acceptance criterion the
  brief's Tests section specifies ("assert safeEvaluateReadings receives only that subset") — not
  a vacuous mock-implementation check. Both tests' `data.count`/`data.rejected`/`data.anomalies`
  assertions are on the real JSON response body returned by the real route handler, not on mock
  internals. Confirmed via the reverted-code run that these are the assertions that actually fail
  first (not, e.g., an assertion that only checks a mock was "called" without checking what with).
- One thing I reconsidered and kept: using `mockReturnValue`/`mockImplementation` on
  `generateSimulatedReadings` in test 2 rather than relying on the simulator's real randomness.
  The alternative (real generator + statistically-likely-but-not-guaranteed anomaly) would have
  made the test's fail-under-bug direction probabilistic (~2-9% chance of a false pass even with
  the bug present), which conflicts with this task's anti-vacuity requirement to report *real,
  reproducible* output. Full determinism was worth the extra mock.

## Concerns

- The Pusher real-time broadcast still sends the full `newReadings` batch (including any rejected
  readings) to connected clients, not `insertedReadings`. Same underlying class of bug as this
  task fixes, but outside the brief's items 1-3 — flagging rather than fixing, per "implement
  exactly what the brief specifies, nothing more."
- In real-world operation, `bulkInsertReadings` rejecting anything is rare (the simulator generates
  schema-valid data by construction), so this fix's behavioral impact is mostly a correctness
  guarantee for an edge case rather than something that changes today's typical response payloads
  — both new tests need mocking specifically because a real partial failure is hard to trigger
  organically from the generator. This mirrors how the ingest route's own `rejected` field is
  currently tested via a different, DB-lookup-driven rejection path, not a genuine `insertMany`
  partial-write failure either.
