# Task 3 Report: Per-rule error boundary in the evaluator

Branch `feat/phase-4-alerting`, worktree `/home/yzel/github/infrasight-phase4`.
Started at `746112d`. Commit: `84eb30c`.

## What I implemented

`lib/alerting/evaluate.ts` had two unguarded throw sites reachable from rule
data that never gets re-validated (a `.lean()` Mongo read, or a Redis JSON
round trip):

1. `METRIC_ACCESSORS[rule.metric](reading)` — `rule.metric` outside the
   `value | anomaly_score | battery_level` union made this `undefined(reading)`
   → `TypeError`.
2. `new Types.ObjectId(rule._id)` (two call sites: building `ruleObjectIds`
   for the episode query, and constructing a new episode's `rule_id` on
   insert) — a non-hex `rule._id` threw `BSONError`.

Neither was caught inside `evaluateReadings`; only the outermost wrapper in
`lib/alerting/index.ts` caught it, at the cost of throwing away the *entire*
batch's decisions — every rule, every device, every reading.

### The fix

- **`validateRule(rule)`** (new, local to `evaluateReadings`): checks
  `METRIC_ACCESSORS[rule.metric]` is a function (item 2, explicit — no
  reliance on the call throwing) and `Types.ObjectId.isValid(rule._id)` (item
  3, same explicit style) before a rule is allowed to contribute anything to
  `pairs`. A rule that fails either check never reaches either original throw
  site. The result — `{ accessor, ruleObjectId }` — is memoized in
  `ruleValidationCache: Map<string, RuleValidation | null>`, keyed by rule id.
- **`PairState` gained a `ruleObjectId: Types.ObjectId` field**, set once when
  a pair is first created from `validation.ruleObjectId`. Both original throw
  sites (`ruleObjectIds` construction at Steps 4-5, and the `insertOne`
  document's `rule_id` at Step 6) now read `state.ruleObjectId` /
  `p.ruleObjectId` instead of re-parsing `rule._id`. This satisfies item 3 by
  construction: since only validated rules ever produce a `PairState`, neither
  site can throw — I don't rely on two independent local guards duplicating
  the same check.
- **The per-`(reading, rule)` matching and metric extraction is wrapped in its
  own `try/catch`** (item 1) — this is the general safety net for anything
  `validateRule` doesn't anticipate, e.g. `matchesSelector` throwing on a
  `selector.tags` that is a string instead of an array (verified for real in
  testing below — this is not hypothetical).
- **`skipRule(rule, error, reason)`** is the single funnel for every skip
  path (unknown metric, invalid id, or the general catch). It logs
  `{ ruleId, ruleName, metric, error }` at `error` level and calls the new
  counter, gated by `reportedSkips: Set<string>` so a rule is logged/counted
  **at most once per `evaluateReadings()` call** (item 5), not once per
  reading.
- **`recordAlertRuleSkipped(reason)`** — new counter in
  `lib/monitoring/metrics.ts`, following `recordAlert`'s existing shape
  exactly: a `Map<string, CounterEntry>` (`alertRulesSkipped`), a recording
  function, wiring into `getMetricsSnapshot()` (`alerts.rulesSkipped`) and
  `getPrometheusMetrics()` (`alert_rules_skipped_total{reason="..."}`), and
  `resetMetrics()`. Exported through `lib/monitoring/index.ts` alongside a new
  `AlertRuleSkipReason` type (`'unknown_metric' | 'invalid_rule_id' |
  'unexpected_error'`). I deliberately did **not** reuse the existing
  `recordAlert('evaluation_error')` counter — that one means "the whole call
  threw" (incremented only in `lib/alerting/index.ts`'s outer catch); reusing
  it here would conflate "evaluation failed entirely" with "evaluation
  succeeded, one rule was skipped," which is exactly the distinction this task
  exists to preserve.

Nothing else in `evaluate.ts` changed: the `try { … } finally { … }`
structure from `fd1966d` is untouched, the reconciliation query (Step 8) is
untouched, the E11000 absorb block (Step 7's catch) is untouched, and the
`recordAlert('fired'/'resolved')` calls from `746112d` are untouched.

### Why I scoped the boundary where I did (the design-guidance tension)

The brief's design guidance flagged that "scope the boundary so one bad rule
cannot take out the batch" and "log at most once per rule per call" pull in
different directions, and offered two valid resolutions: a set of
already-reported rule ids, or hoisting the once-per-rule checks out of the
reading loop. **I used both, for different reasons, and this is the one
finding from my own testing that changed the design:**

- `ruleValidationCache` hoists the *checking* work (metric-accessor lookup,
  id parsing) out of the reading loop. This is a pure memoization/DRY
  optimization — a rule bucketed under several reading types, or evaluated
  against many readings of the same type, is checked once, not once per
  reading. It is not required for correctness (skipping the checks and
  redoing them every reading would still produce a correct final count and
  log), but it matches the file's existing performance ethos (the `byType`
  bucketing exists for exactly this reason) and directly matches the brief's
  "hoisting" suggestion.
- `reportedSkips` is the mechanism that actually *enforces* "once per call."
  I initially assumed `ruleValidationCache` alone would guarantee this for
  every skip path, and wrote my "log once per call" test against an
  `unknown_metric` rule. Mutation testing (below) proved that test vacuous:
  because `validateRule`'s cache already short-circuits repeat calls for a
  rule it has already rejected, deleting `reportedSkips` entirely did not
  fail that test. `reportedSkips` is what actually matters for the *general
  catch-all* path — a rule that has a valid metric and a valid id (so it
  clears `validateRule` and is cached as **good**) but whose `matchesSelector`
  throws on every single reading of a matching type. Without `reportedSkips`,
  that case logs and counts once per reading, which is precisely what item 5
  forbids. I rewrote the test to target that path instead (see below), and
  kept `reportedSkips` — it is load-bearing, just not for the path I first
  tested it against.

## Files changed

- `lib/alerting/evaluate.ts` — the boundary itself.
- `lib/monitoring/metrics.ts` — `recordAlertRuleSkipped`, `AlertRuleSkipReason`, wiring into snapshot/Prometheus/reset.
- `lib/monitoring/index.ts` — export the two new symbols.
- `__tests__/unit/lib/alerting/evaluate.test.ts` — `seedRawRule()` helper (raw driver insert, bypassing Mongoose schema validation — this is how a malformed rule actually reaches the evaluator) and 5 new tests.
- `__tests__/unit/lib/metrics.test.ts` — 3 new tests for `recordAlertRuleSkipped`, plus one added assertion to the existing `resetMetrics()` "should clear all recorded metrics" test (strengthened, not weakened).

## Tests, with mutation / before / after (per Global Constraint 2 and the anti-vacuity requirement)

All of the following were run with:
`pnpm test -- --selectProjects node --testPathPatterns "unit/lib/alerting/evaluate"` (or `unit/lib/metrics` for the metrics-only ones). Full, unedited command output is summarized below; nothing here is inferred.

### 1. "should skip a rule with an unknown metric and still fire the valid rule"

- **Mutation A — full revert** of `evaluate.ts` to `746112d` (`git show 746112d:lib/alerting/evaluate.ts > lib/alerting/evaluate.ts`):
  ```
  TypeError: selector_1.METRIC_ACCESSORS[rule.metric] is not a function
    at evaluateReadings (lib/alerting/evaluate.ts:138:58)
  ```
  Test **FAILS** (throws instead of returning a result).
- **Mutation B — narrower**: delete only the explicit `typeof accessor !== 'function'` guard (item 2), leaving the id guard and the general catch in place. Result: the batch is *not* aborted (the general catch still saves it, labeled `unexpected_error`), but the label this test asserts is wrong:
  ```
  ✕ should skip a rule with an unknown metric and still fire the valid rule
  Received: "...alert_rules_skipped_total{reason=\"unexpected_error\"} 1..."
  ```
  Test **FAILS** on the Prometheus assertion specifically — proving the test checks the *explicit* guard, not merely "some guard exists."
- **Restored**: `✓ should skip a rule with an unknown metric and still fire the valid rule (26 ms)`. Test **PASSES**.

### 2. "should skip a rule with a non-hex _id and still fire the valid rule"

- **Mutation A — full revert**:
  ```
  BSONError: input must be a 24 character hex string, 12 byte Uint8Array, or an integer
    at new ObjectId (node_modules/.pnpm/bson@7.0.0/node_modules/bson/src/objectid.ts:113:15)
    at lib/alerting/evaluate.ts:180:13
    at evaluateReadings (lib/alerting/evaluate.ts:179:82)
  ```
  Test **FAILS**.
- **Mutation B — narrower**: delete only `if (!Types.ObjectId.isValid(rule._id)) { … }` (item 3), leaving `new Types.ObjectId(rule._id)` to run unguarded inside `validateRule`:
  ```
  BSONError: input must be a 24 character hex string, 12 byte Uint8Array, or an integer
    at validateRule (lib/alerting/evaluate.ts:173:64)
  Tests: 1 failed, 33 passed, 34 total
  ```
  Only this one test fails — confirms the guard is precisely, not incidentally, load-bearing.
- **Restored**: `✓ should skip a rule with a non-hex _id and still fire the valid rule (10 ms)`. Test **PASSES**.

### 3. "should count a skipped rule via getMetricsSnapshot()"

- **Mutation A — full revert**: same `TypeError` as test 1 (this test also relies on an unknown-metric rule). **FAILS**.
- **Mutation B — narrower**: delete the `recordAlertRuleSkipped(reason)` call in `skipRule` (keep the log call). This is the exact anti-vacuity check the brief calls out by name:
  ```
  Tests: 4 failed, 30 passed, 34 total
  ```
  4 of my 5 new tests fail (every one that asserts on the counter); the log-shape test (which only spies on `logger.error`) still passes, correctly isolating what each test actually checks.
- **Restored**: `✓ should count a skipped rule via getMetricsSnapshot() (6 ms)`. **PASSES**.

### 4. "should log the skipped rule with ruleId, ruleName, metric, and error"

- **Mutation A — full revert**: same `TypeError` as test 1. **FAILS**.
- **Mutation B — narrower**: delete the `logger.error(...)` call in `skipRule` (keep the counter call):
  ```
  Tests: 2 failed, 32 passed, 34 total
  ```
  Exactly the 2 tests that assert on `logger.error` fail (this one, and test 5's call-count assertion); the 3 counter-only tests still pass.
- **Restored**: `✓ should log the skipped rule with ruleId, ruleName, metric, and error (5 ms)`. **PASSES**.

### 5. "should log and count a fleet-wide bad rule at most once per call, not once per reading"

This test went through two versions; both are reported below because the first version's vacuity is itself a finding (see Self-review).

- **First version** (rule with `metric: 'not_a_real_metric'`, 3 readings): passed against the fix. Mutation-tested by deleting `if (reportedSkips.has(rule._id)) return;`:
  ```
  Tests: 34 passed, 34 total
  ```
  **Test still passed with the dedup guard deleted.** This is vacuous — `validateRule`'s own cache was already preventing repeat calls to `skipRule` for this rule (it's rejected once, cached as `null`, never re-checked), independent of `reportedSkips`. I rewrote the test.
- **Rewritten version**: a rule with a *valid* metric and a valid (auto-generated) id, so it clears `validateRule` and is cached as **good** — but `selector: { types: ['temperature'], tags: 'not-an-array' }`, so `matchesSelector` throws (`selector.tags.every is not a function`, a string has no `.every`) on every reading of a matching type, independent of `validateRule`'s cache.
  - **Mutation A — full revert**:
    ```
    TypeError: selector.tags.every is not a function
      at matchesSelector (lib/alerting/selector.ts:68:24)
      at evaluateReadings (lib/alerting/evaluate.ts:136:29)
    Tests: 5 failed, 39 passed, 44 total
    ```
    **FAILS** (batch aborted, as the brief describes).
  - **Mutation B — narrower**: delete only `if (reportedSkips.has(rule._id)) return;`, keeping everything else fixed:
    ```
    expect(jest.fn()).toHaveBeenCalledTimes(expected)
    Expected number of calls: 1
    Received number of calls: 3
    Tests: 1 failed, 33 passed, 34 total
    ```
    **FAILS**, and only this one test — three readings against the one bad rule logged three times, exactly the flood item 5 forbids. This is the real proof `reportedSkips` matters.
  - **Restored**: `✓ should log and count a fleet-wide bad rule at most once per call, not once per reading (5 ms)`. **PASSES**.

### 6-8. `lib/monitoring/metrics.ts` unit tests (`recordAlertRuleSkipped`)

- **"should count skipped rules by reason"** and **"should expose skipped rule counts via getMetricsSnapshot()"**: mutated `recordAlertRuleSkipped` to an empty body:
  ```
  ✕ should count skipped rules by reason
  ✕ should expose skipped rule counts via getMetricsSnapshot()
  Tests: 2 failed, 45 passed, 47 total
  ```
  Both **FAIL**; restored, both **PASS**.
- **"should be reset by resetMetrics"**: the relevant mutation for *this* test is not `recordAlertRuleSkipped` itself (a no-op function trivially "resets" too) but `resetMetrics()`'s `metrics.alertRulesSkipped.clear()`. Deleting that line:
  ```
  ✕ should clear all recorded metrics          (resetMetrics() describe block — I added an assertion here too)
  ✕ should be reset by resetMetrics             (recordAlertRuleSkipped describe block)
  Tests: 3 failed, 44 passed, 47 total
  ```
  Both **FAIL** (the third failure, "should count skipped rules by reason," is a cascading side effect of broken cross-test isolation once `resetMetrics` stops clearing that map — not a flaw in that test). Restored, all **PASS**.

## Full suite

Baseline before starting: 2210 passing / 82 suites (confirmed by reading the task instructions; not independently re-verified against a byte-for-byte 746112d checkout beyond the per-test reverts above, which exercised that exact commit).

Final, from the committed state (`84eb30c`), `npx jest --selectProjects node`:
```
Test Suites: 82 passed, 82 total
Tests:       2218 passed, 2218 total
Snapshots:   0 total
Time:        32.883 s
```
2218 = 2210 + 8 new tests (5 in `evaluate.test.ts`, 3 in `metrics.test.ts`; the one strengthened assertion in an existing test adds no new test count). 82 suites, matching baseline exactly — no suite gained or lost.

TypeScript: `npx tsc --noEmit` — 39 errors, matching the documented pre-existing baseline exactly (0 new).
ESLint: `npx eslint .` — 311 problems (308 errors, 3 warnings), matching the documented pre-existing baseline exactly (0 new).
Prettier: my additions are clean (`npx prettier --check` on the 5 changed files); the 4 remaining reported lines are all pre-existing code I did not touch (verified line-by-line via diff — `recordAlert`'s pre-existing label ternary in `metrics.ts`, and three pre-existing lines in `evaluate.test.ts`'s `reading()` helper and older tests).

## Self-review findings (fixed before reporting)

1. **A vacuous test, found by my own mutation testing** — described in full under test 5 above. The first version of the "once per call" test happened to be protected by `ruleValidationCache`'s memoization rather than by the `reportedSkips` Set it was meant to verify, so deleting the dedup guard left it green. Rewrote it against a rule that passes `validateRule` (valid metric + id) but fails matching on every reading, which isolates `reportedSkips` from the other cache. Re-verified: fails without the guard (3 calls instead of 1), passes with it.
2. **A backwards comment** — a comment at the `ruleObjectIds` construction site called itself "the second of the two conversions," but it is textually and executionally the *first* of the two original throw sites (Steps 4-5 runs before Step 6's `insertOne`). Rewrote to state the fact plainly without an ordinal claim that could be wrong.
3. **An imprecise comment** — the block above `ruleValidationCache`/`reportedSkips` originally implied `validateRule`'s cache alone was responsible for "checked and logged once per call," which is the same wrong mental model that produced finding 1. Rewrote to name both caches and state precisely what each one is for, including the case (`ruleValidationCache` passes, matching still throws) that only `reportedSkips` covers.
4. **Naming** — renamed the local `Map<string, RuleValidation | null>` from `ruleValidation` to `ruleValidationCache`. The old name read as if it held a single validation result rather than a cache of them, and collided visually with the `RuleValidation` type and `validateRule` function.
5. **Prettier** — two lines I added exceeded the project's configured `printWidth: 100` (one HELP comment in `metrics.ts`, one assertion in `metrics.test.ts`). Reformatted to match; left pre-existing violations elsewhere in the touched files alone (out of scope).
6. **Comment-vs-code check on the rest of the diff** — re-read every comment I added against the code it sits next to (the `PairState.ruleObjectId` doc comment, the `RuleValidation` interface doc, the per-rule try/catch comment, the Step 4-5 comment after the fix above) and confirmed each describes what the code actually does, not what I intended it to do.
7. **YAGNI check** — considered and rejected adding redundant try/catch guards directly at the two original `new Types.ObjectId(rule._id)` call sites in addition to the upfront `validateRule` check, since the sites are now unreachable for an invalid id by construction (verified by mutation testing: removing the upfront guard reproduces the exact original throw at the exact original site) — duplicate guards there would be dead code. Considered and rejected a fourth `AlertRuleSkipReason` value for finer-grained "which exact exception" reporting — `unexpected_error` plus the logged `error` message already carries that detail; a name-only label would just be `unexpected_error` restated.

## Concerns

None that block this task. Two observations for whoever picks up later work in this subsystem, not fixed here per scope discipline (Global Constraint 9):

- `compare()`'s `default: return false` (in `selector.ts`) means an unrecognized `rule.comparison` silently never breaches, rather than being surfaced as a skip. This is explicitly listed as out of scope in the plan file, so I left it, but it's the same class of defect as this task and would be a natural follow-on.
- The brief's line numbers (`:127`, `:171`, `:244`) refer to a slightly different layout than what I found at `746112d` (my full-revert testing showed the accessor call at `:138` and the first `ObjectId` conversion at `:180`); the content and both throw sites matched exactly, so I'm confident this is just line drift from planning against an earlier snapshot, not a sign I fixed the wrong thing.

## Verification commands run

```
pnpm test -- --selectProjects node --testPathPatterns "unit/lib/alerting"   # 84 passed, 4 suites
pnpm test -- --selectProjects node --testPathPatterns "unit/lib/metrics"    # 47 passed, 1 suite
npx jest --selectProjects node                                              # 2218 passed, 82 suites
npx tsc --noEmit                                                            # 39 errors (baseline)
npx eslint .                                                                # 311 problems (baseline)
npx prettier --check <5 changed files>                                     # clean except pre-existing, untouched lines
```
