# Task 4 Report: Make `for_duration_seconds` symmetric

Branch `feat/phase-4-alerting`, worktree `/home/yzel/github/infrasight-phase4`.
Started at `84eb30c`. Commit: `d72bcbf`.

## What I implemented

`lib/alerting/evaluate.ts`'s new-episode branch (inside `if (state.breaching) { if (!existing) { ... } }`)
decided `firesImmediately` purely from the rule:

```ts
const firesImmediately = (rule.for_duration_seconds ?? 0) === 0;
```

while the promotion branch (`if (existing.status === 'pending')`, six lines later) computed it
from the batch's own elapsed time:

```ts
const elapsedMs = state.lastObservedAt.getTime() - toDate(existing.breached_since).getTime();
if (elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000) { /* fire */ }
```

So a batch carrying a breach that already spanned longer than `for_duration_seconds` only opened
a `pending` episode and waited for a second request — but the identical batch fired immediately
if a `pending` episode already happened to exist from a prior batch. The two branches were
deciding the same question ("has this breach persisted long enough?") from different evidence.

### The fix

The new-episode branch now computes the same `elapsedMs` predicate the promotion branch uses,
from the reduction's own `state.lastObservedAt` and `state.breachedSince` (both already computed
per pair, no new state needed):

```ts
// Symmetric with the promotion branch below: a breach that already spans
// the required duration WITHIN this batch must fire immediately, not wait
// for a second request just because no pending episode exists yet.
// `state.breaching` is true here, so `state.breachedSince` is always set —
// same cast as `breached_since: state.breachedSince as Date` in the
// insertOne document just below.
const elapsedMs =
  state.lastObservedAt.getTime() - (state.breachedSince as Date).getTime();
const firesImmediately = elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000;
```

This sits inside `if (state.breaching) { if (!existing) { ... } }`, i.e. exactly where the brief
required it — the point where `state.breachedSince` is guaranteed set. I verified that invariant
by tracing every mutation site of `.breaching` and `.breachedSince` in the reduction loop
(lines 223–248): `breaching` is set `true` in exactly two places (pair creation and the
existing-pair update), and both of those same code paths unconditionally also set
`breachedSince`. There is no path where `breaching === true` and `breachedSince` is `undefined`.
I also confirmed `elapsedMs` can never be negative: `lastObservedAt` is the max timestamp over
*all* readings in the batch (which includes every breaching reading), and `breachedSince` is the
min timestamp over just the breaching subset, so `lastObservedAt >= breachedSince` always holds
regardless of the order readings arrive in.

The cast `state.breachedSince as Date` matches the existing idiom already used four lines below
it in the same `insertOne` document (`breached_since: state.breachedSince as Date`) — per the
brief's instruction, I did not introduce a new narrowing scheme. `fired_at: now` (not the in-batch
timestamp) was already correct in the surrounding code and required no change; I added a test that
verifies this explicitly (see Test 1 below) since the brief called it out as a requirement, not
just an observation.

Nothing else in the file changed. Diff is 10 lines in `evaluate.ts`, all inside the new-episode
branch:

```
-          const firesImmediately = (rule.for_duration_seconds ?? 0) === 0;
+          // Symmetric with the promotion branch below: ...
+          const elapsedMs =
+            state.lastObservedAt.getTime() - (state.breachedSince as Date).getTime();
+          const firesImmediately = elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000;
           const _id = new Types.ObjectId();
```

The `try { … } finally { … }` from `fd1966d`, the write-reconciliation query (Step 8), the E11000
absorb block (Step 7's catch), and `validateRule`/`skipRule`/`ruleObjectId` from `84eb30c` are all
untouched — confirmed by reading `git show 84eb30c -- lib/alerting/evaluate.ts` before editing and
by the final diff below containing nothing outside the fire/pending decision.

## Files changed

- `lib/alerting/evaluate.ts` — the predicate fix (+10/-1 lines).
- `__tests__/unit/lib/alerting/evaluate.test.ts` — 3 new tests (+59 lines). No existing test's
  assertions were changed (see "Existing tests" below).

## Tests

All four scenarios from the brief are covered. Three are new; the fourth (`for_duration_seconds:
0` still fires) was already covered by an existing test, which I re-verified still discriminates
meaningfully under the new code (see its mutation result below) rather than assuming it does.

Placed between the existing "should open a pending alert when for_duration_seconds is set" test
and "should promote pending to firing once the duration elapses" test, so duration-related tests
stay grouped: single-reading duration tests, then multi-reading in-batch duration tests (this
fix), then the cross-batch promotion test.

Command used throughout: `npx jest --selectProjects node --testPathPatterns "unit/lib/alerting/evaluate" -t "<name>"`.
I switched from `pnpm test --` to `npx jest` directly per the task instructions — confirmed the
`pnpm test --` arg-forwarding quirk myself: passing an additional `--testNamePattern` through
`pnpm test -- ...` silently ran the *entire* suite instead of the one named test (see Test 1 below,
first attempt), while `npx jest ... -t "..."` correctly isolated to a single test.

### Test 1 — "should fire immediately when a single batch already spans the full for_duration_seconds"

Rule `for_duration_seconds: 60`; one batch, two readings at `t0` and `t0+120s` (both breaching).
Asserts `result.fired` has length 1, stored status is `firing`, `breached_since` is `t0`, and
`fired_at` falls between timestamps captured immediately before/after the call (proving it's the
evaluation's wall-clock `now`, not the in-batch `t1`).

This is the brief's explicitly-required "verify this fails against the current code" test.

- **Mutation**: full revert of the predicate to `(rule.for_duration_seconds ?? 0) === 0`.
- **Failing output before** (`npx jest -t "should fire immediately when a single batch already spans the full for_duration_seconds"`):
  ```
  expect(received).toHaveLength(expected)
  Expected length: 1
  Received length: 0
  Received array:  []
    > 161 |     expect(result.fired).toHaveLength(1);
  Tests: 1 failed, 36 skipped, 37 total
  ```
- **Passing output after** (fix restored):
  ```
  Tests: 36 skipped, 1 passed, 37 total
  ```

### Test 2 — "should stay pending when a single batch's breach span is shorter than for_duration_seconds"

Rule `for_duration_seconds: 60`; one batch, two readings at `t0` and `t0+30s` (both breaching,
elapsed 30s < 60s). Asserts `result.fired` has length 0, `result.pendingOpened` is 1, stored
status is `pending`, `fired_at` is undefined.

Note: this scenario does not discriminate a full revert to the pre-fix code (old code also stays
`pending` here, just because it never looks at elapsed time at all for a nonzero duration — not
because it correctly computed 30s < 60s). So instead of the full-revert mutation, I mutated the
specific thing this test is responsible for guarding: that the new elapsed-based logic doesn't
over-fire.

- **Mutation**: `const firesImmediately = elapsedMs >= 0;` (drops the duration threshold entirely
  — elapsedMs is always ≥ 0, so this always fires).
- **Failing output before**:
  ```
  expect(received).toHaveLength(expected)
  Expected length: 0
  Received length: 1
  Received array:  [{"_id": "...", "fired_at": "2026-08-03T23:16:22.663Z", ...}]
    > 183 |     expect(result.fired).toHaveLength(0);
  Tests: 1 failed, 36 skipped, 37 total
  ```
- **Passing output after** (fix restored):
  ```
  Tests: 36 skipped, 1 passed, 37 total
  ```

### Test 3 — "should fire when a single batch spans exactly for_duration_seconds (inclusive boundary)"

Rule `for_duration_seconds: 60`; one batch, two readings at `t0` and exactly `t0+60s`
(`elapsedMs === duration * 1000` exactly). Asserts `result.fired` has length 1, status `firing`.

This is the brief's mandated `>=` vs `>` boundary check.

- **Mutation**: operator changed from `>=` to `>`.
- **Failing output before**:
  ```
  expect(received).toHaveLength(expected)
  Expected length: 1
  Received length: 0
  Received array:  []
    > 199 |     expect(result.fired).toHaveLength(1);
  Tests: 1 failed, 36 skipped, 37 total
  ```
- **Passing output after** (fix restored):
  ```
  Tests: 36 skipped, 1 passed, 37 total
  ```

As a bonus check (not required, but directly relevant to whether this boundary is *actually*
guarded twice), I re-ran the **existing** "should open a firing alert immediately when
for_duration_seconds is 0" test under the same `>` mutation: a single-reading batch has
`elapsedMs === 0`, which is also an equality-boundary case (`0 >= 0*1000`). It failed identically:
  ```
  expect(received).toHaveLength(expected)
  Expected length: 1
  Received length: 0
  Received array:  []
    > 111 |     expect(result.fired).toHaveLength(1);
  Tests: 1 failed, 36 skipped, 37 total
  ```
  Restored, passes again. This confirms the pre-existing duration:0 test is not vacuous under the
  new code either — it independently guards the same `>=` boundary from a different angle
  (duration 0 vs. duration 60), rather than only working "by coincidence" via the old
  `=== 0` special case.

## Existing tests

No existing test's assertions were changed. I checked every `for_duration_seconds`-adjacent
existing test against the new predicate by hand before touching anything:

- **"should open a firing alert immediately when for_duration_seconds is 0"** (single reading,
  duration 0): `elapsedMs = 0`, `0 >= 0*1000` → fires. Same outcome as before, and — as shown
  above — still a genuine (not vacuous) boundary check under the new code.
- **"should open a pending alert when for_duration_seconds is set"** (single reading, duration
  300): `elapsedMs = 0`, `0 >= 300*1000` → false → pending. Same outcome as before.
- **"should promote pending to firing once the duration elapses"** (two separate batches):
  exercises the *promotion* branch (`existing` is truthy from the first batch), which this task
  did not touch at all.

All three passed unmodified both before and after my change (confirmed by the full focused-suite
run below, which includes them unchanged).

## Full suite

Baseline stated in the task: 2218 passing / 82 suites (`npx jest --selectProjects node`).

Focused suite (`npx jest --selectProjects node --testPathPatterns "unit/lib/alerting/evaluate"`),
final state:
```
Test Suites: 1 passed, 1 total
Tests:       37 passed, 37 total
```
34 pre-existing + 3 new, all passing.

Full project, final state (`npx jest --selectProjects node`):
```
Test Suites: 82 passed, 82 total
Tests:       2221 passed, 2221 total
Snapshots:   0 total
Time:        37.8s
```
2221 = 2218 + 3 new tests. 82 suites, matching baseline exactly — no suite gained or lost, no
regression anywhere in the project.

TypeScript: `npx tsc --noEmit` — 39 errors, matching the documented pre-existing baseline from
Task 3's report exactly (0 new; none in `evaluate.ts` or `evaluate.test.ts`).
ESLint: `npx eslint .` — 311 problems (308 errors, 3 warnings), matching the documented
pre-existing baseline exactly (0 new; `npx eslint` on just the two changed files reports 0
problems).
Prettier: `lib/alerting/evaluate.ts` is fully clean (`npx prettier --check`). The test file is
**not** fully clean, but every flagged line predates this task — confirmed by running
`prettier --check` against the `git show HEAD:...` (pre-task) copy of the file, which fails
identically. I deliberately did not run a whole-file `prettier --write` on the test file: doing so
once reformatted four pre-existing, unrelated blocks (the `reading()` helper's signature, the
`extractWriteErrors` array-literal tests, one array argument in an unrelated `evaluateReadings`
call, and one object argument in the anomaly_score test) as a side effect. I reverted those and
kept the diff scoped to my 3 new tests only — none of my added lines are prettier violations
(verified: `prettier --write` left them untouched on the second pass, since the only "violations"
in my additions are long string literals in `it(...)` names, which prettier does not wrap).

## Self-review findings (fixed before reporting)

1. **Comment imprecision** — my first draft of the source comment said the matching cast was
   used "a few lines down," which undersold that it's inside the very next `insertOne` document
   literal (18 lines away, but same block, no intervening branches). Reworded to "in the insertOne
   document just below" for precision.
2. **Prettier scope creep** — running `prettier --write` on the whole test file reformatted
   pre-existing code unrelated to this task (see above). Caught by reviewing the diff before
   committing; reverted the unrelated hunks by hand and confirmed against the pre-task file that
   those violations already existed. Kept the diff to exactly my 3 additions.
3. **Verified the "breachedSince is always set" claim rather than asserting it** — since the whole
   fix rests on that invariant being true (it's what justifies the cast), I traced every write to
   `.breaching` and `.breachedSince` in the reduction loop (grepped for all `.breaching` sites:
   exactly two, both already paired with a `breachedSince` write) instead of taking the brief's
   suggested code at face value. Documented in "What I implemented" above.
4. **Naming/YAGNI** — used the exact names (`elapsedMs`, `firesImmediately`) and cast idiom the
   brief specified and the file already uses elsewhere; did not introduce a type guard, a helper
   function, or any other new abstraction. The change is additive to one `if` block only.
5. **Confirmed each test verifies behavior, not mocks** — all three new tests call
   `evaluateReadings()` directly against the real (in-memory) MongoDB and assert on
   `result.fired`/`result.pendingOpened`/`result.pendingCleared` and a `AlertV2.findOne({}).lean()`
   read of the actual written document. No spies or mocks are involved in any of the three.
6. **Test 2's mutation choice** — my first instinct was to reuse the "full revert" mutation for
   every test, matching Test 1 and Test 3. For Test 2 that would have been a silent no-op (old
   code already stays pending here, for an unrelated reason), which I caught before running
   anything by reasoning through what old code actually does for a nonzero duration — not by
   observing a false pass. Chose a mutation that targets what Test 2 specifically guards (the
   over-firing case) instead, and reported the reasoning above rather than omitting it.

## Concerns

None that block this task.

- The task brief's line numbers (`:236`, `:276-278`) refer to a slightly earlier snapshot than
  `84eb30c` (I found the new-episode branch at `:328` and the promotion branch's `elapsedMs` at
  `:369-370` before editing). Content and logic matched exactly; this is line drift from planning
  against an earlier commit, same as noted in Task 3's report, not a sign of editing the wrong
  spot.
- `pnpm test -- --selectProjects node --testPathPatterns ... --testNamePattern ...` does not
  reliably forward the `--testNamePattern` flag (it silently ran the full 37-test suite instead of
  one test on my first attempt at Test 1's mutation check). This is the same class of issue as the
  documented `pnpm test --` quirk for the full project. I used `npx jest ... -t "..."` for every
  per-test isolation in this report instead, which worked correctly every time.

## Verification commands run

```
npx jest --selectProjects node --testPathPatterns "unit/lib/alerting/evaluate"   # 37 passed, 1 suite
npx jest --selectProjects node                                                   # 2221 passed, 82 suites
npx tsc --noEmit -p tsconfig.json                                                # 39 errors (baseline, 0 new)
npx eslint lib/alerting/evaluate.ts __tests__/unit/lib/alerting/evaluate.test.ts # 0 problems
npx eslint .                                                                     # 311 problems (baseline, 0 new)
npx prettier --check lib/alerting/evaluate.ts                                    # clean
```
