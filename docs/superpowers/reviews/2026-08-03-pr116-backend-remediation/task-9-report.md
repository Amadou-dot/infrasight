# Task 9 Report: Close the write-path integration test gaps

Branch `feat/phase-4-alerting`, worktree `/home/yzel/github/infrasight-phase4`.
Started at `2acef16`. Commit: `b2d1c39`.

## What I implemented

Pure test work across the four files named in the brief. No source file was changed in the
final commit (verified — see Verification). 7 new tests total:

| Gap | File | New test(s) |
|---|---|---|
| 9a (ingest) | `readings-ingest.integration.test.ts` | 1: selector matching on building_id/floor/zone/tags, with negative twin |
| 9a (cron) | `simulate-cron.integration.test.ts` | 1: same, cron path |
| 9b (cron) | `simulate-cron.integration.test.ts` | 1: `sweepStaleAlerts` throws |
| 9c (alerts) | `alerts.integration.test.ts` | 2: member read, unauthenticated 401 |
| 9c (alert-rules) | `alert-rules.integration.test.ts` | 2: member read, unauthenticated 401 |

### A pre-existing test already covers half of 9b

Before writing anything, I checked whether the "spy `evaluateReadings` ... to reject" half of
9b's "add two tests" instruction was already satisfied. It is:
`simulate-cron.integration.test.ts`'s existing `'should still return 200 with readings
persisted when evaluation throws'` (added by a prior task in this series, commit `2480e01`)
already spies the raw `evaluateReadings` and asserts response 200, `ReadingV2.countDocuments()`
matches the emitted device count, and the spy was called — exactly what the brief specifies. The
brief's own gap description confirms this is the correct read: it says *"it is the only caller of
`safeSweepStaleAlerts`, so **a throwing sweep** is uncovered anywhere"* — the sweep half, not the
evaluate half. I verified this pre-existing test still genuinely catches its mutation (see
Verification) rather than assuming, then added only the missing `sweepStaleAlerts` half, to avoid
a redundant near-duplicate test that the "nothing more" instruction would flag.

## For each test: mutation, failing output, passing output, and why the failure is real

All commands below were run from `/home/yzel/github/infrasight-phase4`. Every mutation was
applied as a temporary source edit, run, reverted, and re-run — `git diff --stat` / `git status`
confirmed a fully clean source tree after each revert and again at the end (see final
Verification section).

### 9a — ingest: selector matching (`readings-ingest.integration.test.ts`)

**Test:** `'should fire only for the device whose location and tags match the selector'`
Two devices identical in every selector-relevant field except `floor`; a rule selecting on
`building_id` + `floor` + `zone` + `tags`; both devices receive a breaching reading in the same
POST. Asserts the matching device's alert fires and the wrong-floor device has none.

**Mutation (brief-specified):** revert `readings/ingest/route.ts`'s device projection from
`{ _id: 1, type: 1, location: 1, 'metadata.tags': 1 }` back to `{ _id: 1 }`.

Before (mutated, FAIL):
```
● alert evaluation on the ingest path › should fire only for the device whose location and tags match the selector

  expect(received).not.toBeNull()
  Received: null

    1460 |       expect(matchedAlert).not.toBeNull();
         |                                ^
Tests: 1 failed, 44 skipped, 45 total
```
The failure is on the **positive** assertion (`matchedAlert` is null) — the matching device's
alert never fired, because with only `_id` projected, `device.location` is `undefined` and
`matchesSelector` correctly treats every selector dimension as unsatisfied. This is the intended
failure: selector matching didn't happen, not a setup mistake.

After (restored, PASS):
```
✓ should fire only for the device whose location and tags match the selector (192 ms)
Tests: 44 skipped, 1 passed, 45 total
```

### 9a — cron: selector matching (`simulate-cron.integration.test.ts`)

**Test:** same shape, cron path, `threshold: -1000` (guaranteed breach regardless of the
simulator's random value, matching the existing cron alert test's own pattern).

**Mutation (brief-specified):** revert `cron/simulate/route.ts`'s projection from
`{ _id: 1, type: 1, location: 1, 'metadata.tags': 1 }` back to
`{ _id: 1, type: 1, location: 1 }` (this variant keeps `location` and drops only `metadata.tags`
— I built the selector to require `tags` specifically so this narrower mutation is still caught;
a selector using only building/floor/zone would have passed against it).

Before (mutated, FAIL):
```
● alert evaluation on the cron path › should fire only for the device whose location and tags match the selector

  expect(received).not.toBeNull()
  Received: null

    832 |       expect(matchedAlert).not.toBeNull();
        |                                ^
Tests: 1 failed, 58 skipped, 59 total
```
Same reasoning: `metadata.tags` is absent from the projection, `matchesSelector`'s tags check
(`selector.tags.every(tag => deviceTags.has(tag))` against an empty set) fails for both devices,
so the matching device's alert never fires.

After (restored, PASS):
```
✓ should fire only for the device whose location and tags match the selector (31 ms)
Tests: 58 skipped, 1 passed, 59 total
```

### 9a — negative twin, verified against a second mutation (not brief-required, done for rigor)

The brief's projection mutations only exercise the **positive** assertion (both devices lose
their data, so neither fires — the negative assertion `unmatchedAlert === null` stays trivially
true either way). To confirm the negative twin genuinely earns its place — "proves matching
rather than mere field presence," per the brief — I additionally mutated
`lib/alerting/selector.ts`'s `matchesSelector` to drop the floor comparison (commented out the
`if (selector.floor !== undefined && ...) return false;` line) and re-ran both 9a tests.

Before (mutated, FAIL — both files):
```
● ... should fire only for the device whose location and tags match the selector

  expect(received).toBeNull()
  Received: {"_id": "...", "device_id": "device_selector_wrongfloor_ingest", "status": "firing", ...}

    1470 |       expect(unmatchedAlert).toBeNull();
         |                              ^
```
(cron file: identical shape, `device_id: "device_selector_wrongfloor_cron"`, `status: "firing"`)

This time the failure is on the **negative** assertion: with the floor check disabled, the
wrong-floor device incorrectly fires too (building_id/zone/tags still all match). This is exactly
the "field presence, not genuine matching" bug the negative twin exists to catch — a test with
only the positive assertion would have passed this mutation.

After restoring `selector.ts` (PASS, both files): reran and confirmed both tests pass again
(same output as the "After" blocks above).

### 9b — cron: `sweepStaleAlerts` throws (`simulate-cron.integration.test.ts`)

**Test:** `'should still return 200 with readings persisted when the staleness sweep throws'`
One device; `jest.spyOn(sweepModule, 'sweepStaleAlerts').mockRejectedValueOnce(...)`; asserts
spy called once, response 200, `body.success === true`, and `ReadingV2.countDocuments()` for
that device equals 1 (the emitted device count).

**Mutation (brief-specified):** point the cron route at the raw `sweepStaleAlerts` instead of
`safeSweepStaleAlerts` (temporarily imported the raw export from `@/lib/alerting` and swapped the
call site).

Before (mutated, FAIL):
```
● alert evaluation on the cron path › should still return 200 with readings persisted when the staleness sweep throws

  expect(received).toBe(expected) // Object.is equality
  Expected: 200
  Received: 500

    761 |       expect(spy).toHaveBeenCalledTimes(1);
  > 762 |       expect(response.status).toBe(200);
        |                               ^
Tests: 1 failed, 58 skipped, 59 total
```
`spy` was called once (line 761 passed) — proving the mocked rejection was actually reached —
and the failure is specifically that the response became 500 instead of 200, because the
rejection propagated to the route's outer `catch` with no `safe*` wrapper to absorb it. That is
exactly the isolation-failure mode this test exists to catch.

After (restored, PASS):
```
✓ should still return 200 with readings persisted when the staleness sweep throws (14 ms)
Tests: 58 skipped, 1 passed, 59 total
```

### 9b — cross-check: the pre-existing `evaluateReadings`-throws cron test

Not authored by me, but I verified it against its own corresponding mutation (raw
`evaluateReadings` instead of `safeEvaluateReadings`) rather than assuming it works, since my
decision not to duplicate it depends on it being real:

Before (mutated, FAIL):
```
● alert evaluation on the cron path › should still return 200 with readings persisted when evaluation throws

  Expected: 200
  Received: 500

    727 |       expect(spy).toHaveBeenCalledTimes(1);
  > 728 |       expect(response.status).toBe(200);
```
Same failure shape as the sweep test above — confirms this existing test is not vacuous.

### 9c — alerts: RBAC on `GET /api/v2/alerts/[id]` (`alerts.integration.test.ts`)

**Tests:** `'should allow a member to read a single alert'` (expects 200),
`'should reject an unauthenticated request'` (expects 401, using the pre-existing
`mockAuthAsUnauthenticated` helper — same idiom already used in
`device-history.integration.test.ts`).

**Mutation A (brief-specified): delete `await requireOrgMembership();` entirely.**

Before (mutated):
```
✓ should allow a member to read a single alert (71 ms)
✕ should reject an unauthenticated request (10 ms)

  ● GET /api/v2/alerts/[id] › should reject an unauthenticated request
    expect(received).toBe(expected)
    Expected: 401
    Received: 404
      345 |       expect(response.status).toBe(401);
```
The member test **still passes** here — expected, since removing the guard doesn't newly
restrict members, it only removes enforcement. The unauthenticated test fails with `404`, not an
error: with no auth check, the request falls through to the normal not-found path for a random
ObjectId. That is the correct failure signature for "the guard is gone," and it's what actually
catches the brief's named mutation.

After restoring `requireOrgMembership()`: both tests pass (see combined restore run below).

**Mutation B (not brief-required; run to verify the member test has its own bite, not just
"passes no matter what"): swap `requireOrgMembership()` → `requireAdmin()`.**

Before (mutated):
```
✕ should allow a member to read a single alert
  Expected: 200
  Received: 403
    333 |       expect(response.status).toBe(200);

✓ should reject an unauthenticated request
```
Now the member test fails for the right reason (member is forbidden under an admin-only guard),
and the unauthenticated test still passes because `requireAdmin()` enforces authentication first
too (401 before the role check). This confirms the two tests are complementary: the
unauthenticated test catches guard *deletion*, the member test catches guard
*over-restriction*.

After restoring `requireOrgMembership()` (PASS, both mutations reverted, combined run):
```
✓ should allow a member to read a single alert
✓ should reject an unauthenticated request
Tests: 54 skipped, 4 passed, 58 total   (both alerts.integration.test.ts + alert-rules.integration.test.ts)
```

### 9c — alert-rules: RBAC on `GET /api/v2/alert-rules/[id]` (`alert-rules.integration.test.ts`)

Same two tests, same two mutations, run against `alert-rules/[id]/route.ts`'s GET handler.
Results were identical in shape:

Mutation A (guard deleted) — unauthenticated test FAILs `Expected: 401, Received: 404`; member
test still PASSes.
Mutation B (swapped to `requireAdmin`) — member test FAILs `Expected: 200, Received: 403`;
unauthenticated test still PASSes.
Restored — both PASS.

## Did I need any source change?

No. All four gaps were closeable purely by adding tests against the existing, correct
implementation. I did not modify any file under `app/`, `lib/`, or `models/` in the final commit
— confirmed by `git status`/`git diff --stat` showing only the four `__tests__/integration/api/*`
files, both mid-task and at the end.

## Full-suite verification

```
$ npx jest --selectProjects node
Test Suites: 85 passed, 85 total
Tests:       2263 passed, 2263 total
```
Baseline was 2256 passing / 85 suites; 2256 + 7 new tests = 2263 — exact match, no other test
count moved, no suite newly failed or newly skipped.

```
$ npx tsc --noEmit 2>&1 | grep -c "error TS"
39
```
Matches the 39-error baseline exactly.

```
$ pnpm lint 2>&1 | grep problems
✖ 311 problems (308 errors, 3 warnings)
```
Matches the 311-problem baseline exactly. I additionally grepped the lint output for each of the
four modified files: `alerts.integration.test.ts`, `alert-rules.integration.test.ts`, and
`simulate-cron.integration.test.ts` report zero problems; `readings-ingest.integration.test.ts`
reports 3 pre-existing `curly` errors, all at line numbers (1079/1105/1223) far above my
purely-additive diff (which starts at line 1375, `+94/-0`) — confirmed via `git diff` that my
change to that file has zero deletions.

## Files changed

- `__tests__/integration/api/readings-ingest.integration.test.ts` — +94/-0, 1 new test (9a).
- `__tests__/integration/api/simulate-cron.integration.test.ts` — +104/-0, 1 new import
  (`* as sweepModule from '@/lib/alerting/sweep'`) + 2 new tests (9a, 9b).
- `__tests__/integration/api/alerts.integration.test.ts` — +29/-1, import line updated to add
  `mockAuthAsUnauthenticated` + 2 new tests (9c).
- `__tests__/integration/api/alert-rules.integration.test.ts` — +25/-1, same import update + 2
  new tests (9c).

No source files changed (see above).

## Self-review findings

1. **Checked every test's failure reason, not just pass/fail status**, per the task's explicit
   warning about tests that fail for an unrelated reason. All 9a failures were confirmed to be on
   the specific assertion tied to selector matching (`matchedAlert`/`unmatchedAlert`), not on
   setup (response status, rule creation, device creation all succeeded in every mutated run —
   only the DB-state assertions about the alert failed).
2. **Went beyond the brief's named mutations for 9a** to directly verify the negative twin's
   purpose (catching field-presence-only matching, not just projection regressions) via a
   `matchesSelector` logic mutation — this wasn't asked for but is cheap and directly answers the
   task's own "could this test pass for the wrong reason" question for the highest-risk part of
   9a.
3. **Went beyond the brief's named mutation for 9c** to verify the member-role tests have
   independent value (not just "always passes"), via the `requireAdmin()` substitution. Without
   this second mutation, the member tests' only verified property would have been "doesn't fail
   under guard deletion," which is a weak claim for a test whose stated purpose is coverage of the
   member-allowed path.
4. **Checked for mock-only assertions**: the one test with a mock assertion (9b's
   `expect(spy).toHaveBeenCalledTimes(1)`) also asserts real outcomes (response status, DB count)
   and mirrors the pattern already proven correct by the existing `evaluateReadings`-throws
   sibling test. The 9a and 9c tests assert only real behavior (DB state, HTTP status) — no mock
   call counts are load-bearing there.
5. **Confirmed no redundant test was added**: checked whether the pre-existing
   `evaluateReadings`-throws cron test already satisfied half of 9b before writing anything, and
   verified it against its own mutation rather than assuming a prior task did so correctly.
6. **Confirmed the diff is purely additive** in 3 of 4 files (only the two auth-helper import
   lines in `alerts.integration.test.ts` / `alert-rules.integration.test.ts` show a 1-line
   modification, from adding `mockAuthAsUnauthenticated` to an existing import) — no existing
   test was weakened, restructured, or had its assertions changed.
7. Considered whether the 9a rule's `selector.types: ['temperature']` was necessary. It isn't,
   strictly — `matchesSelector` ignores `types` entirely (bucketing handles it) — but I kept it
   for realism and consistency with the brief's own description of the existing tests' selector
   shape.

## Concerns

None blocking. One judgment call worth flagging explicitly: I read the brief's "add two tests"
for 9b as "ensure two tests exist" rather than "author two new tests," since one (the
`evaluateReadings` half) already existed and demonstrably works. If a stricter literal reading is
wanted, the missing action would be adding a near-duplicate `evaluateReadings`-throws test to this
same file, which I chose not to do because it would be redundant coverage rather than closing a
gap, and the task instructions favor implementing exactly what's specified — nothing more.
