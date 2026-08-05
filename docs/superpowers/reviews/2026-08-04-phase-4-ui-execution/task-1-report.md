# Task 1 Report: AlertRuleV2 model

## What I implemented

Exactly the brief's scope, no more:

- `models/v2/AlertRuleV2.ts` (new) — the `AlertRuleV2` Mongoose model: `READING_TYPES` constant (15 reading types, `satisfies readonly ReadingType[]`), `AlertMetric`/`AlertComparison`/`AlertSeverity` types, `IAlertRuleSelector`/`IAlertRuleAudit`/`IAlertRuleV2` interfaces, the schema (with `SelectorSchema` and `AuditSchema` sub-schemas), two compound indexes, `pre('save')`/`pre('findOneAndUpdate')` middleware to bump `audit.updated_at`, and `findActive`/`softDelete` statics. Collection: `alert_rules_v2`.
- `__tests__/unit/models/AlertRuleV2.test.ts` (new) — 9 unit tests, verbatim from the brief.
- `__tests__/setup/factories.ts` (modified) — appended `AlertRuleInput` interface and `createAlertRuleInput()` factory verbatim from the brief; added `alertRuleCounter = 0;` to `resetCounters()`.
- `scripts/v2/create-indexes-v2.ts` (modified) — added `ALERT_RULE_V2_INDEXES` (2 index definitions) next to `DEVICE_V2_INDEXES`/`READING_V2_INDEXES` (there is no `SCHEDULE_V2_INDEXES` in this file — the brief's reference to it doesn't match what's actually in the file; I followed the `devices_v2`/`readings_v2` call shape instead, which does exist). Registered `alert_rules_v2` index creation, verification, and summary-stat aggregation inside `createIndexes()` following the exact pattern used for the other two collections.
- `scripts/v2/verify-indexes.ts` (modified) — imported `AlertRuleV2` model (schema registration side effect), added `EXPECTED_ALERT_RULE_INDEXES`, a full verification block mirroring the `DeviceV2`/`ReadingV2` blocks (current indexes, expected-index checklist with ✓/✗ coloring), and a collection-stats entry for `alert_rules_v2`.

**Did not touch** the `IndexDefinition.options` type (no `partialFilterExpression` needed for these two plain compound indexes, per the brief's explicit scope note reserving that widening for Task 2).

## Two deliberate deviations from the brief's literal Step 3 code (both required to make the brief's own tests pass / gates green)

1. **`SelectorSchema.types` needed `default: undefined`.** The brief's Step 3 code for `types: { type: [String], enum: ... }` has no explicit default. Mongoose gives array paths an implicit default of `[]` when none is set, so `AlertRuleV2.create({ selector: {} })` produced `rule.selector.types === []`, not `undefined` — failing the brief's own test `'should allow a rule with no selector types (fleet-wide)'` (`expect(rule.selector.types).toBeUndefined()`). Fixed by adding `default: undefined` to `types`, and applied the same fix to `tags` for consistency (same "absent = no constraint" semantics documented on `IAlertRuleSelector`, untested by Task 1 but same latent bug). Confirmed via RED run before the fix (see below) and GREEN after.
2. **`Types` import needed to be type-only.** The brief's Step 3 import line (`import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';`) is copied verbatim from `ScheduleV2.ts`, which itself trips `@typescript-eslint/consistent-type-imports` (this is baseline debt — `models/v2/ScheduleV2.ts|@typescript-eslint/consistent-type-imports` is already in `lint-baseline-sorted.txt`). Since `Types` is used only as a type (`_id: Types.ObjectId`) in the new file too, replicating the same import would add a **new** file|rule entry not covered by baseline, failing `lintcheck`. Fixed by importing `type Types` instead — behaviorally identical, cleaner, and keeps the gate honest rather than growing the debt pile.

## Baseline file correction (mechanical, not a code change)

Adding `alertRuleCounter = 0;` inside `resetCounters()` (which precedes line 136 in `factories.ts`) shifted every subsequent line down by one. This moved the pre-existing, out-of-scope `calibration_date` type error in `factories.ts` from line 136 to line 137 — same file, same message, same column, one line lower. `tscheck`'s diff is line-exact, so it read this as a "new" error. Verified with `npx tsc --noEmit | grep factories.ts` that only this one line-shifted entry exists (no genuinely new error). Updated the recorded line number (136→137) for this single entry in both `.superpowers/sdd/2026-08-01-alerting-subsystem/tsc-baseline.txt` and `tsc-baseline-sorted.txt` to match. These baseline files are gitignored (`.superpowers/sdd/.gitignore` excludes the whole directory), so this correction does not appear in `git status` and is not part of the commit — it only affects local gate-script behavior in this worktree.

## TDD Evidence

**RED** — `pnpm test __tests__/unit/models/AlertRuleV2.test.ts`, before `models/v2/AlertRuleV2.ts` existed:

```
FAIL node __tests__/unit/models/AlertRuleV2.test.ts
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/models/v2/AlertRuleV2 mapped as:
    /home/yzel/github/infrasight-phase4/$1.
...
      3 |  */
      4 |
    > 5 | import AlertRuleV2, { READING_TYPES } from '@/models/v2/AlertRuleV2';
        | ^

Test Suites: 1 failed, 1 total
Tests:       0 total
```

Expected failure per brief Step 2 (`Cannot find module`) — confirmed.

**RED (intermediate)** — after writing the model from the brief's Step 3 code verbatim (before the `default: undefined` fix), the same command gave:

```
Test Suites: 1 failed, 1 total
Tests:       1 failed, 8 passed, 9 total

  ● AlertRuleV2 Model › document creation › should allow a rule with no selector types (fleet-wide)

    expect(received).toBeUndefined()
    Received: []
      39 |       expect(rule.selector.types).toBeUndefined();
```

This confirmed the Mongoose array-default gap described above.

**GREEN** — `pnpm test __tests__/unit/models/AlertRuleV2.test.ts`, after adding `default: undefined`:

```
PASS node __tests__/unit/models/AlertRuleV2.test.ts
  AlertRuleV2 Model
    document creation
      ✓ should create a rule with defaults applied (24 ms)
      ✓ should allow a rule with no selector types (fleet-wide) (5 ms)
      ✓ should reject an unknown metric (7 ms)
      ✓ should expose all 15 reading types (3 ms)
    findActive
      ✓ should exclude soft-deleted rules (21 ms)
      ✓ should accept an additional filter (8 ms)
    softDelete
      ✓ should stamp deleted_at and deleted_by (5 ms)
      ✓ should return null for an unknown id (3 ms)
    middleware
      ✓ should bump audit.updated_at on findOneAndUpdate (10 ms)

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

## Full-suite verification

`pnpm test` (whole repo), after all changes:

```
Test Suites: 86 passed, 86 total
Tests:       2182 passed, 2182 total
Snapshots:   0 total
Time:        34.872 s
```

Baseline was 85 suites / 2173 tests. Delta is exactly +1 suite / +9 tests — this task's file, nothing else moved.

## Gate results

`./.superpowers/sdd/2026-08-01-alerting-subsystem/tscheck`:
```
OK: no new type errors (39 total, all pre-existing baseline).
```

`./.superpowers/sdd/2026-08-01-alerting-subsystem/lintcheck`:
```
OK: no new lint problems (311 total, all pre-existing baseline).
```

Both exit 0.

## Files changed

- `models/v2/AlertRuleV2.ts` (new)
- `__tests__/unit/models/AlertRuleV2.test.ts` (new)
- `__tests__/setup/factories.ts` (modified — factory + resetCounters entry)
- `scripts/v2/create-indexes-v2.ts` (modified — `ALERT_RULE_V2_INDEXES` + wiring)
- `scripts/v2/verify-indexes.ts` (modified — import, `EXPECTED_ALERT_RULE_INDEXES`, verification block, stats entry)
- `.superpowers/sdd/2026-08-01-alerting-subsystem/tsc-baseline.txt`, `tsc-baseline-sorted.txt` (gitignored, local-only line-number correction; not committed)

## Self-review findings

- **Completeness vs. brief**: all "Produces" interface items present and exported with the exact names/shapes specified (`AlertMetric`, `AlertComparison`, `AlertSeverity`, `READING_TYPES`, `IAlertRuleSelector`, `IAlertRuleV2`, `findActive`, `softDelete`, `createAlertRuleInput`). Nothing extra added (no API route, no validation schema — those are later tasks per the brief's "Consumes: nothing").
- **Naming**: matches `ScheduleV2.ts`/`DeviceV2.ts` conventions exactly (`I<Name>` interfaces, `<Name>Schema`, `<Name>Model` static-method interface, `mongoose.models.X || mongoose.model()` guard).
- **YAGNI**: no speculative fields, no extra statics, no extra indexes beyond the brief's two.
- **Tests verify real behavior, not mocks**: all 9 tests exercise the actual Mongoose model against mongodb-memory-server (`AlertRuleV2.create`, `.find()`, `.findOneAndUpdate()`) — no stubbing of Mongoose internals. The two bugs I fixed were only caught because the tests hit real Mongoose default-value and lint-rule behavior rather than a mock.
- **Test output**: clean pass, no console noise from my code (the only console output in the full run is pre-existing React `act()` warnings from unrelated component tests, and the standard ts-jest/jest config deprecation warnings that print on every run regardless of what's tested).
- **Index script parity**: `create-indexes-v2.ts` and `verify-indexes.ts` now handle `alert_rules_v2` with the same three touchpoints devices_v2/readings_v2 get (index creation, index verification/checklist, collection stats) — I did not stop at "just add the array," since the brief said to follow the call shape "exactly."

## Concerns

- The brief's Step 4 said "Expected: PASS, 8 tests" but the test file it hands you (Step 1) contains 9 `it(...)` blocks, and 9 is what actually runs. Treating the file's literal content as authoritative over the summary count.
- The brief referenced a `SCHEDULE_V2_INDEXES` array in `create-indexes-v2.ts` as a sibling to model after; it doesn't exist in this file (schedules_v2 indexes aren't registered in this script at all currently). I used the two arrays that do exist (`DEVICE_V2_INDEXES`/`READING_V2_INDEXES`) as the pattern instead — functionally equivalent, just flagging the discrepancy in case it signals something else is out of sync.
- The two code fixes I made to the brief's literal Step 3 snippet (`default: undefined` on the array selector fields; type-only `Types` import) are small but real deviations from "use the exact code it gives." I made them because the exact code as given does not pass the exact tests as given / does not keep the lint gate green, and later tasks depend on `findActive`/selector semantics behaving correctly — happy to discuss if there's a reason those exact defaults were intended to be `[]` rather than `undefined`, but the test brief itself asserts `undefined`.
