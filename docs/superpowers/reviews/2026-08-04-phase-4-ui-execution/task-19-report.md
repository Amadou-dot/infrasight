# Task 19: Seed alert rules — Report

Worktree: `/home/yzel/github/infrasight-phase4` (branch `feat/phase-4-alerting`)

## Summary

Implemented exactly as specified in `task-19-brief.md`: a new side-effect-free
module `scripts/v2/alert-rule-seeds.ts` exporting `AlertRuleSeed` and
`buildAlertRuleSeeds()`, wired into `scripts/v2/seed-v2.ts`, and a test suite
in `__tests__/unit/lib/seed-alert-rules.test.ts`. All four strict gates are
green. `pnpm seed`, `pnpm create-indexes-v2`, and `pnpm verify-indexes` were
run against the local container and produced the expected data. One genuine,
pre-existing tooling problem was found and is reported below rather than
worked around, per instructions.

## Files touched

- Created: `scripts/v2/alert-rule-seeds.ts` (101 lines)
- Modified: `scripts/v2/seed-v2.ts` (+10 lines, all additive — imports, one
  `deleteMany`, one seed+insert block, one summary line)
- Created: `__tests__/unit/lib/seed-alert-rules.test.ts` (107 lines, 9 tests)

No other files were changed in the final diff. (Two files — `models/v2/AlertRuleV2.ts`
and this test file — were *temporarily* edited during deletion-check
verification and reverted every time; see "Deletion-check evidence" below.
`git status` and `git diff` were checked after every revert.)

## Step 1–2: Write the failing test, confirm it fails

Wrote `__tests__/unit/lib/seed-alert-rules.test.ts` starting from the brief's
six tests verbatim, then ran it before `scripts/v2/alert-rule-seeds.ts`
existed:

```
$ pnpm test __tests__/unit/lib/seed-alert-rules.test.ts
FAIL node __tests__/unit/lib/seed-alert-rules.test.ts
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/scripts/v2/alert-rule-seeds mapped as:
    /home/yzel/github/infrasight-phase4/$1.

       7 |
       8 | import AlertRuleV2 from '@/models/v2/AlertRuleV2';
    >  9 | import { buildAlertRuleSeeds, type AlertRuleSeed } from '@/scripts/v2/alert-rule-seeds';
         | ^

Test Suites: 1 failed, 1 total
Tests:       0 total
```

Red, as expected (module doesn't exist yet).

## Step 3: Implement

- `scripts/v2/alert-rule-seeds.ts`: created verbatim per the brief — the
  `AlertRuleSeed` interface and `buildAlertRuleSeeds()` returning the four
  rules (High temperature / Power spike / Low battery / High anomaly score)
  with the exact values from the brief's table. No imports beyond nothing
  (zero dependencies) — confirmed side-effect-free (see Step 4).
- `scripts/v2/seed-v2.ts`: added the two imports, one `AlertRuleV2.deleteMany({})`
  in the clear step, one seed-and-insert block after readings, and one
  `Alert rules: N` summary line. Diff:

```diff
--- a/scripts/v2/seed-v2.ts
+++ b/scripts/v2/seed-v2.ts
@@ -12,7 +12,9 @@
 import mongoose from 'mongoose';
 import DeviceV2 from '../../models/v2/DeviceV2';
 import ReadingV2 from '../../models/v2/ReadingV2';
+import AlertRuleV2 from '../../models/v2/AlertRuleV2';
 import { assertSafeToWipe, describeTarget } from './db-guard';
+import { buildAlertRuleSeeds } from './alert-rule-seeds';
@@ -332,6 +334,7 @@ async function seed(): Promise<void> {
     if (FORCE) console.log('   ⚠️  --force: wiping a non-local database');
     await DeviceV2.deleteMany({});
     await ReadingV2.deleteMany({});
+    await AlertRuleV2.deleteMany({});
     console.log('✅ Cleared existing data\n');
@@ -364,6 +367,12 @@ async function seed(): Promise<void> {
     console.log(`\n✅ Inserted ${totalReadings} readings total\n`);
+    // Seed alert rules so /alerts is populated on first load.
+    console.log('🔔 Seeding alert rules...');
+    const alertRules = buildAlertRuleSeeds();
+    await AlertRuleV2.insertMany(alertRules);
+    console.log(`✅ Inserted ${alertRules.length} alert rules\n`);
+
     // Summary
@@ -373,6 +382,7 @@ async function seed(): Promise<void> {
     console.log(`  Readings per device: ${READINGS_PER_DEVICE}`);
     console.log(`  Device types: ${deviceTypes.length}`);
     console.log(`  Time range: ${READINGS_PER_DEVICE} hours (1 reading/hour)`);
+    console.log(`  Alert rules: ${alertRules.length}`);
     console.log('='.repeat(50));
```

`alerts_v2` is deliberately **not** touched — no `AlertV2.deleteMany({})` was
added, per the brief's explicit instruction.

### Hardening the test beyond the brief's literal six tests

The task instructions flagged two specific weaknesses in the brief's own
Step-1 test text and told me to fix them rather than ship them as-is:

1. `should produce rules the model accepts` (`insertMany` + count) "proves
   little" if a validation failure could be silently dropped instead of
   thrown.
2. `should include a fleet-wide low-battery rule with no selector.types` runs
   against the **plain object** `buildAlertRuleSeeds()` returns, which
   trivially has no `types` key — it proves nothing about Mongoose.

I added three tests beyond the brief's six to close these gaps (final file
has **9 tests**, not 6 — see full reasoning and empirical proof in
"Deletion-check evidence"):

- `should reject the whole batch, inserting nothing, if a seed violated the
  schema` — corrupts one seed's `metric` inline and asserts `insertMany`
  rejects with zero documents inserted.
- `should keep a fleet-wide seed selector.types genuinely absent (not [])
  after a lean round trip` — inserts the real seeds, reads back with
  `.lean()` (the exact read path `lib/alerting/rule-cache.ts` uses).
- `should keep selector.types undefined on a hydrated re-read of a fleet-wide
  seed too` — reads back via a hydrated (non-`.lean()`) query, which is the
  one path that actually reconstructs the `selector` subdocument through
  Mongoose's schema defaults.

## Step 4: Run test to verify it passes

```
$ pnpm test __tests__/unit/lib/seed-alert-rules.test.ts
PASS node __tests__/unit/lib/seed-alert-rules.test.ts
  buildAlertRuleSeeds
    ✓ should produce four rules (16 ms)
    ✓ should include a duration-gated temperature rule (3 ms)
    ✓ should include a fleet-wide low-battery rule with no selector.types (3 ms)
    ✓ should include an anomaly_score rule bounded to 0-1 (7 ms)
    ✓ should give every value-metric rule a non-empty selector.types (3 ms)
    ✓ should produce rules the model accepts (22 ms)
    ✓ should reject the whole batch, inserting nothing, if a seed violated the schema (7 ms)
    ✓ should keep a fleet-wide seed selector.types genuinely absent (not []) after a lean round trip (11 ms)
    ✓ should keep selector.types undefined on a hydrated re-read of a fleet-wide seed too (6 ms)

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

Side-effect-free import check (brief's exact command, run with `MONGODB_URI`
explicitly **unset** to make the strongest possible claim):

```
$ env -u MONGODB_URI npx tsx -e "import('./scripts/v2/alert-rule-seeds.ts').then(m => console.log(m.buildAlertRuleSeeds().length))"
4
```

No connection attempt, no error, prints `4`.

## Deletion-check evidence

Per instructions, every test's claim was falsified-by-construction and
confirmed red, then reverted and confirmed green again. All edits below were
temporary; `git diff`/`git status` were checked clean after every revert.

**Check 1 — remove the "Low battery" rule entirely.** Expected reds: "produce
four rules", "fleet-wide low-battery rule", "rules the model accepts" (count
now 3), and both round-trip tests (they look up `metric: 'battery_level'`,
which no longer exists).

```
✕ should produce four rules
✓ should include a duration-gated temperature rule
✕ should include a fleet-wide low-battery rule with no selector.types
✓ should include an anomaly_score rule bounded to 0-1
✓ should give every value-metric rule a non-empty selector.types
✕ should produce rules the model accepts
✓ should reject the whole batch, inserting nothing, if a seed violated the schema
✕ should keep a fleet-wide seed selector.types genuinely absent (not []) after a lean round trip
✕ should keep selector.types undefined on a hydrated re-read of a fleet-wide seed too
Tests: 5 failed, 4 passed, 9 total
```

Exactly the 5 dependent tests failed; the 4 independent ones stayed green.
Reverted, re-confirmed 9/9 green.

**Check 2 — `High temperature`'s `for_duration_seconds: 300 → 0`.** Expected
red: only "duration-gated temperature rule". Result: `1 failed, 8 passed` —
exactly that one. Reverted.

**Check 3 — `Power spike`'s `selector.types: ['power'] → []`.** Expected red:
only "every value-metric rule a non-empty selector.types". Result: `1 failed,
8 passed` — exactly that one. Reverted.

**Check 4 — `High anomaly score`'s `threshold: 0.85 → 1.5`** (out of [0,1]).
Expected red: only "anomaly_score rule bounded to 0-1". Result: `1 failed, 8
passed` — exactly that one. Reverted.

**Check 5 — `Power spike`'s `metric: 'value' → 'not_a_real_metric'`** (the
brief's own flagged concern: does the "model accepts" test actually catch
this?). Result:

```
✕ should produce rules the model accepts
✕ should keep a fleet-wide seed selector.types genuinely absent (not []) after a lean round trip
Tests: 2 failed, 7 passed, 9 total
```

"Rules the model accepts" correctly went red — `insertMany` threw on the
whole 4-rule batch. The lean round-trip test *also* went red as a legitimate
cascade: it does `insertMany(buildAlertRuleSeeds())` over all four seeds, so
the corrupted Power-spike seed poisons that insert too, and nothing is
persisted for it to find. The hydrated re-read test, which only inserts the
single `lowBattery` seed in isolation, correctly stayed green — confirming
that test is properly decoupled from the other three seeds. Reverted;
re-confirmed 9/9 green.

**Check 6 — simulate "insertMany silently drops instead of throwing"** by
temporarily adding `{ ordered: false }` to the corrupted-batch test's own
`insertMany` call (not touching seed source, since this test manufactures its
own corruption). Result: `1 failed, 8 passed` — exactly the test whose claim
that names default-`ordered` behavior. With `ordered: false`, Mongoose
inserted the 3 valid docs and silently dropped the bad one (count 3, no
throw) — confirming this is the literal failure mode the test exists to rule
out. Reverted.

**Check 7 — the big one: temporarily removed `default: undefined` from the
`types` array path** in `models/v2/AlertRuleV2.ts`'s `SelectorSchema` (the
Task 1 interface contract this whole seed set leans on). Ran the seed tests
**and** the pre-existing `AlertRuleV2.test.ts` model test together:

```
FAIL __tests__/unit/lib/seed-alert-rules.test.ts
  ● should keep a fleet-wide seed selector.types genuinely absent (not []) after a lean round trip
    expect(received).toBeUndefined()
    Received: []
  ● should keep selector.types undefined on a hydrated re-read of a fleet-wide seed too
    expect(received).toBeUndefined()
    Received: []
FAIL __tests__/unit/models/AlertRuleV2.test.ts
  ● AlertRuleV2 Model › document creation › should allow a rule with no selector types (fleet-wide)
    expect(received).toBeUndefined()
    Received: []
Tests: 3 failed, 15 passed, 18 total
```

All three tests that depend on the override — my two new ones **and** the
pre-existing Task 1 test — failed identically (`Received: []`), confirming
the interface guarantee is real, is actually exercised, and that the
pre-existing model test is not vacuous either. Reverted via
`git checkout -- models/v2/AlertRuleV2.ts`; `git diff` was empty afterward;
re-ran both files, 18/18 green.

This also surfaced a genuinely interesting mechanism worth recording: with
the override in place, a fleet-wide seed's `selector: {}` is stored by Mongoose
as **no `selector` field at all** in the raw document (confirmed via the raw
driver, bypassing Mongoose entirely) — Mongoose's default `minimize: true`
strips an embedded subdocument once every one of its own fields is undefined.
A `.lean()` read (what `lib/alerting/rule-cache.ts` actually uses) therefore
returns `selector: undefined`, not `selector: {}`. This is exactly what the
evaluator already expects: `buildRuleBuckets()` in `lib/alerting/rule-cache.ts`
guards with `rule.selector?.types?.length`, and `matchesSelector()` in
`lib/alerting/selector.ts` opens with `if (!selector) return true;`. So the
seeded fleet-wide rules are correctly treated as "applies to every reading
type" by the real evaluator — this needed no code change, just verification,
which is why I added both a `.lean()` test (matches production exactly) and a
hydrated test (the one that actually falsifies on override removal, since
`.lean()` alone would not — a hydrated read reconstructs `selector` via the
schema's top-level `default: () => ({})`, which is where an unguarded `types`
path would default to `[]`).

## `pnpm seed` — actual output (local container)

```
$ pnpm seed
🌱 Starting V2 Database Seed
📡 Connecting to MongoDB (127.0.0.1)...
✅ Connected to MongoDB
🧹 Clearing existing V2 data...
✅ Cleared existing data
📱 Generating 500 devices...
✅ Inserted 500 devices
📊 Generating readings for each device...
✅ Inserted 12500 readings total
🔔 Seeding alert rules...
✅ Inserted 4 alert rules
==================================================
📋 Seed Summary
==================================================
  Devices: 500
  Readings: 12500
  Readings per device: 25
  Device types: 15
  Time range: 25 hours (1 reading/hour)
  Alert rules: 4
==================================================
✅ Seed completed successfully!
📡 Disconnected from MongoDB
```

`assertSafeToWipe` recognized `127.0.0.1:27018` as local and ran without
`--force`, as expected — I did not need to reach for it.

## `pnpm create-indexes-v2` / `pnpm verify-indexes` — a genuine finding

Running the brief's exact Step 5 recipe (`pnpm seed` then
`pnpm create-indexes-v2 && pnpm verify-indexes`) surfaced a real,
reproducible problem in tooling from an earlier task — not something Task 19
introduced, and not something I patched, per the explicit instruction to
report rather than work around a genuine problem in these two "hardened
recently" scripts. Full diagnosis:

**What happened.** `pnpm create-indexes-v2` crashed:

```
📦 Collection: alert_rules_v2
   ...
❌ Fatal error during index creation:
MongoServerError: ns does not exist: infrasight.alerts_v2
  codeName: 'NamespaceNotFound', code: 26
```

**Root cause.** On this genuinely fresh database, `alerts_v2` had never been
created (no alert episode has ever fired — expected, since Task 19 does not
touch `alerts_v2`, by design). `createCollectionIndexes()` in
`create-indexes-v2.ts` calls `collection.indexes()` as its first operation to
build a name→existing-index map, *before* any `createIndex` call. MongoDB's
`listIndexes` throws `NamespaceNotFound` on a collection that has never been
created. The script's own preceding log line ("Collection alerts_v2 does not
exist yet. Creating indexes will create the collection.") shows the author's
intent was for this to be handled gracefully via `createIndex`'s
auto-vivification — but the `.indexes()` pre-check was never guarded for that
case. The only try/catch in `createCollectionIndexes` is inside the per-index
loop, which the crash happens before reaching. This aborts the whole script
(exit 1) with `devices_v2`/`readings_v2`/`alert_rules_v2` never reaching their
final summary, even though those three sections had already completed.

**A related, separate wrinkle in `verify-indexes.ts`.** This script imports
all four v2 models (needed so `autoIndex: false` applies per-schema) and
connects with `{ autoIndex: false }` — but does **not** set `autoCreate:
false`. Mongoose 9's connection-level `autoCreate` (default `true`,
independent of `autoIndex`) calls `createCollection()` for every registered
model shortly after connecting, as a background operation not awaited by
`connect()`. This raced against the script's own `alerts_v2` check: one
interactive run hit the identical `NamespaceNotFound` (caught locally by a
per-section `try/catch`, so the script didn't crash, just logged an error and
continued); a second run — no other process touched this database in
between, confirmed via `ps aux` and the mongod server log — won the race, so
`alerts_v2` had already been silently created (with just a default `_id_`
index) by the time the check ran, and it reported all 6 as `✗ missing`
instead. **`verify-indexes.ts` is non-deterministic on a genuinely fresh
`alerts_v2`-less database**: which of "errors out" or "reports 6/6 missing"
you get depends on a timing race with Mongoose's own background collection
creation. Confirmed via the mongod log (`grep alerts_v2` shows the
`createCollection` command landing mid-way through my second `verify-indexes`
run, at `21:41:44.954Z`, with `ctx: conn101`).

**Also visible, unrelated to alerting:** `verify-indexes.ts`'s
`EXPECTED_READING_INDEXES` expects `device_timestamp` as
`{ 'metadata.device_id': 1, timestamp: 1 }` (ascending), but
`create-indexes-v2.ts`'s `READING_V2_INDEXES` creates
`metadata_device_timestamp` as `{ 'metadata.device_id': 1, timestamp: -1 }`
(descending) — the two scripts disagree with each other, so `device_timestamp`
reports `✗ missing` regardless of anything Task 19 does. Pre-existing,
predates alerting, not touched by me — flagged only because I ran the exact
verification command the brief specifies and it's visible in that output.

**What I did *not* do:** edit `create-indexes-v2.ts` or `verify-indexes.ts`,
or manually create `alerts_v2`/its indexes via `mongosh` to paper over this.
I only re-ran the prescribed commands (the natural retry any operator would
do on seeing a failure), which is legitimate because Mongoose's own
background `autoCreate` had, by then, brought `alerts_v2` into existence as a
side effect of `verify-indexes.ts` itself, letting a subsequent
`create-indexes-v2` run past the crash on its own:

```
📦 Collection: alerts_v2
   Existing indexes: 1
────────────────────────────────────────────────────────────
   ✅ [CREATE] rule_device_open_unique (12ms)
   ✅ [CREATE] rule_device_resolved_at (7ms)
   ✅ [CREATE] status_created_at (9ms)
   ✅ [CREATE] device_created_at (10ms)
   ✅ [CREATE] severity_status (8ms)
   ✅ [CREATE] is_open_last_observed_at (10ms)
```

Final `pnpm verify-indexes` — **all eight alert-related indexes confirmed
present**:

```
════════════════════════════════════════════════════════════
 AlertRuleV2 Collection Indexes
════════════════════════════════════════════════════════════
  ✓ enabled_deleted_at
  ✓ audit_created_at_desc
  ✓ All expected indexes present

════════════════════════════════════════════════════════════
 AlertV2 Collection Indexes
════════════════════════════════════════════════════════════
  ✓ rule_device_open_unique
  ✓ rule_device_resolved_at
  ✓ status_created_at
  ✓ device_created_at
  ✓ severity_status
  ✓ is_open_last_observed_at
  ✓ All expected indexes present

════════════════════════════════════════════════════════════
 Collection Statistics
════════════════════════════════════════════════════════════
devices_v2:      Documents: 500
readings_v2:      Documents: 12,500
alert_rules_v2:   Documents: 4
alerts_v2:        Documents: 0
```

Note `create-indexes-v2` still exits 1 on a *second* concern, also
pre-existing and unrelated to Task 19: 10 `[FAIL] ... already exists with a
different name` entries across `devices_v2`/`readings_v2`/`alert_rules_v2`
(including both `alert_rules_v2` indexes). Root cause: those specific index
shapes are *also* declared directly on the respective Mongoose schemas
(`AlertRuleV2Schema.index(...)`, etc.), so Mongoose's default `autoIndex: true`
built them under auto-generated names (e.g. `enabled_1_audit.deleted_at_1`)
the moment `pnpm seed` connected and used those models — before
`create-indexes-v2.ts` ever got to create its own custom-named
(`enabled_deleted_at`) index with the identical key spec, which MongoDB
rejects as a same-key/different-name conflict. This is **not a coverage
gap** — `verify-indexes.ts`'s shape check (`checkIndexExists`) is
deliberately name-agnostic (confirmed by reading `index-shape.ts`), so it
correctly reports these as present regardless of which name won. It is a
cosmetic/naming duplication that predates Task 19 (confirmed: `devices_v2`
has the exact same pattern, and `devices_v2`/`readings_v2` indexes are
untouched by anything in this task).

## Gate outputs

**`npx tsc --noEmit`** — first run surfaced a real error in my own new test
(not the brief's prescribed six): the "hydrated re-read" test called
`AlertRuleV2.create(lowBattery)`, but `AlertRuleSeed.selector.types` is typed
`string[] | undefined` while the model's `IAlertRuleSelector.types` is
`ReadingType[] | undefined`, and `Model.create()`'s overload resolution is
stricter about this than `Model.insertMany()`'s (which is why none of the
other tests — all of which use `insertMany` — hit it):

```
__tests__/unit/lib/seed-alert-rules.test.ts(100,46): error TS2769: No overload matches this call. ...
__tests__/unit/lib/seed-alert-rules.test.ts(101,59): error TS2339: Property '_id' does not exist on type 'never'.
```

Fixed by rewriting that one test to use `insertMany([lowBattery])` +
`findOne(...)` instead of `create()` + `findById()` — identical behavior
under test (a hydrated, non-`.lean()` read), zero cast required, and it
matches the pattern already proven to type-check cleanly elsewhere in the
file. Did not touch `AlertRuleSeed`'s brief-specified type. Re-ran:

```
$ npx tsc --noEmit
(no output)
$ echo $?
0
```

**`pnpm lint`**:

```
$ pnpm lint
$ eslint
$ echo $?
0
```

**`pnpm build`**:

```
$ pnpm build
 ✓ Compiled successfully in 3.7s
 ✓ Completed runAfterProductionCompile in 233ms
   Running TypeScript ...
 ✓ Generating static pages using 23 workers (32/32)
$ echo $?
0
```

Route table includes `/alerts`, `/alerts/[id]`, `/alerts/rules`,
`/api/v2/alert-rules`, `/api/v2/alert-rules/[id]`, `/api/v2/alerts`,
`/api/v2/alerts/[id]` — confirming the rest of Phase 4 is present and this
task's changes don't break the build.

**`pnpm test`** (full suite):

```
Test Suites: 114 passed, 114 total
Tests:       2594 passed, 2594 total
Time:        42.014 s
```

2585 + 9 = 2594; 113 + 1 = 114 — exactly one new suite with nine new tests,
matching the entering baseline plus this task's additions precisely, with
nothing else broken. (One expected `console.error` appears in the log from
the pre-existing `notify.test.ts`, testing its own Pusher-failure path —
unrelated to this task, and the test still passes.)

## Commits

Single commit, exactly the three files specified in the brief:

```
git add scripts/v2/alert-rule-seeds.ts scripts/v2/seed-v2.ts __tests__/unit/lib/seed-alert-rules.test.ts
git commit -m "feat(alerting): seed a starter alert rule set"
```

(SHA recorded after commit — see final message to controller.)

## Things I was unsure about / judgment calls made

1. **Test count deviates from the brief's "6 tests."** I shipped 9. The
   outer task instructions explicitly named this exact test file as the
   "exposed spot" for the project's vacuous-test failure pattern and told me
   to fix it; I judged that instruction to override the brief's literal
   count, since the brief is describing intent ("prove the seeds round-trip
   through the real model"), and the fix requires either strengthening the
   existing assertions or adding tests — I chose to add tests so the
   original six-test shape (matching the brief for anyone diffing against
   it) stays intact and the hardening is clearly separated with comments
   explaining why each exists.
2. **Left `create-indexes-v2.ts` / `verify-indexes.ts` unmodified** despite
   finding and precisely diagnosing a real crash and a real non-determinism
   in them. This was a direct instruction ("report it, do not work around
   it"), but it's worth being explicit that I made a judgment call not to
   file this as blocking — Task 19's own deliverable does not depend on
   these scripts being bug-free, and I was able to reach a fully-verified
   end state for everything Task 19 owns.
3. **Did not touch `readings_v2`'s pre-existing `device_timestamp`
   direction mismatch** between the two scripts (ascending expected vs.
   descending created) — completely unrelated to alerting, flagged in this
   report only because it's visible in the exact verification command the
   brief specifies.
4. **`autoIndex`/`autoCreate` diagnosis is inference, not something I could
   fully prove with a controlled experiment** given time constraints — but
   it is backed by converging direct evidence: `ps aux` showing no other
   process touching this database, the mongod server log's own
   `createCollection` entry for `alerts_v2` timestamped inside my second
   `verify-indexes` run, and the resulting collection having exactly the
   bare `_id_` index that plain `createCollection()` (not `createIndex`)
   produces. I'm confident in the observed *facts*; the causal mechanism
   (Mongoose 9's `autoCreate` default) is my best explanation of them.

---

# Fix round 1 (review response)

Review came back: spec ✅, no Critical, one Important (the low-battery
threshold), plus Finding 2 (the `create-indexes-v2` crash) moved in-scope
because it blocks the plan's Definition of Done, plus one comment-accuracy
finding. All three addressed below. Gates re-run clean. One item — the
`readings_v2` `device_timestamp` direction mismatch — was explicitly marked
deferred and is untouched.

## Finding 1: Low battery threshold 20 → 25

Confirmed the math: both data generators floor `context.battery_level` at
exactly 20 (`scripts/v2/seed-v2.ts:299` `randomInt(20, 100)`;
`lib/simulation/readings.ts:262` `clamp(20 + …, 20, 100)`), and the evaluator
reads that exact field (`lib/alerting/selector.ts:25`,
`battery_level: r => r.context?.battery_level`), so `lt 20` was
unsatisfiable — confirmed by grep, not just taken on faith.

Changed `scripts/v2/alert-rule-seeds.ts`'s "Low battery" seed:
`threshold: 20` → `threshold: 25`, description `"below 20% battery"` →
`"below 25% battery"` (left inconsistent otherwise), and added the exact
comment from the review, alongside the existing comment about why
`selector.types` is absent:

```typescript
      // No selector.types: battery is a DEVICE property, so a rule that only
      // watched temperature sensors' batteries would be close to useless. This
      // is the rule that motivates making selector.types optional.
      //
      // Threshold is 25, not 20, deliberately: both data generators floor
      // context.battery_level at exactly 20 (seed-v2.ts:299,
      // lib/simulation/readings.ts:262), so `lt 20` can never be satisfied.
      // 25 catches the [20, 24] band — roughly 6% of devices.
      name: 'Low battery',
      description: 'Any device reporting below 25% battery.',
```

Checked whether any test asserts the old value: grepped the whole repo for
`threshold` near `battery`/`Low battery` and for the literal description
string. Nothing does — `__tests__/unit/lib/seed-alert-rules.test.ts` only
asserts `comparison: 'lt'` and `selector.types === undefined` for this rule,
never the numeric threshold, and the few other repo hits for "Low battery"
are unrelated fixtures (`AlertToaster.test.tsx`'s mock alert payload,
`analytics.integration.test.ts`'s device-health-analytics tests, a dashboard
component comment) — none reference this seed. No test needed updating.

## Finding 2: `create-indexes-v2` crash on a fresh database

### The fix

`createCollectionIndexes()` in `scripts/v2/create-indexes-v2.ts` called
`collection.indexes()` as its first operation, unguarded. Guarded it,
matching the file's existing style (comment-then-code, `error as {code?:
number}` pattern already used nowhere else in this file but consistent with
how the codebase narrows caught errors elsewhere):

```typescript
  // Get existing indexes, keyed by name, so a name match can be shape-checked below.
  // A collection that has never been created — e.g. alerts_v2 before any alert has
  // ever fired, the normal state of a fresh database — makes `.indexes()` throw
  // NamespaceNotFound rather than resolve empty. That is zero existing indexes,
  // not a failure, so it is caught here instead of aborting the whole script.
  let existingIndexes: Awaited<ReturnType<typeof collection.indexes>> = [];
  try {
    existingIndexes = await collection.indexes();
  } catch (error) {
    if ((error as { code?: number }).code !== 26) throw error;
  }
```

Used `Awaited<ReturnType<typeof collection.indexes>>` rather than hand-typing
the array element type, so it stays correct regardless of the exact type the
installed MongoDB driver version names it as — avoids both a stale hand-typed
annotation and `any`.

### Regression test (TDD)

Added `__tests__/integration/scripts/create-indexes-v2-cli.integration.test.ts`,
modeled directly on the existing `verify-indexes-cli.integration.test.ts`
subprocess pattern (the "natural place" the review pointed at) — `create-indexes-v2.ts`
calls its main function unconditionally at module scope and that function
calls `process.exit()`, so it cannot be `import`ed in-process either. The
test drops `alerts_v2` (tolerating it already being absent), runs the real
`npx tsx scripts/v2/create-indexes-v2.ts` as a child process against the
shared mongodb-memory-server, and — rather than trusting the subprocess's
overall exit code, which can be non-zero for reasons unrelated to `alerts_v2`
(see below) — asserts directly against stdout content and live index state:
no `"Fatal error during index creation"` / `"ns does not exist"` in stdout,
and `alerts_v2` ends up with exactly its 6 named indexes plus `_id_`.

**Red** (fix reverted to plain `const existingIndexes = await collection.indexes();`):

```
✕ running the actual script against a database with no alerts_v2 collection
  creates all six AlertV2 indexes instead of aborting (1763 ms)

  MongoServerError: ns does not exist: test.alerts_v2
    at getLiveIndexNames (create-indexes-v2-cli.integration.test.ts:65:19)
```

The collection was never vivified because the subprocess crashed before
reaching any of `alerts_v2`'s `createIndex` calls — so even the test's own
final verification step throws, which is itself proof the fix matters.

**Green** (fix restored):

```
PASS node __tests__/integration/scripts/create-indexes-v2-cli.integration.test.ts
  ✓ running the actual script against a database with no alerts_v2 collection
    creates all six AlertV2 indexes instead of aborting (2079 ms)
```

Also ran this alongside the two existing `alerts_v2`-touching integration
tests plus `seed-alert-rules.test.ts` and the `index-shape`/`db-guard` unit
tests to check for cross-test interference: 6 suites, 41 tests, all green,
no interference.

### Proving the Definition of Done against the local container

This needed more than one pass to get right, and the extra passes surfaced a
real nuance worth being explicit about rather than glossing over.

**Pass 1 — literally as instructed:** dropped only `alerts_v2` from the
container (which, at that point, still carried auto-indexed shadow indexes
on `devices_v2`/`readings_v2`/`alert_rules_v2` accumulated from the original
task's repeated `pnpm seed` runs), then ran the bare chain:

```
$ pnpm create-indexes-v2 && pnpm verify-indexes
```

`create-indexes-v2` no longer crashed — `alerts_v2` reported
`Existing indexes: 0` (not a fatal error) and all 6 of its indexes were
created — but the **overall script still exited 1**, because of 10
pre-existing `[FAIL] ... already exists with a different name` entries on
`devices_v2`/`readings_v2`/`alert_rules_v2` (unrelated to `alerts_v2`, and
unrelated to alerting — root-caused below). Because `&&` short-circuits on
any non-zero exit, `verify-indexes` never ran in this pass. My fix was
working correctly; the literal bare-chain command still didn't reach
`verify-indexes`, for a different, pre-existing reason.

**Root cause of that separate exit-1, so it's not left as a loose thread:**
`devices_v2`/`readings_v2`/`alert_rules_v2`'s schemas declare several of the
same indexes directly (e.g. `AlertRuleV2Schema.index({enabled:1,
'audit.deleted_at':1})`). When `pnpm seed` (which uses these models) runs
*before* `create-indexes-v2` has ever run, Mongoose's default `autoIndex:
true` builds those under auto-generated names first; `create-indexes-v2`
then collides trying to create its own custom-named index with the identical
key spec, and MongoDB rejects the second one outright. This is exactly the
scenario the original task report already flagged as pre-existing and
unrelated to alerting — I hadn't previously realized it would also block the
literal `&&` chain from ever reaching `verify-indexes`, since in the original
task's testing `create-indexes-v2` had already been run (curing the
collision) before the "prove it" check.

**Pass 2 — a genuinely fresh database, "precisely the fresh-database
scenario this phase targets":** dropped the entire `infrasight` database
(`db.dropDatabase()`) and ran the bare chain as the very first operation
against it — before ever seeding, matching the order a real deployment would
use (provision indexes, then load data):

```
$ pnpm create-indexes-v2 && pnpm verify-indexes
...
📊 Summary
   ✅ Created:    26 indexes
   ⏭️  Skipped:    0 indexes (already existed)
   🛑 Mismatched: 0 indexes
   ❌ Failed:     0 indexes
✅ Index creation completed successfully!
...
 AlertRuleV2 Collection Indexes
  ✓ enabled_deleted_at
  ✓ audit_created_at_desc
  ✓ All expected indexes present
...
 AlertV2 Collection Indexes
  ✓ rule_device_open_unique
  ✓ rule_device_resolved_at
  ✓ status_created_at
  ✓ device_created_at
  ✓ severity_status
  ✓ is_open_last_observed_at
  ✓ All expected indexes present
```

Exit 0 end to end, one bare command chain, run once — **all eight alert
indexes reported present.** The only red anywhere in that run was the
already-deferred `device_timestamp` (readings_v2, direction mismatch,
untouched). One new observation surfaced here: `devices_v2`'s `last_seen`
*also* showed the identical deferred-category mismatch (create-indexes-v2
creates it descending, verify-indexes expects ascending) — invisible in the
original task's testing only because a same-named... no, an
ascending-direction *auto-indexed shadow* on `devices_v2` happened to already
exist from an earlier seed run and satisfied the check by coincidence. Same
root cause and same "cosmetic, working index exists" character as the
deferred `readings_v2` finding, so I left it alone rather than expanding
scope — flagging it here for visibility only.

**Restored demo data** (`pnpm seed`: 500 devices, 12,500 readings, 4 alert
rules — the full wipe in Pass 2 had cleared it), then re-ran
`create-indexes-v2` once more: `Skipped: 26, Failed: 0` — running
`create-indexes-v2` *before* the first seed avoided the naming collision
entirely, and it stayed avoided after seeding.

**Pass 3 — literal instruction again, now in this healthy state:** dropped
only `alerts_v2` once more (reproducing exactly what the review asked for)
and ran the bare chain a final time:

```
$ pnpm create-indexes-v2 && pnpm verify-indexes
...
   ✅ Created:    6 indexes
   ⏭️  Skipped:    20 indexes (already existed)
   🛑 Mismatched: 0 indexes
   ❌ Failed:     0 indexes
✅ Index creation completed successfully!
...
 AlertRuleV2 Collection Indexes  →  ✓ All expected indexes present
 AlertV2 Collection Indexes      →  ✓ All expected indexes present
...
 Collection Statistics
devices_v2:      500
readings_v2:      12,500
alert_rules_v2:   4
alerts_v2:        0
```

This is the literal command from the review, run once, completing with exit
0 and all eight alert indexes reported present — the container is left in
this state.

## Finding 3: comment overclaims

Both instances reworded to the language from the review, plus (in the seeds
file, as requested) a note that alerts require the cron route:

`scripts/v2/alert-rule-seeds.ts` (`buildAlertRuleSeeds` docstring):

```typescript
/**
 * A small rule set so alert rules exist to be evaluated. Without it the whole
 * phase is invisible to a visitor.
 *
 * Seeding rules is necessary but not sufficient for /alerts to show anything:
 * neither `pnpm seed` nor `scripts/v2/simulate.ts` triggers evaluation — both
 * insert readings via raw `ReadingV2.insertMany`, bypassing the API routes
 * where `evaluateReadings` actually runs. Alerts only appear once an
 * authenticated `GET /api/v2/cron/simulate` call runs the evaluator.
 */
```

`scripts/v2/seed-v2.ts:370`:

```typescript
    // Seed alert rules so alert rules exist to be evaluated. This alone does not
    // populate /alerts: readings are inserted directly via ReadingV2.insertMany
    // above, bypassing the API route that runs evaluateReadings. Alerts appear
    // only once an authenticated GET /api/v2/cron/simulate call evaluates them.
```

## Gates (fix round)

```
$ npx tsc --noEmit
(no output)                                    exit 0

$ pnpm lint
$ eslint                                       exit 0

$ pnpm build
 ✓ Compiled successfully in 3.7s
 ✓ Generating static pages using 23 workers (32/32)
                                                exit 0

$ pnpm test
Test Suites: 115 passed, 115 total
Tests:       2595 passed, 2595 total
```

114 + 1 = 115 suites, 2594 + 1 = 2595 tests: exactly the one new regression
test suite from Finding 2, nothing else moved.

## Files touched (fix round)

- `scripts/v2/alert-rule-seeds.ts` (threshold, description, two comments)
- `scripts/v2/seed-v2.ts` (one comment)
- `scripts/v2/create-indexes-v2.ts` (the guard)
- `__tests__/integration/scripts/create-indexes-v2-cli.integration.test.ts` (new)

## Deferred, confirmed untouched

`readings_v2`'s `device_timestamp` name/direction mismatch between
`create-indexes-v2.ts` (descending) and `verify-indexes.ts` (ascending) —
left exactly as instructed. Still visible as `✗ device_timestamp` in every
`verify-indexes` run above, exactly as expected.

---

# Fix round 2 (review response)

Re-review came back: Findings 1 and 3 cleanly closed. Finding 2 — the
`create-indexes-v2` name/shape collision — stayed open: the re-reviewer
diagnosed the true root cause (unnamed schema-declared indexes racing
`autoIndex`, not fixable by reordering docs, since `dbConnect()` also leaves
`autoIndex` at its default) and the human ruled to fix the root cause. This is
that fix.

## The fix: shape-before-name matching in `createCollectionIndexes()`

Root cause, confirmed: every index this script wants is *also* declared
directly on its Mongoose schema via an unnamed `Schema.index({...})` call.
Mongoose's `autoIndex` (default `true`; neither `lib/db.ts`'s `dbConnect()`
nor `pnpm seed`'s plain `mongoose.connect()` disables it) builds each one
under MongoDB's own generated name the first time that model initializes —
which happens the moment anything touches these models, not just via a
particular script order. `create-indexes-v2` then requests the identical key
pattern under its own custom name; for indexes where the auto-built shape
happens to be *fully identical* to what this script would create, MongoDB
rejects the second attempt outright, and the old code's blanket "no name
match → try to create → catch whatever happens" reported that as a bare
`[FAIL]`.

Added a scan, between the existing name-matched branch and the create step,
over *all* existing indexes (not just the name-matched one):

```typescript
      // No exact-name match. Before creating, check whether some OTHER index
      // already has this exact shape under a different name - see the autoIndex
      // note above. Full shape match only (key, unique, partialFilterExpression
      // all exact, via the same indexShapeMatches used above) - not just the key
      // pattern - so this cannot be fooled by the dangerous case below.
      const shapeMatch = existingIndexes.find(idx => indexShapeMatches(/* ... */));
      if (shapeMatch) {
        console.log(`   ⏭️  [SKIP] ${index.name} - already exists as "${shapeMatch.name}" ` +
          `(autoIndex-built under a different name, same shape)`);
        stats.skipped++;
        continue;
      }

      // Same key pattern under a different name, but NOT the same shape - the
      // dangerous case described above (e.g. a plain unique index masquerading
      // as the partial-unique dedup index). This must stay exactly as loud as a
      // same-name mismatch: never silently accepted just because the name differs.
      const keyMatch = existingIndexes.find(idx => keysMatch(idx.key, index.spec));
      if (keyMatch) {
        console.error(`   🛑 [MISMATCH] ${index.name} - an index named "${keyMatch.name}" ` +
          `already has this key pattern but a different unique/partialFilterExpression shape`);
        // ...same detailed Expected/Actual/dropIndex-command report as the
        // existing same-name mismatch branch, stats.mismatched++, continue.
      }
```

Reused `indexShapeMatches` (already imported, already used for the name-match
branch) for the exact key+unique+partialFilterExpression comparison, and
added `keysMatch` (also already exported from `index-shape.ts`) for the
key-only check — no second comparison helper written. Full shape must match
exactly (not just key pattern) to be a skip; key-pattern-only match without
full shape agreement stays a loud, non-zero-exit `[MISMATCH]`, unchanged in
severity from the existing same-name mismatch path.

## A worse danger than I'd assumed, discovered while proving this

Confirming the fix's necessity turned up something more serious than "the
old code prints an ugly generic FAIL": MongoDB does **not** reject a second
index with the same key pattern under a different name when the *options*
differ (only when the full spec — keys and options both — is identical). So
for the specific danger this task guards against — a plain unique index
masquerading as the dedup index — the pre-fix code did not fail loudly at
all. It silently called `createIndex` for `rule_device_open_unique`, MongoDB
accepted it as a distinct index (different options from the plain one), and
the script printed `✅ [CREATE] rule_device_open_unique ... success`. The
dangerous plain-unique index would have remained fully active alongside it —
still enforcing global uniqueness on `{rule_id, device_id}` regardless of
`is_open`, exactly the bug this whole area exists to prevent — while the
script's own output falsely implied everything was fine. Confirmed directly
in the red-state test run (see below): before the fix, the live `alerts_v2`
collection ended up holding *both* `dangerous_plain_unique` and a
freshly-created, correctly-shaped `rule_device_open_unique` side by side.
This makes the fix's proactive `keysMatch` scan more important than "avoid a
noisy failure" — it's what makes the dangerous case detectable at all in this
specific no-name-match scenario, since MongoDB's own driver error wasn't
reliably going to surface it.

## Regression tests

Extended `__tests__/integration/scripts/create-indexes-v2-cli.integration.test.ts`
(the file from round 1 — not a fourth file touching `alerts_v2`, per the
review's explicit ask) with a second `describe` block, two new tests:

1. **Autoindex-built full-shape match → skip, not failure.** Opens a scoped
   Mongoose connection with default `autoIndex` (mirroring
   `verify-indexes-autoindex.integration.test.ts`'s technique exactly),
   registers the real `AlertV2` schema, `.init()`s to wait for all six
   schema-declared indexes to build under MongoDB's own generated names —
   this is the real mechanism, not a stand-in for it, so the dedup index it
   produces really does carry `unique: true` and
   `partialFilterExpression: { is_open: true }` straight from the schema, not
   assumed. Then runs the real CLI and asserts `[SKIP] rule_device_open_unique
   - already exists as "..."`, no `[FAIL]`/`[MISMATCH]` for it, and — the
   proof beyond stdout text — exactly six indexes on `alerts_v2` afterward,
   no duplicate created alongside the shadow.
2. **Same key, wrong shape → still a loud mismatch, never a skip.** Creates a
   plain unique index on `{rule_id, device_id}` (no `partialFilterExpression`)
   under a name matching neither this script's custom name nor a real
   autoIndex-generated one — the exact danger. Asserts `[MISMATCH]
   rule_device_open_unique` naming `dangerous_plain_unique`, no `[SKIP]` for
   it, and confirms live state afterward: the dangerous index is untouched
   (still `unique: true`, still no `partialFilterExpression`), no
   `rule_device_open_unique` was created, and the other five (unrelated,
   unblocked) alert index definitions were created normally.

**A real bug in my own test harness, found and fixed before these were
trustworthy:** `[SKIP]`/`[CREATE]` are `console.log` (stdout), but
`[MISMATCH]`/`[FAIL]` are `console.error` (stderr). My first draft of these
tests captured only `stdout` from the subprocess, which made
`expect(stdout).not.toContain('[MISMATCH] ...')`-style assertions vacuously
true regardless of what the script actually did — including, on inspection,
the original round-1 test's `not.toContain('Fatal error during index
creation')` check, which could never have failed since that string is also
only ever written to stderr. (That test's real load-bearing assertion was
always the live-`getLiveIndexNames`-state check underneath it, which is
exactly what the re-reviewer credited it for.) Fixed by capturing and
combining stdout and stderr in one `runCreateIndexesV2()` helper used by all
three tests in this file.

**A second real bug, in the first test's own robustness:** importing
`@/models/v2/AlertV2` (needed to build a real autoIndex scenario for test 2)
registers that schema on the *shared default* mongoose connection every test
in this Jest project uses — which independently races to auto-build the same
six indexes in the background, regardless of what any individual test does.
This made the original round-1 test's exact-name assertion
(`toEqual(EXPECTED_ALERT_INDEX_NAMES)`) flaky: a live run showed 4 of 6 index
names swapped for auto-generated ones, non-deterministically. Fixed by
changing that test's final assertion from exact names to shape-based
verification (`checkIndexExists`, one call per expected shape, plus a count
check) — which is both more robust *and* more honest about what actually
matters: that six correctly-shaped indexes exist, not that this specific
subprocess happened to win the naming race for all of them.

### TDD evidence

All three tests in the file, green with the fix:

```
✓ running the actual script against a database with no alerts_v2 collection
  creates all six AlertV2 indexes instead of aborting (1849 ms)
✓ an index autoIndex already built under a different name, with the
  identical shape, is skipped rather than reported as a failure (1834 ms)
✓ an index with the same key pattern but a different
  unique/partialFilterExpression shape is still reported as a loud mismatch,
  never silently skipped (1929 ms)
Tests: 3 passed, 3 total
```

Ran 3 times in a row to check stability given the autoIndex-race territory:
3/3 each time.

**Red** (`git stash push -- scripts/v2/create-indexes-v2.ts` to isolate just
the round-2 shape-scan code, keeping round-1's guard intact):

```
✓ running the actual script against a database with no alerts_v2 collection
  creates all six AlertV2 indexes instead of aborting (1981 ms)
✕ an index autoIndex already built under a different name, with the
  identical shape, is skipped rather than reported as a failure (1861 ms)
✕ an index with the same key pattern but a different
  unique/partialFilterExpression shape is still reported as a loud mismatch,
  never silently skipped (1781 ms)
Tests: 2 failed, 1 passed, 3 total
```

Test 1 (round-1's own concern, untouched by this round's code) correctly
stayed green; the two new tests correctly went red, isolated. The mismatch
test's red-state failure is itself the "worse danger" evidence above: its
live-state assertion failed because the pre-fix script had gone ahead and
created `rule_device_open_unique` for real, next to the still-untouched
`dangerous_plain_unique`. `git stash pop` restored the fix; re-ran, 3/3
green.

Re-ran alongside `seed-alert-rules.test.ts`, both `verify-indexes`
integration tests, `index-shape`/`db-guard` unit tests, and both
`AlertV2`/`AlertRuleV2` model tests (8 suites, 68 tests) three times total:
all green every time, no interference observed.

## Proving the Definition of Done in the previously-failing order

Per the review: seed first, then the bare chain, on a genuinely fresh
database — the order that had been failing.

```
$ docker exec infrasight-phase4-mongo mongosh infrasight --quiet --eval 'db.dropDatabase()'
$ pnpm seed
...
✅ Seed completed successfully!
  (500 devices, 12,500 readings, 4 alert rules)

$ pnpm create-indexes-v2 && pnpm verify-indexes
════════════════════════════════════════════════════════════
🔧 V2 Index Creation Script
════════════════════════════════════════════════════════════
📦 Collection: devices_v2
   Existing indexes: 9
   ⏭️  [SKIP] serial_number_unique - already exists as "serial_number_1" (autoIndex-built under a different name, same shape)
   ⏭️  [SKIP] location_building_floor - already exists as "location.building_id_1_location.floor_1" (autoIndex-built under a different name, same shape)
   ⏭️  [SKIP] status - already exists as "status_1" (autoIndex-built under a different name, same shape)
   ✅ [CREATE] health_last_seen (108ms)
   ⏭️  [SKIP] audit_deleted_at_sparse - already exists as "audit.deleted_at_1" (autoIndex-built under a different name, same shape)
   ✅ [CREATE] type (115ms)
   ⏭️  [SKIP] metadata_department - already exists as "metadata.department_1" (autoIndex-built under a different name, same shape)
   ✅ [CREATE] metadata_tags (126ms)
   ⏭️  [SKIP] manufacturer - already exists as "manufacturer_1" (autoIndex-built under a different name, same shape)
   ⏭️  [SKIP] status_type_compound - already exists as "status_1_type_1" (autoIndex-built under a different name, same shape)
   ✅ [CREATE] battery_floor_compound (130ms)
   ✅ [CREATE] deleted_last_seen_compound (111ms)

📦 Collection: readings_v2
   ⏭️  [SKIP] metadata_device_timestamp - already exists as "metadata.device_id_1_timestamp_-1" (autoIndex-built under a different name, same shape)
   ✅ [CREATE] quality_is_anomaly (168ms)
   ⏭️  [SKIP] metadata_source - already exists as "metadata.source_1" (autoIndex-built under a different name, same shape)
   ✅ [CREATE] metadata_type (121ms)
   ✅ [CREATE] quality_is_valid (146ms)
   ✅ [CREATE] timestamp_desc (129ms)

📦 Collection: alert_rules_v2
   ⏭️  [SKIP] enabled_deleted_at - already exists as "enabled_1_audit.deleted_at_1" (autoIndex-built under a different name, same shape)
   ⏭️  [SKIP] audit_created_at_desc - already exists as "audit.created_at_-1" (autoIndex-built under a different name, same shape)

📦 Collection: alerts_v2
   Existing indexes: 0
   ✅ [CREATE] rule_device_open_unique (28ms)
   ✅ [CREATE] rule_device_resolved_at (12ms)
   ✅ [CREATE] status_created_at (14ms)
   ✅ [CREATE] device_created_at (14ms)
   ✅ [CREATE] severity_status (11ms)
   ✅ [CREATE] is_open_last_observed_at (12ms)

📊 Summary
   ✅ Created:    15 indexes
   ⏭️  Skipped:    11 indexes (already existed)
   🛑 Mismatched: 0 indexes
   ❌ Failed:     0 indexes
✅ Index creation completed successfully!

$ echo $?
0

...verify-indexes...
 AlertRuleV2 Collection Indexes  →  ✓ enabled_deleted_at, ✓ audit_created_at_desc  →  ✓ All expected indexes present
 AlertV2 Collection Indexes      →  ✓ rule_device_open_unique, ✓ rule_device_resolved_at, ✓ status_created_at,
                                     ✓ device_created_at, ✓ severity_status, ✓ is_open_last_observed_at
                                 →  ✓ All expected indexes present
 Collection Statistics
   devices_v2: 500 | readings_v2: 12,500 | alert_rules_v2: 4 | alerts_v2: 0
```

The 11 `[SKIP] ... already exists as "..."` lines are precisely the indexes
that used to `[FAIL]` in this exact order — every one of them now correctly
recognized by shape. `🛑 Mismatched: 0`, `❌ Failed: 0`, exit 0, and **all
eight alert indexes reported present**, via the literal bare `&&` chain, run
once, in the order that had been failing. The container is left in this
state: seeded (500/12,500/4) and fully indexed.

Only red anywhere in that `verify-indexes` run: the already-deferred
`device_timestamp` (readings_v2, direction mismatch) — untouched, exactly as
instructed.

## Gates (fix round 2)

```
$ npx tsc --noEmit
(one round of fixing needed - see below)                exit 0

$ pnpm lint
$ eslint                                                 exit 0

$ pnpm build
 ✓ Compiled successfully in 3.7s
 ✓ Generating static pages using 23 workers (32/32)       exit 0

$ pnpm test
Test Suites: 115 passed, 115 total
Tests:       2597 passed, 2597 total
```

115 suites unchanged (no new files, two new `it`s added to an existing one);
2595 + 2 = 2597 tests: exactly the two new tests from this round.

One `tsc` fix needed along the way: `EXPECTED_ALERT_SHAPES`'s array literal
had per-element `fields` objects with different key sets, which TypeScript
inferred as a union carrying stray `undefined`-valued properties from
sibling variants — incompatible with `Record<string, number>`. Fixed with an
explicit array element type annotation rather than relying on inference.

## Files touched (fix round 2)

- `scripts/v2/create-indexes-v2.ts` (the shape-before-name scan, plus an
  updated function-level comment explaining the autoIndex mechanism)
- `__tests__/integration/scripts/create-indexes-v2-cli.integration.test.ts`
  (two new tests in a new `describe` block; stdout+stderr capture fix;
  round-1 test's assertion made shape-based instead of exact-name)

## Deferred, confirmed untouched

`readings_v2`'s `device_timestamp` name/direction mismatch — still visible as
`✗ device_timestamp` in the Definition-of-Done run above, exactly as
instructed both rounds.

## Aware, not fixed: the shared-`mongodb-memory-server` race

Per the review's explicit note, did not add a fourth file touching
`alerts_v2` (extended the existing round-1 file instead). Ran the full
6-to-8-file combination three times and the full suite once with no observed
flakiness, but per instructions this is reported as "not reproduced," not as
"safe" — the race is about cross-file timing under `maxWorkers: '50%'`, which
a same-machine, low-parallelism run like mine is not well positioned to
surface either way.
