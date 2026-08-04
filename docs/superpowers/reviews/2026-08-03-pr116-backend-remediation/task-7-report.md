# Task 7 Report: `verify-indexes` must check the dedup index's shape

## Status: DONE

## Summary

`checkIndexExists` in `verify-indexes.ts` compared index key fields as a **subset**
match and the `unique` flag, but never `partialFilterExpression`. A plain unique
index on `{rule_id, device_id}` — which permanently blocks every episode after the
first resolved one for a (rule, device) pair, silently, because the evaluator
absorbs the resulting E11000 as a benign race — passed verification with a green
check. `create-indexes-v2.ts` closed none of this either: it skipped purely by
index name, so a pre-existing mis-shaped `rule_device_open_unique` printed
`⏭️ [SKIP]` and was never corrected.

All 5 required items are implemented, live-verified against a real MongoDB replica
set (not just unit tests), and committed.

## What I implemented

### 1. New file: `scripts/v2/index-shape.ts`

A side-effect-free module (mirroring the existing `db-guard.ts` pattern) exporting:

- `IndexInfo`, `ExpectedIndex` — the shared shape types (now including
  `partialFilterExpression?: Record<string, unknown>`).
- `keysMatch(actualKey, expectedFields)` — **exact, order-sensitive** key
  comparison (same fields, same values, same order, same count). Replaces the old
  subset match (item 3).
- `partialFilterExpressionsMatch(actual, expected)` — exact, **key-order-insensitive**
  structural equality via a small recursive `deepEqual`. Undefined-vs-defined on
  either side is always a mismatch (item 1's "including the case where one side has
  a filter and the other does not").
- `checkIndexExists(indexes, expected)` — existence check used by
  `verify-indexes.ts`: "does at least one index in this list satisfy the expected
  shape." Preserves the original, more permissive `unique` semantics (only checked
  when the expectation requires it) — that behavior wasn't part of the brief's
  complaint and I left it alone.
- `indexShapeMatches(actual, expected)` — **exact** equality check (fields, unique,
  and partialFilterExpression all compared strictly) used by `create-indexes-v2.ts`:
  "is this one specific live index identical to what I'd create." Unlike
  `checkIndexExists`, `unique` is compared with `Boolean(actual.unique) ===
  Boolean(expected.unique)`, not treated as a floor — an unexpectedly-unique index
  is exactly the kind of drift this function exists to catch.

This module has no MongoDB import and no top-level side effects, so importing it in
a Jest test does not trigger a connection attempt. Both `verify-indexes.ts` and
`create-indexes-v2.ts` still call their `main()`/`createIndexes()` unconditionally
at the bottom of the file, unchanged — extracting the comparison logic did not
touch that.

### 2. `scripts/v2/verify-indexes.ts`

- Removed the local `ExpectedIndex`/`IndexInfo` interfaces and `checkIndexExists`
  function; imports them from `./index-shape` instead.
- `EXPECTED_ALERT_INDEXES`'s `rule_device_open_unique` entry now declares
  `partialFilterExpression: { is_open: true }`, with a comment explaining why.
- **`getCollectionIndexes` now captures `partialFilterExpression` from the live
  index** (`idx.partialFilterExpression`), not just `name`/`key`/`unique`. This
  wasn't called out as a separate numbered item, but it's necessary plumbing: item
  1 asks `checkIndexExists` to compare the expectation "against the live index" —
  without this, the comparison would always see `partialFilterExpression: undefined`
  on the actual side regardless of what's truly in the database, and the fix would
  pass every unit test while doing nothing against a real database. I caught this
  by testing live (see below), not by reading the brief.

### 3. `scripts/v2/create-indexes-v2.ts`

- `createCollectionIndexes` now builds `existingIndexByName` (a `Map`, not a
  `Set` of names) so a name match can be shape-checked.
- When a name match is found: compares shape via `indexShapeMatches`. On match,
  `[SKIP]` as before. On mismatch, prints a `🛑 [MISMATCH]` block showing the
  expected and actual shape (fields/unique/partialFilterExpression), states that
  the script refuses to drop or modify the index automatically, and prints the
  exact commands to fix it:
  ```
  db.<collection>.dropIndex("<name>")
  pnpm create-indexes-v2
  ```
  It does **not** touch the index — confirmed live (see below).
- New `mismatched` stat, summed across all four collections and reported in the
  summary alongside Created/Skipped/Failed.
- `process.exit(1)` when `totalMismatched > 0`, checked before the existing
  `totalFailed > 0` exit — the script now fails loudly instead of silently
  succeeding with a stale, dangerous index in place.

### 4. New test file: `__tests__/unit/scripts/index-shape.test.ts`

18 tests, no mocks, no database — pure functions over plain data. Located under
`__tests__/unit/scripts/`, matching the existing `db-guard.test.ts` precedent (the
only other script-helper test in the repo).

## How I verified the scripts still run as executables

Both scripts call `main()` / `createIndexes()` unconditionally at import time, so
the biggest risk of this refactor was silently breaking `pnpm verify-indexes` /
`pnpm create-indexes-v2` as CLIs. I did not trust static reasoning for this — I
stood up a real database and ran them.

1. Started a local single-node MongoDB 7.0 replica set via Docker on port 27018,
   matching `.env.local`'s `MONGODB_URI` (a local/loopback host, so this is safe
   under the project's own `db-guard.ts` policy).
2. Created the four v2 collections (mirroring what the app does organically) and
   ran `pnpm create-indexes-v2` fresh: **26 indexes created, 0 mismatched, exit 0**.
3. Ran it again: **0 created, 26 skipped, 0 mismatched, exit 0** — idempotency
   intact.
4. Ran `pnpm verify-indexes`: all AlertV2 checks green, including
   `✓ rule_device_open_unique` against the correctly-shaped live partial index.
5. **The decisive test.** Dropped the real dedup index and recreated it as the
   catastrophic misconfiguration — a plain unique index on `{rule_id, device_id}`
   with no `partialFilterExpression` — then:
   - Ran `pnpm verify-indexes` (my fixed code): `✗ rule_device_open_unique` — caught.
   - Reverted via `git stash` and ran the **original, unmodified** `verify-indexes.ts`
     against the identical broken index: `✓ rule_device_open_unique` — a green
     check for the silently-catastrophic configuration. This is live, first-hand
     confirmation of exactly the bug the brief describes, and that my fix closes it.
   - Ran `pnpm create-indexes-v2` (my fixed code) against the same broken index:
     ```
     🛑 [MISMATCH] rule_device_open_unique - existing index shape differs from expected
        Expected: { spec: {"rule_id":1,"device_id":1}, unique: true, partialFilterExpression: {"is_open":true} }
        Actual:   { spec: {"rule_id":1,"device_id":1}, unique: true, partialFilterExpression: none }
        Refusing to drop or modify an existing index automatically. If the existing shape is wrong, drop it yourself and re-run this script:
          db.alerts_v2.dropIndex("rule_device_open_unique")
          pnpm create-indexes-v2
     ```
     It correctly created the other 5 missing `alerts_v2` indexes in the same run
     (a mismatch doesn't halt unrelated work), the "Final indexes" dump confirmed
     the broken index was left byte-for-byte untouched, and the process **exited 1**.
6. Cleaned up: stopped and removed the Docker container (`docker ps -a` confirms
   it's gone); `.env.local` was read but never modified.

## What I tested, per the anti-vacuity requirement

For every test, I mutated `scripts/v2/index-shape.ts` (backed up the correct
version first), ran `npx jest --selectProjects node --testPathPatterns="index-shape"`,
captured the real output, then restored the correct file and re-confirmed all 18
pass (`diff` against the backup after every restore confirmed byte-for-byte
correctness). Nine rounds total; several tests are cross-confirmed by more than one
round.

### Round 1 — the brief's explicit ask: revert `checkIndexExists` to the exact pre-fix body (subset field match, no partialFilterExpression check at all)

**Before (mutated):**
```
✕ REJECTS a plain unique index on {rule_id, device_id} when the expectation declares a partialFilterExpression
✓ ACCEPTS the correct partial unique index
✓ REJECTS an index with the right filter but unique: false
✓ does not let rule_device_resolved_at (as actually defined in AlertV2.ts) satisfy rule_device_open_unique
✕ does not let a rule_device_resolved_at-shaped index satisfy rule_device_open_unique even when unique and filter also match
Tests: 2 failed, 16 passed, 18 total
```
**After (restored):** all 18 pass (shown in full below).

This is the central confirmation the brief asked for: the plain-unique-index test
fails against the actual pre-fix `checkIndexExists`.

### Round 2 — isolate `keysMatch`'s subset-vs-exact behavior (reverted to `Object.entries(expected).every(([f,o]) => actual[f]===o)`, no order/count check)

**Before:**
```
✕ rejects the same fields in a different order
✕ rejects a superset of fields (the old subset-match bug)
✕ does not let a rule_device_resolved_at-shaped index satisfy rule_device_open_unique even when unique and filter also match
Tests: 3 failed, 15 passed, 18 total
```
**After:** all 18 pass.

### Round 3 — isolate `keysMatch`'s order-sensitivity from count (reverted to comparing only sorted field NAMES, ignoring direction)

**Before:**
```
✕ rejects the same fields in a different order
✕ rejects a matching field with a different sort direction
Tests: 2 failed, 16 passed, 18 total
```
**After:** all 18 pass.

### Round 4 — negative control: `keysMatch` hardcoded to always return `false`

**Before:**
```
✕ ACCEPTS the correct partial unique index
✕ treats partialFilterExpression comparison as key-order-insensitive
✕ accepts identical fields in identical order
✕ ACCEPTS a live index that is an exact match
Tests: 4 failed, 14 passed, 18 total
```
**After:** all 18 pass. Confirms every ACCEPT-path assertion genuinely depends on
`keysMatch` returning true — none of them are vacuously true.

### Round 5 — isolate the filter check: `partialFilterExpressionsMatch` hardcoded to always return `true`

**Before:**
```
✕ REJECTS a plain unique index on {rule_id, device_id} when the expectation declares a partialFilterExpression
✕ does not match when only the actual index has a filter
✕ does not match when only the expectation has a filter
✕ does not match when filter values differ
✕ REJECTS a plain unique index missing the partialFilterExpression
Tests: 5 failed, 13 passed, 18 total
```
**After:** all 18 pass.

### Round 6 — negative control: `partialFilterExpressionsMatch` hardcoded to always return `false`

**Before:**
```
✕ ACCEPTS the correct partial unique index
✕ treats partialFilterExpression comparison as key-order-insensitive
✕ matches when both are undefined
✕ matches identical filters regardless of key order
✕ ACCEPTS a live index that is an exact match
Tests: 5 failed, 13 passed, 18 total
```
**After:** all 18 pass.

### Round 7 — isolate `indexShapeMatches`'s strict `unique` semantics (changed to the permissive ternary `checkIndexExists` uses)

**Before:**
```
✕ REJECTS when unique does not match exactly, even if the expectation does not require it
Tests: 1 failed, 17 passed, 18 total
```
**After:** all 18 pass. Confirms `indexShapeMatches`'s strict-unique behavior is
real and distinct from `checkIndexExists`'s permissive behavior, not accidental.

### Round 8 — isolate `checkIndexExists` test 3's dependency on the `unique` check (hardcoded `uniqueOk = true`)

**Before:**
```
✕ REJECTS an index with the right filter but unique: false
Tests: 1 failed, 17 passed, 18 total
```
**After:** all 18 pass.

### Round 9 — honesty check on test 4 (combined: subset `keysMatch` + always-true `partialFilterExpressionsMatch` + `uniqueOk` forced true in `checkIndexExists`, simultaneously)

**Before:**
```
✕ REJECTS a plain unique index on {rule_id, device_id} when the expectation declares a partialFilterExpression
✕ REJECTS an index with the right filter but unique: false
✕ does not let rule_device_resolved_at (as actually defined in AlertV2.ts) satisfy rule_device_open_unique
✕ does not let a rule_device_resolved_at-shaped index satisfy rule_device_open_unique even when unique and filter also match
✕ rejects the same fields in a different order
✕ rejects a superset of fields (the old subset-match bug)
Tests: 6 failed, 12 passed, 18 total
```
**After:** all 18 pass.

**This round exists because I noticed something during review and verified it
empirically rather than asserting it:** the brief's fourth required test — "does
not let `rule_device_resolved_at` (as actually defined) satisfy
`rule_device_open_unique`" — uses the *real*, non-unique shape of that index. That
test is **triple-protected** in the fixed code (rejected independently by the
exact-key-length check alone, or by the `unique` mismatch alone, or by the
partialFilterExpression mismatch alone) and was **already accidentally passing
under the old, unfixed code too**, because the old code's `unique` check alone
already rejected it (`expected.unique: true` vs. this index's `unique: undefined`).
Round 1 confirms this directly: that specific test is *not* in the failing list
when `checkIndexExists` is fully reverted. It only fails when all three dimensions
are defeated at once (Round 9). This means, taken alone, that one test would not
have caught a regression in any single part of the fix — it's a weak/non-isolating
test, included because the brief names the scenario explicitly, but it is not doing
the real isolating work.

I added a fifth, adversarial companion test — "does not let a
`rule_device_resolved_at`-shaped index satisfy `rule_device_open_unique` even when
unique and filter also match" — that neutralizes the `unique` and filter
dimensions (both set correctly, matching the expectation) so only the field-count
exactness differs. Rounds 1 and 2 confirm this one fails on its own under either a
fully-reverted `checkIndexExists` or a subset-matching `keysMatch` alone. This is
the test that actually proves item 3's fix; test 4 alone does not.

### Final confirmation — full suite, restored code

```
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
```
(all 18 names shown passing; see repository test output)

## Full node project run

```
npx jest --selectProjects node
```
- Baseline (before any change): **2228 passing / 82 suites**.
- After my change: **2246 passing / 83 suites** (2228 + 18 new, 82 + 1 new file).
  Reproduced clean on three separate full runs.
- One run showed 2 failures in `simulate-cron.integration.test.ts` ("calibration
  offset in valid range") and `device-history.integration.test.ts` — exactly the
  two tests the task flagged as intermittent under parallel load. Re-ran the full
  suite twice more (2246/2246 both times) and isolated just those two suites
  (`--testPathPatterns="simulate-cron|device-history"`): 76/76 passing. Not a
  regression from this work — neither file is touched by this change.
- `npx tsc --noEmit -p tsconfig.json`: 39 pre-existing errors, identical count and
  file set before and after my change (confirmed via `git stash`); zero in any file
  I touched.
- `npx eslint` and `npx prettier --check` on all 4 touched/added files: clean.

## Files changed

- `scripts/v2/index-shape.ts` (new) — comparison helpers, side-effect-free.
- `scripts/v2/verify-indexes.ts` (modified) — imports from `index-shape.ts`; adds
  `partialFilterExpression` to the dedup expectation; `getCollectionIndexes` now
  captures live `partialFilterExpression`.
- `scripts/v2/create-indexes-v2.ts` (modified) — name-matched indexes are now
  shape-checked via `indexShapeMatches`; mismatches are reported loudly with an
  exact `dropIndex` command and cause a non-zero exit; no auto-drop.
- `__tests__/unit/scripts/index-shape.test.ts` (new) — 18 tests.

## Self-review findings

- **Completeness**: all 5 required items implemented and live-verified, not just
  unit-tested.
- **Comment accuracy**: re-read every new/changed comment against the final code
  after the mutation-testing round-trips (which is when comments most often drift
  from reality); all are accurate as written.
- **Naming**: `checkIndexExists` (list, existence, permissive-unique) vs.
  `indexShapeMatches` (pairwise, exact-unique) are named and documented to make
  their different `unique` semantics explicit rather than a trap for a future
  reader — this asymmetry is real (see Round 7/8) and intentional, not an
  inconsistency.
- **YAGNI**: considered adding `sparse`/`background` to the mismatch comparison in
  `create-indexes-v2.ts`; did not, because item 4 explicitly enumerates "keys,
  unique, or partialFilterExpression" and those two options don't cause silent
  data-integrity failures the way the other three can. `deepEqual` is a plain
  recursive structural-equality function (objects/arrays/primitives) — general
  enough to satisfy item 1's "structural equality" requirement without inventing
  speculative handling for MongoDB query-operator forms I have no evidence occur in
  this codebase's `partialFilterExpression` usage (currently just `{is_open: true}`).
- **Tests verify behavior, not mocks**: all 18 tests operate on plain data through
  exported pure functions; no jest.mock, no database. Confirmed via 9 rounds of
  real mutation testing (above), not asserted.
- **Discovered a pre-existing, out-of-scope issue while live-testing** (see
  Concerns below) and deliberately left it alone rather than opportunistically
  fixing something outside the brief's 5 items.

## Concerns

1. **Pre-existing, unrelated index-expectation drift, made newly visible by the
   item-3 exact-match fix.** While live-testing, I found that `verify-indexes.ts`'s
   `last_seen` (DeviceV2) expectation (`{'health.last_seen': 1}`, ascending) has
   never actually matched what `create-indexes-v2.ts` creates
   (`health_last_seen`: `{'health.last_seen': -1}`, descending) — a real,
   pre-existing mismatch. Under the old subset-match logic this was masked by an
   unrelated compound index, `deleted_last_seen_compound`
   (`{'audit.deleted_at': 1, 'health.last_seen': 1}`), which happens to also
   contain `health.last_seen: 1` and so satisfied the old subset check by
   accident. My exact-match fix (item 3) no longer allows that accidental match, so
   `verify-indexes.ts` now correctly reports `✗ last_seen` where it previously
   (incorrectly) reported `✓`. I confirmed this is not something my change caused —
   `git stash` shows the OLD code reports the same `✗` for the analogous
   `device_timestamp` (ReadingV2) case, which was never masked by a coincidental
   index and so was already failing before my change. I did not fix either
   mismatch: item 3's brief was specifically about disambiguating
   `rule_device_open_unique` from `rule_device_resolved_at`, not about auditing or
   correcting unrelated sort-direction drift elsewhere in the file, and touching
   either the DeviceV2/ReadingV2 expectations or their actual index creation specs
   is outside the 5 items I was asked to implement. Flagging as a suggested
   follow-up: either flip the two `verify-indexes.ts` expectations to `-1` to match
   reality, or flip the two `create-indexes-v2.ts` specs to `1` — functionally
   equivalent for a single-field index, but the two files should agree.
2. **Test 4 (the brief's literal `rule_device_resolved_at` scenario) is weaker than
   it looks** — documented in detail above (Round 9) and in the test file's own
   comments. It's real and it's the scenario named in the brief, but it doesn't by
   itself isolate any one part of the fix; the adversarial companion test I added
   does. I'm surfacing this rather than letting the four-required-tests framing
   imply each is equally load-bearing.

No other concerns. The Docker container used for live verification has been
stopped and removed; the local git tree is clean aside from the four intended
files.

---

# Addendum: `verify-indexes` creates the index it is checking for (post-review fix)

## Status: DONE

Review found a real hole, independent of the diff quality of Task 7 itself:
`verify-indexes.ts` imports every v2 model (to register schemas) and then
connects with Mongoose's default `autoIndex` behavior (`true`, never disabled
anywhere in the repo). AlertV2's dedup index has no explicit name, so connecting
builds it under Mongoose's auto-generated name (`rule_id_1_device_id_1`)
alongside whatever is already on disk. `checkIndexExists` is name-agnostic — "does
*some* index satisfy this shape" — so in exactly the scenario this task targets (a
broken plain-unique index already sitting under the real name
`rule_device_open_unique`), connecting causes the script to build the very index
it was about to look for, then report success having verified its own handiwork.
The broken, differently-named index — the one MongoDB actually enforces on every
write — is left exactly as broken as it was, silently. A verification script must
not mutate the thing it verifies.

## The fix

`scripts/v2/verify-indexes.ts`: `await mongoose.connect(uri)` →
`await mongoose.connect(uri, { autoIndex: false })`, with a comment explaining why
this is required rather than optional. No other line changed. `models/v2/AlertV2.ts`
was left alone, as instructed — naming the schema index is a separate decision.

## What I checked before touching anything else

**`create-indexes-v2.ts` — confirmed immune, two independent ways, not assumed:**

1. *Statically*: its only imports are `mongoose`, `dbConnect` (from `lib/db.ts`,
   which itself imports only `mongoose` — no models), and `indexShapeMatches`
   (from `index-shape.ts`, which has no mongoose import at all, confirmed in the
   original Task 7 work). No schema is ever registered by anything this script
   imports, so Mongoose's autoIndex mechanism — which only acts on *registered*
   models — has nothing to act on. This is immune by construction, not by luck.
2. *Architecturally, as a second, independent line of defense*: even if a shadow
   index somehow existed, `create-indexes-v2.ts`'s mismatch check looks up the
   existing index **by the expected name**
   (`existingIndexByName.get(index.name)`), not by scanning for any index that
   happens to satisfy the shape. A differently-named shadow index would not be
   found by this lookup and could not make a mismatched `rule_device_open_unique`
   read as matching. This is a structurally different (and safer) design than
   `checkIndexExists`'s "does some index satisfy this shape" existence check.
3. *Live, empirically* (see below): ran `create-indexes-v2.ts` against the exact
   broken-index database used to reproduce the `verify-indexes.ts` hole. No shadow
   index appeared, immediately after the run or 5 seconds later.

**Other scripts under `scripts/v2/` that import models:**

| Script | Imports models? | Verifies index shape? | Affected? |
|---|---|---|---|
| `seed-v2.ts` | Yes (`DeviceV2`, `ReadingV2`) | No — writes seed data | No |
| `simulate.ts` | Yes (`DeviceV2`, `ReadingV2`) | No — writes synthetic readings | No |
| `test-api.ts` | No (pure HTTP client, no mongoose import at all) | No | No |
| `db-guard.ts` | No | N/A (pure helper) | No |
| `index-shape.ts` | No | N/A (pure helper) | No |

`seed-v2.ts` and `simulate.ts` both import models and both connect with
Mongoose's default autoIndex, so both *will* trigger the same shadow-index side
effect against whatever database they're pointed at. That is not the bug this
review found: the bug is specifically "a script that CHECKS index shape gets
fooled by an index it just built." Neither of these scripts contains any
shape-checking logic — confirmed by grep (`grep -n "index\|Index"` on both files
turns up nothing beyond an unrelated loop variable literally named `index` in
`seed-v2.ts`) and, more fundamentally, by the fact that `checkIndexExists`,
`ExpectedIndex`, and `IndexDefinition` are referenced nowhere outside
`verify-indexes.ts`, `create-indexes-v2.ts`, and `index-shape.ts` (confirmed by
grep across the whole repo during the original Task 7 work). Building indexes as
a side effect of seeding/simulating is neutral-to-mildly-helpful for those
scripts, not silently dangerous, so I left them alone as instructed
("only fix the ones that genuinely have it").

## Live verification (real MongoDB, real replica set, real broken index)

Reused the same Docker-based harness as the original Task 7 work: a local MongoDB
7.0 single-node replica set on port 27018, matching `.env.local`.

1. Created the four v2 collections and seeded `alerts_v2` with **only** the
   catastrophic misconfiguration: a plain unique index named
   `rule_device_open_unique` on `{rule_id, device_id}`, no `partialFilterExpression`.
2. **With the fix in place**, ran `pnpm verify-indexes` — `Current indexes` showed
   exactly the 2 real indexes (`_id_` and the broken one), **no shadow index**, and
   `✗ rule_device_open_unique`. Ran it again, and checked the database 5 seconds
   later: still exactly 2 indexes, both times. The fix is not just correct on a
   lucky first read — it never creates the shadow index, full stop.
3. **Reverted just this fix** (`git diff`-equivalent: restored
   `await mongoose.connect(uri)`, kept every other Task 7 change) and re-ran
   against the same broken-index state:
   - First run: still printed `✗ rule_device_open_unique` — the shadow index had
     not landed yet by the time the script read the collection. Checking the
     database moments after the process exited showed `rule_id_1_device_id_1` had
     appeared anyway. **This is the race documented in the addendum's test file
     comment**: the script's own `mongoose.connect(uri)` call resolves once the
     socket is up, not once Mongoose's background autoIndex build finishes, so a
     single run can get lucky.
   - Second run, against the now-contaminated database (shadow index already on
     disk, no longer racing to be created): reliably reproduced the false green —
     ```
     Current indexes:
       • _id_
         Fields: { _id: 1 }
       • rule_device_open_unique (unique)
         Fields: { rule_id: 1, device_id: 1 }
       • rule_id_1_device_id_1 (unique)
         Fields: { rule_id: 1, device_id: 1 }

     Expected indexes:
       ✓ rule_device_open_unique
     ```
     A green check for an index that is, at that exact moment, permanently
     blocking every alert after the first for any device that ever fired one.
4. Restored the fix, dropped the shadow index, ran `create-indexes-v2` against the
   same broken index: correctly reported `🛑 [MISMATCH]`, created the other 5
   legitimately-missing `alerts_v2` indexes in the same run, left the broken index
   untouched, and — checked immediately and 5 seconds later — created **no**
   shadow index of any kind. Confirms the immunity claim empirically, not just by
   reading the code.
5. Stopped and removed the Docker container.

## Automated regression test (behavioral, not a config assertion)

New file: `__tests__/integration/scripts/verify-indexes-autoindex.integration.test.ts`.
Uses the project's existing shared `mongodb-memory-server` (the same harness every
other `*.integration.test.ts` file uses — no Docker dependency for the permanent
suite). Two tests, both against a real MongoDB:

- **`[the hole, reproduced]`**: seeds only the broken plain-unique
  `rule_device_open_unique` index, opens a fresh Mongoose connection that
  registers `AlertV2.schema` with autoIndex left at its default (mirroring the
  pre-fix `mongoose.connect(uri)` call exactly), and `await`s `Model.init()` —
  Mongoose's own documented way to wait for a model's index build to finish,
  which is what makes this deterministic rather than racy like the live CLI runs
  above. Asserts a correctly-shaped shadow index appears under a different name,
  **and** that `checkIndexExists` (the real function, not a mock) returns `true`
  — the false positive — **and** that the actually-broken, actually-named index
  is still missing its partial filter.
- **`[the fix, verified]`**: same seed, but the fresh connection passes
  `{ autoIndex: false }`. Asserts the collection's index list is unchanged (just
  `_id_` and the broken index — nothing was built), and that `checkIndexExists`
  correctly returns `false`.

### Anti-vacuity verification for both new tests

| Test | Mutation | Before (mutated) | After (restored) |
|---|---|---|---|
| `[the hole, reproduced]` | Added `{ autoIndex: false }` to *this test's own* connection (i.e., "what if the mechanism doesn't actually create a shadow index") | `expect(shadow).toBeDefined()` → **fails**, `Received: undefined` | passes |
| `[the fix, verified]` | Removed `{ autoIndex: false }` from *this test's own* connection | `expect(...).toEqual(['_id_', 'rule_device_open_unique'])` → **fails**, actually received 6 extra shadow-index names (`rule_id_1_device_id_1`, `rule_id_1_device_id_1_audit.resolved_at_-1`, `status_1_audit.created_at_-1`, `device_id_1_audit.created_at_-1`, `severity_1_status_1`, `is_open_1_last_observed_at_1` — matching all six unnamed indexes on `AlertV2Schema`) | passes |

Both mutations reverted immediately after capturing output; final file diffed
byte-for-byte identical to the pre-mutation version before proceeding.

The first mutation round also incidentally caught a bug in the test itself before
it shipped: my first draft picked "the first index that isn't `_id_` or the
broken one" as `shadow`, but `AlertV2Schema` declares six unnamed indexes (not
just the dedup one), so that predicate non-deterministically matched whichever of
the six the driver happened to return first — an early run failed on
`shadow.unique` being `undefined` because it had matched the
`rule_device_resolved_at`-shaped (non-unique) shadow instead. Fixed the predicate
to require `unique === true && partialFilterExpression !== undefined`, which
identifies the specific shadow that actually matches the dedup expectation.

> **Correction (added in the round-3 addendum below):** the table above is
> accurate about what it tested, but the claim I made in this report at the time
> — that these two tests were "mutation-verified in both directions" — was
> imprecise in a way that mattered. Both mutations were applied to **the test's
> own** `mongoose.createConnection(...)` call, not to `scripts/v2/verify-indexes.ts`.
> Neither test imports, executes, or otherwise touches that file. Review reverted
> the actual source line (`await mongoose.connect(uri, { autoIndex: false })` →
> `await mongoose.connect(uri)`) and both tests still passed — proof that they
> verify the *mechanism* (what `autoIndex: false` does, in general) but not the
> *fix* (whether the shipped script uses it). That is a real gap, not a nuance:
> a regression that deleted the fix would have shipped silently. See the round-3
> addendum for the source-mutation results and the new test that closes it.

## Test suite confirmation

- `npx jest --selectProjects node --testPathPatterns="index-shape"` — original 18
  tests: **18/18 passing**, unaffected by this round's changes.
- `npx jest --selectProjects node --testPathPatterns="verify-indexes-autoindex"` —
  new 2 tests: **2/2 passing**.
- `npx jest --selectProjects node` (full node project), run three times for
  stability: **2248/2248 passing, 84/84 suites**, every time (2246 prior total +
  2 new tests; 83 prior suites + 1 new file).
- `device-history.integration.test.ts` showed one failure when run combined with
  `simulate-cron` under parallel load in one pass — re-ran in isolation:
  **19/19 passing**. Matches the task's documented pre-existing flakiness; this
  change touches neither file.
- `npx eslint` and `npx prettier --check` on both changed/added files: clean.
- `npx tsc --noEmit -p tsconfig.json`: still exactly 39 pre-existing errors,
  none in any file touched this round (confirmed by grep).

## Files changed in round 2

- `scripts/v2/verify-indexes.ts` (modified) — `mongoose.connect(uri)` →
  `mongoose.connect(uri, { autoIndex: false })`, plus explanatory comment.
- `__tests__/integration/scripts/verify-indexes-autoindex.integration.test.ts`
  (new) — 2 behavioral tests, reusing the project's existing
  `mongodb-memory-server` harness.

## Concerns (round 2)

None new at the time. The two pre-existing sort-direction mismatches and the
literal `rule_device_resolved_at` test's weaker isolation (both flagged in the
original report above) are unchanged and remain correctly out of scope. **This
round's own test coverage turned out to have a gap — see the round-3 addendum.**

---

# Addendum 2: the round-2 tests proved the mechanism, not the fix (round-3 correction)

## Status: DONE

Review ran the one mutation that actually matters — reverting the changed source
line itself — and both round-2 tests kept passing:

```
✓ [the hole, reproduced] without autoIndex: false, connecting builds a shadow index and checkIndexExists reports a false success
✓ [the fix, verified] with autoIndex: false, connecting creates no shadow index and checkIndexExists correctly reports failure
Tests:       2 passed, 2 total
```

The report's "mutation-verified in both directions" claim was wrong for the
purpose that mattered most: I had mutated each test's *own* connection options
(`mongoose.createConnection(uri)` vs. `mongoose.createConnection(uri, {autoIndex:
false})`, both chosen inline in the test) to prove what those two option values
do in general. I never mutated `scripts/v2/verify-indexes.ts` itself and re-ran
those two tests against that mutation — the actual Global Constraint 2 check.
Neither test imports or executes that file, so a regression that deleted the fix
from the real script would pass both of them silently. That is exactly the
"tests pass for the wrong reason" failure mode this branch is about, and I
produced it despite the explicit warning. Corrected in the round-2 section above
inline; documented properly here.

## Why the obvious fixes don't work

Before building the fix, I considered two "export something from
`verify-indexes.ts`" designs and rejected both as unsound, not just as more work:

- **Export a constant** (`export const CONNECT_OPTIONS = { autoIndex: false }`,
  used as `mongoose.connect(uri, CONNECT_OPTIONS)`): reverting by changing the
  call site back to `mongoose.connect(uri)` — exactly the mutation the reviewer
  used — removes the *reference* to `CONNECT_OPTIONS` from the connect call while
  leaving the constant's own definition, and therefore any test asserting on it,
  completely untouched. A test built this way would have the identical blind spot
  as the one just found.
- **Export a `connect()` helper function**, called by `main()`: this is sounder
  (a test that actually *calls* the exported function and observes real behavior
  against a live database would catch a mutation *inside* the function), but it
  is still bypassable by a revert that changes `main()` to call
  `mongoose.connect()` directly instead of calling the helper, leaving the
  now-dead helper — and any test of it — passing untouched.

Both designs share the same shape: they ask a test to trust that `main()` still
calls the exported piece, which is precisely the fact in question. Any decomposition
of `main()`'s logic into an importable piece has this residual risk unless the
piece IS `main()`'s actual execution path with nothing left to route around.

`verify-indexes.ts` also cannot simply be `import`ed to sidestep this: `main()`
runs unconditionally at module scope and ends with `process.exit()`, so importing
the file for its exports — the same way `db-guard.ts` and `index-shape.ts` are
imported — would kill the Jest worker per the coordinator's explicit warning. I
did not add a `require.main`-style guard to work around this either: the project
has no existing precedent for that pattern in any script (confirmed by grep), and
introducing one is exactly the kind of change whose interaction with `tsx`'s
module handling (ESM-first, no `"type"` field in `package.json` to anchor
against) I could not fully verify was safe for the actual `pnpm verify-indexes`
CLI path without a lot of additional risk for a one-off test need.

## The fix: run the real file as a real subprocess

New file: `__tests__/integration/scripts/verify-indexes-cli.integration.test.ts`.
Seeds `alerts_v2` with only the broken plain-unique `rule_device_open_unique`
index (same seed helper pattern as the round-2 file), then runs
`npx tsx scripts/v2/verify-indexes.ts` as an actual child process
(`node:child_process.execFile`, promisified) from the repo root, with `MONGODB_URI`
inherited from the Jest process (the shared `mongodb-memory-server`). This is the
literal file that ships, executed exactly as `pnpm verify-indexes` executes it —
no exported seam, nothing to route around. Two assertions:

1. The subprocess's stdout, ANSI codes stripped, must show `✗ rule_device_open_unique`
   and must not show `✓ rule_device_open_unique`.
2. After the subprocess exits, `alerts_v2`'s live index list (read via the test's
   own connection) must be exactly `['_id_', 'rule_device_open_unique']` — no
   shadow index of any kind.

Assertion 2 turned out to be the one that actually matters in practice, for a
reason worth recording: this bug is racy (documented in the round-2 file's own
comments, based on manual CLI timing observations) because
`mongoose.connect(uri)` resolves once the socket is up, not once Mongoose's
background `autoIndex` build finishes. In the very first reverted-source run
below, assertion 1 (stdout) happened to pass by lucky timing — the script read
the collection before the shadow index landed — while assertion 2 (post-exit
database state) correctly failed, because by the time the subprocess had fully
exited and the test's own check ran, the background build had finished. Keeping
both assertions, rather than relying on stdout alone, is what makes this test
reliable rather than itself racy.

### Verification: revert the actual source line

Reverted `scripts/v2/verify-indexes.ts:115` from
`await mongoose.connect(uri, { autoIndex: false });` to
`await mongoose.connect(uri);` — the identical mutation the reviewer applied —
and ran the new test four times:

**Run 1** (both assertions in play):
```
FAIL node __tests__/integration/scripts/verify-indexes-cli.integration.test.ts
  ● ... › running the actual script against a broken dedup index reports failure and creates no shadow index

    expect(received).toEqual(expected) // deep equality

    - Expected  - 0
    + Received  + 4

      Array [
        "_id_",
    +   "device_id_1_audit.created_at_-1",
        "rule_device_open_unique",
    +   "rule_id_1_device_id_1",
    +   "rule_id_1_device_id_1_audit.resolved_at_-1",
    +   "status_1_audit.created_at_-1",
      ]

      92 |       const indexNames = await getLiveAlertIndexNames();
    > 93 |       expect(indexNames).toEqual(['_id_', 'rule_device_open_unique']);

PASS node __tests__/integration/scripts/verify-indexes-autoindex.integration.test.ts
Tests:       1 failed, 2 passed, 3 total
```
(Note `rule_id_1_device_id_1` — the shape-correct shadow of the dedup index —
among the four that landed in time to be observed; the round-2 mechanism file's
two tests correctly still pass, since they test a real, independent property
that this source line doesn't govern.)

**Runs 2–4** (same mutation, index-state assertion only, for reliability): failed
identically every time — `1 failed, 1 total` — confirming the failure is
dependable, not itself a coin flip:
```
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
```
(×3, all against the reverted source, all failing on the same
`expect(indexNames).toEqual(['_id_', 'rule_device_open_unique'])` assertion.)

### Verification: restore the fix

Restored `scripts/v2/verify-indexes.ts` exactly (`diff` against the pre-mutation
backup showed zero difference) and ran the same test three times:

```
PASS node __tests__/integration/scripts/verify-indexes-cli.integration.test.ts
PASS node __tests__/integration/scripts/verify-indexes-autoindex.integration.test.ts
Tests:       3 passed, 3 total
```
(×3, identical result every time.)

This is the genuine Global Constraint 2 check the report should have contained
the first time: revert the actual changed line, watch a real test fail; restore
it, watch the same test pass, repeatably in both directions.

## What was kept, unchanged

- `__tests__/integration/scripts/verify-indexes-autoindex.integration.test.ts`
  (the round-2 mechanism file) — not edited at all (`git diff` against the round-2
  commit is empty for this file). Its two tests remain exactly as strong evidence
  of what `autoIndex: false` does against a real MongoDB — they are just not, on
  their own, a guard against this file's own regression, which is now the new
  file's job.
- `scripts/v2/verify-indexes.ts`'s fix itself — untouched; review confirmed it
  correct, only the test coverage was the issue.

## Test suite confirmation (round 3)

- New e2e test alone: **1/1 passing**, ~2s per run.
- All three autoIndex-related test files together
  (`verify-indexes-cli` + `verify-indexes-autoindex`): **3/3 passing**, run three
  times for stability.
- `npx jest --selectProjects node` (full node project), run three times:
  **2249/2249 passing, 85/85 suites**, every time (2248 prior + 1 new test; 84
  prior suites + 1 new file).
- `device-history.integration.test.ts` and `simulate-cron.integration.test.ts`
  isolated together: **76/76 passing** — the documented pre-existing flakiness,
  unaffected by this round (neither file touched).
- `npx eslint` / `npx prettier --check` on the new file: clean (one
  `no-control-regex` disable comment removed after eslint reported it as
  unnecessary — the rule isn't enabled in this project's config).
- `npx tsc --noEmit -p tsconfig.json`: still exactly 39 pre-existing errors, none
  in the new file.
- `pnpm verify-indexes` and `pnpm create-indexes-v2`, run live against a fresh
  Docker MongoDB 7.0 replica set (same harness as prior rounds): both still work
  as executables — clean index creation (26/26), correct `✓`/`✗` reporting on a
  properly-created dedup index, exit 0 for both. Container stopped and removed
  afterward.

## Files changed in round 3

- `__tests__/integration/scripts/verify-indexes-cli.integration.test.ts` (new) —
  1 end-to-end test, spawns the real script as a subprocess against the shared
  `mongodb-memory-server`.
- `.superpowers/sdd/pr116-fixes-plan/task-7-report.md` (this file) — corrected
  the round-2 "mutation-verified in both directions" claim and documented the gap
  and its fix.

No changes to `scripts/v2/verify-indexes.ts`, `create-indexes-v2.ts`,
`index-shape.ts`, or any round-1/round-2 test file.

## Concerns (round 3)

None new. Same two pre-existing, out-of-scope items as before (sort-direction
drift on `DeviceV2.last_seen`/`ReadingV2.device_timestamp`; the literal
`rule_device_resolved_at` test's weaker isolation in the round-1 unit tests).
