# Task 1 Report: Reconcile the sweep's bulk write and close the stale-resolve race

Status: DONE

## What was implemented

File: `lib/alerting/sweep.ts`

### 1a. Closed the stale-resolve race

The resolve op's filter is now conditional on `resolution`:

```ts
filter:
  resolution === 'stale'
    ? { _id: alert._id, is_open: true, last_observed_at: { $lt: cutoff } }
    : { _id: alert._id, is_open: true },
```

`'device_inactive'` keeps the original unguarded `{ _id, is_open: true }` filter, per
the brief's reasoning: a device absent from `reportingDeviceIds` has no fresh
observation by definition, so the cutoff predicate would wrongly skip it. The
existing precedence line (`const resolution = deviceInactive ? 'device_inactive' :
'stale'`) was left untouched, so an alert that is both inactive and stale still
takes the unguarded path.

### 1b. Reconciled the bulk write result

- `AlertV2.bulkWrite(ops, { ordered: false })`'s return value is now captured as
  `bulkResult`.
- The loop no longer pushes directly into a `resolved[]` array or calls
  `recordAlert('resolved', …)` inline. It builds `resolveCandidates: { id, alert
  }[]` instead — candidates, not confirmed outcomes.
- After the bulk write, when `resolveCandidates.length > 0`, one follow-up query
  confirms which candidates actually matched:
  ```ts
  AlertV2.find({ _id: { $in: resolveCandidates.map(c => c.id) }, 'audit.resolved_at': now })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>();
  ```
  `resolved[]` is filtered to the confirmed ids, and `recordAlert('resolved', …)`
  fires once per confirmed alert, after the write.
- `deleted` is now `bulkResult.deletedCount` (the driver's actual count), not
  `toDelete.length` (the candidate count).
- Added an early return `if (ops.length === 0) return { deleted: 0, resolved: [] };`
  before calling `bulkWrite` — calling `bulkWrite([])` throws ("Batch cannot be
  empty"), and this case only arises when there was nothing to delete or resolve
  anyway, so the result is identical to the pre-existing behavior.
- The reconciliation query is skipped entirely when there are no resolve
  candidates (e.g. a sweep that only deletes pending alerts), avoiding a wasted
  round trip. Updated the top-of-file comment to describe this cost profile.

### 1c. Projected the snapshot read

```ts
AlertV2.find({ is_open: true })
  .select({ _id: 1, rule_id: 1, device_id: 1, status: 1, severity: 1, last_observed_at: 1 })
  .lean<IAlertV2[]>();
```

Exactly the six fields the loop reads. No `.limit()`.

## What was tested

File: `__tests__/unit/lib/alerting/sweep.test.ts`

All new/changed tests use a `jest.spyOn(AlertV2, 'bulkWrite').mockImplementationOnce(...)`
that runs a second, interleaved write via the real (bound, unmocked) `bulkWrite`
before calling through — this is the only hook with the correct timing to land a
race strictly between the sweep's snapshot read and its bulk write, as opposed to
before the sweep runs at all (which is the bug in the test being replaced).

1. **Replaced the vacuous test** (was `sweep.test.ts:125-147`, now "should not
   delete a pending alert promoted to firing between the sweep read and its
   write"). A pending alert on a non-reporting device is promoted to `firing` via
   the bulkWrite spy, after the sweep's snapshot read already queued it in
   `toDelete`. Asserts `deleted: 0`, `resolved: []`, and the document still exists
   with `status: 'firing'`.

2. **1a guard test** ("should not resolve a stale alert as stale once a fresh
   observation lands before the write"). A stale-at-snapshot-time alert on a
   *reporting* device (so only the `'stale'` branch applies) gets its
   `last_observed_at` refreshed via the bulkWrite spy before the write executes.
   Asserts the episode stays `firing`/open/unresolved.

3. **1b deleted-count test** ("should report deleted as the actual deletedCount,
   not the candidate count"). Two pending alerts are both delete candidates; one
   is promoted to `firing` mid-race (guard blocks its delete), the other is
   deleted normally. Asserts `deleted: 1` (actual), not `2` (candidate count).

4. **1b resolved-exclusion test** ("should exclude an alert a concurrent writer
   already resolved from resolved[]"). A different writer (simulating e.g. a
   human PATCH) resolves the same episode first, with a timestamp 5 minutes in
   the past (deliberately not `new Date()` — see "flakiness found" below).
   Asserts the sweep's own `resolved[]` is empty and the stored resolution is
   still `'manual'` (i.e. untouched by the sweep).

5. **Strengthened the `safeSweepStaleAlerts` swallow-error test**. Added a
   `logger.error` spy and assertions that both the `AlertV2.find` spy and the
   `logger.error` spy were actually called, mirroring the sibling
   `safeEvaluateReadings` test's pattern, so the assertion can't pass via the
   byte-identical empty-database early-return path.

### Anti-vacuity verification (Global Constraint 2)

For every test above, I applied the named mutation (or reverted the specific
source line), ran the full `sweep.test.ts` file, confirmed the target test(s)
FAILED, then restored the change and confirmed all 15 tests PASSED. Full
before/after output for each:

---

**Test: "should not delete a pending alert promoted to firing between the sweep
read and its write"**
Mutation (brief-specified, `sweep.ts:114`): removed `status: 'pending'` from the
`deleteMany` filter.

FAILING (mutated):
```
✕ should not delete a pending alert promoted to firing between the sweep read and its write (9 ms)
✕ should report deleted as the actual deletedCount, not the candidate count (10 ms)

  ● sweepStaleAlerts › should not delete a pending alert promoted to firing between the sweep read and its write
    expect(received).toBe(expected) // Object.is equality
    Expected: 0
    Received: 1
      > 151 |     expect(result.deleted).toBe(0);

Tests: 2 failed, 13 passed, 15 total
```
(The deleted-count test also fails here, correctly — see its own entry below;
both are sensitive to this exact guard because the same race scenario drives
both assertions.)

PASSING (restored):
```
✓ should not delete a pending alert promoted to firing between the sweep read and its write (11 ms)
Tests: 15 passed, 15 total
```

---

**Test: "should not resolve a stale alert as stale once a fresh observation
lands before the write"**
Mutation (1a, `sweep.ts` resolve filter): reverted the conditional filter to the
unconditional pre-1a form `{ _id: alert._id, is_open: true }` for both
resolutions.

FAILING (mutated):
```
✕ should not resolve a stale alert as stale once a fresh observation lands before the write (12 ms)

  ● sweepStaleAlerts › should not resolve a stale alert as stale once a fresh observation lands before the write
    expect(received).toHaveLength(expected)
    Expected length: 0
    Received length: 1
    Received array: [{"_id": "...", "actor": "system", "device_id": "device_001", "resolution": "stale", ...}]
      > 183 |     expect(result.resolved).toHaveLength(0);

Tests: 1 failed, 14 passed, 15 total
```

PASSING (restored):
```
✓ should not resolve a stale alert as stale once a fresh observation lands before the write (11 ms)
Tests: 15 passed, 15 total
```

---

**Test: "should report deleted as the actual deletedCount, not the candidate
count"**
Mutation (1b, `sweep.ts` return statement): reverted `deleted: bulkResult.deletedCount`
to `deleted: toDelete.length`.

FAILING (mutated):
```
✕ should not delete a pending alert promoted to firing between the sweep read and its write (10 ms)
✕ should report deleted as the actual deletedCount, not the candidate count (10 ms)

  ● sweepStaleAlerts › should report deleted as the actual deletedCount, not the candidate count
    expect(received).toBe(expected) // Object.is equality
    Expected: 1
    Received: 2
      > 216 |     expect(result.deleted).toBe(1);

Tests: 2 failed, 13 passed, 15 total
```

PASSING (restored):
```
✓ should report deleted as the actual deletedCount, not the candidate count (11 ms)
Tests: 15 passed, 15 total
```

---

**Test: "should exclude an alert a concurrent writer already resolved from
resolved[]"**
Mutation (1b, `sweep.ts` resolved[] construction): reverted to building
`resolved` directly from `resolveCandidates` (skipping the confirmation query
and firing `recordAlert` unconditionally), i.e. the pre-1b behavior.

FAILING (mutated):
```
✕ should not resolve a stale alert as stale once a fresh observation lands before the write (9 ms)
✕ should exclude an alert a concurrent writer already resolved from resolved[] (9 ms)

  ● sweepStaleAlerts › should exclude an alert a concurrent writer already resolved from resolved[]
    expect(received).toHaveLength(expected)
    Expected length: 0
    Received length: 1
    Received array: [{"_id": "...", "actor": "system", "device_id": "device_gone", "resolution": "device_inactive", ...}]
      > 261 |     expect(result.resolved).toHaveLength(0);

Tests: 2 failed, 13 passed, 15 total
```

PASSING (restored):
```
✓ should exclude an alert a concurrent writer already resolved from resolved[] (11 ms)
Tests: 15 passed, 15 total
```

---

**Test: "should swallow a sweep error" (strengthened)**
Mutation (unrelated pre-existing source, `lib/alerting/index.ts`
`safeSweepStaleAlerts`): removed the `logger.error(...)` call from the catch
block (temporary — this file is not part of Task 1's scope; mutated only to
verify the strengthened test, then restored to the byte-identical original).

FAILING (mutated):
```
✕ should swallow a sweep error (3 ms)

  ● safe wrappers › should swallow a sweep error
    expect(jest.fn()).toHaveBeenCalled()
    Expected number of calls: >= 1
    Received number of calls:    0
      > 318 |     expect(errorSpy).toHaveBeenCalled();

Tests: 1 failed, 14 passed, 15 total
```

PASSING (restored):
```
✓ should swallow a sweep error (3 ms)
Tests: 15 passed, 15 total
```
`git diff lib/alerting/index.ts` confirms this file is byte-identical to HEAD —
no unintended changes remain.

---

### One flaky test found and fixed during verification

The first version of the "concurrent writer already resolved" test used
`'audit.resolved_at': new Date()` for the concurrent writer's timestamp. On the
first run this test failed unexpectedly even with the correct 1b implementation
in place: the concurrent write's `new Date()` landed in the same millisecond as
the sweep's own `now` (no real network latency against the in-memory Mongo test
double), so the reconciliation query's `'audit.resolved_at': now` equality check
coincidentally matched a document the sweep's own guarded `updateOne` never
actually touched. This would have been a flaky, non-deterministic test — not a
source bug (the brief's reconciliation technique is explicitly deterministic only
*within* one sweep run, since every op in that run shares the same `now`; it
makes no claim about not colliding with an unrelated writer's independently
generated timestamp). Fixed by using `minutesAgo(5)` for the concurrent writer's
timestamp instead, which is both deterministic and a more realistic simulation
of an unrelated writer's timing. Re-ran 5x after the fix with no further
flakiness.

## Full test runs

Focused (`pnpm test -- --selectProjects node --testPathPatterns "unit/lib/alerting"`):
```
PASS node __tests__/unit/lib/alerting/evaluate.test.ts
PASS node __tests__/unit/lib/alerting/sweep.test.ts
PASS node __tests__/unit/lib/alerting/rule-cache.test.ts
PASS node __tests__/unit/lib/alerting/selector.test.ts
Test Suites: 4 passed, 4 total
Tests:       73 passed, 73 total
```

Full node project (`npx jest --selectProjects node` — note: `pnpm test -- --selectProjects node`
without a `--testPathPatterns` value resolves 0 tests due to how pnpm/jest
combine the `--` separator with bare flags; `npx jest --selectProjects node`
directly is the reliable equivalent and was used instead):
```
Test Suites: 82 passed, 82 total
Tests:       2204 passed, 2204 total
```
82 matches the actual count of `__tests__/**/*.test.ts` files on disk
(`find __tests__ -name "*.test.ts" | wc -l` → 82), confirming the full project
ran, not a subset.

Type-check (`npx tsc --noEmit -p tsconfig.json`, filtered for `sweep`/`alerting`):
no output — no errors in either changed file. (The unfiltered run shows
pre-existing errors in unrelated test files — analytics, auth, devices,
pagination, logger, DeviceV2, ScheduleV2 integration tests, etc. — consistent
with this branch's own handoff commit stating it is "incomplete, do not merge";
none touch `lib/alerting/` or `sweep.test.ts`.)

Lint (`npx eslint lib/alerting/sweep.ts __tests__/unit/lib/alerting/sweep.test.ts`):
clean, no output.

## Files changed

- `lib/alerting/sweep.ts` — 1a, 1b, 1c implementation.
- `__tests__/unit/lib/alerting/sweep.test.ts` — 1d replacement test, 1e's four
  new/strengthened tests.

## Self-review findings

- **Prettier**: `npx prettier --check` flags both files. Verified this is
  entirely pre-existing: (1) in `sweep.ts` the only flagged span is the
  untouched `STALE_AFTER_SECONDS` declaration (lines 22-25 in the final file);
  (2) in the test file, every flagged span is a `createAlertInput({...})`
  one-liner exceeding print width — the same idiom already used by every
  pre-existing test in the file (verified `prettier --check` also fails against
  `git show HEAD:...` of both files before my changes). My new tests match this
  established local convention rather than introducing a new one. CI does not
  gate on `format:check` (`.github/workflows/test-coverage.yml` has no such
  step). Deliberately did not run `prettier --write`, since reformatting
  untouched pre-existing lines would violate "implement exactly what the brief
  specifies... nothing more" and add unrelated diff noise.
- **Completeness against the brief**: re-checked 1a/1b/1c/1d/1e line by line
  against the final diff; all items present. The "Decisions already made"
  constraints (single reconciliation query, not per-alert `findOneAndUpdate`;
  `device_inactive` unguarded; projection with no `.limit()`) are all honored.
- **Naming**: `resolveCandidates`, `bulkResult`, `confirmed`, `confirmedIds` read
  clearly against their roles; no left-over references to the old unconditional
  `resolved` array name.
- **YAGNI**: the only structural additions beyond the literal diff implied by
  1a-1c are (a) the `if (ops.length === 0) return ...` early return, which is
  required to avoid calling `bulkWrite([])` (throws "Batch cannot be empty") now
  that a value is read off its result, and (b) the `if (resolveCandidates.length
  > 0)` guard around the reconciliation query, which avoids a pointless round
  trip when there's nothing to confirm (e.g. a delete-only sweep) — both are
  minimal, load-bearing, and documented in the top-of-file comment rather than
  left implicit.
- **Do tests verify behavior, not mocks**: every new test asserts against real
  documents read back from the (in-memory) MongoDB after the call, not against
  mock call arguments — the `bulkWrite` spy is used only to inject the timing of
  a second, real, unmocked write, and always calls through to the real
  implementation. No test's assertions are satisfiable by the mock's own
  bookkeeping.
- **Type accuracy**: changed the reconciliation query's `.lean()` from an
  unannotated call to `.lean<{ _id: Types.ObjectId }[]>()`, since it only
  projects `_id` — more accurate than reusing the full `IAlertV2[]` shape the
  snapshot read uses, where all fields genuinely exist.

## Concerns

None blocking. Two minor, non-blocking observations already covered above:
pre-existing (not introduced by this task) Prettier drift in both files, and a
`pnpm test -- --selectProjects node` invocation quirk (no `--testPathPatterns`)
that resolves 0 tests — worked around with `npx jest --selectProjects node`
directly for the full-project run; the exact focused-test command given in the
task instructions worked as documented throughout.
