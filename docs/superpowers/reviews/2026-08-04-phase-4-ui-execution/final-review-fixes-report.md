# Final Whole-Branch Review — Fix Wave Report

Date: 2026-08-04/05
Branch: `feat/phase-4-alerting`
Starting HEAD: `02684ef`
Ending HEAD: `1df1d70`

Status: **DONE**. All items (1 Critical, 6 Important, 4 Minor) fixed. All four
gates strict and clean at the end. No re-seed or drop of the local Docker
MongoDB container (port 27018) was needed or performed — every fix that
touches persisted data was verified via Jest against `mongodb-memory-server`.

---

## Gate results (final, on committed HEAD `1df1d70`)

```
$ npx tsc --noEmit
(no output — 0 errors)

$ pnpm lint
$ eslint
(0 problems)

$ pnpm build
✓ Compiled successfully in 3.8s
✓ Completed runAfterProductionCompile
✓ Generating static pages using 23 workers (32/32)
(build succeeded, exit 0)

$ pnpm test
Test Suites: 115 passed, 115 total
Tests:       2616 passed, 2616 total
Snapshots:   0 total
Time:        50.165 s
```

Baseline was 2598 passing / 115 suites. Final is **2616 passing / 115
suites** — +18 tests, all new (see per-item breakdown below), zero
regressions, zero skips. The `device-history.integration.test.ts` flake
mentioned in the brief did not appear in any of the ~4 full-suite runs
performed during this pass; nothing in it was touched.

---

## Commits

1. `2a19c82` — `fix(alerts): redact demo-mode PII and tighten alert endpoint contracts`
   (Critical 1, plus M1, M2, M4 — same files, see rationale below)
2. `d22f110` — `fix(ingest): evaluate alerts only against readings that actually persisted`
   (Important 2)
3. `3cdfff8` — `fix(alerting): confirm alert notifications on a field only the confirming op sets`
   (Important 5)
4. `86e9d30` — `fix(alerting): guard against a malformed ALERT_STALE_AFTER_SECONDS`
   (Important 6)
5. `ea23fac` — `fix(seed): clear alerts_v2 on reseed to avoid phantom alerts`
   (M3)
6. `50dea0e` — `docs: rewrite PHASE_4_HANDOFF as a completion summary`
   (Important 3)
7. `1df1d70` — `docs: document the alerting subsystem in CLAUDE.md and README`
   (Important 4)

**Commit grouping rationale:** Critical 1, M1, M2, and M4 all land in the
same small set of route files (`app/api/v2/alerts/route.ts`,
`app/api/v2/alerts/[id]/route.ts`, `app/api/v2/alert-rules/route.ts`,
`app/api/v2/alert-rules/[id]/route.ts`). Splitting them into separate
commits would have required interactive hunk-level staging (`git add -p`)
inside files that are only 100–220 lines each, which is fragile to script
non-interactively and not worth the risk for changes this small and this
tightly co-located. Each sub-fix is called out distinctly in commit 1's
message and is independently reviewable in the diff. Every other item got
its own commit since its files were untouched by any other item.

---

## CRITICAL 1 — Demo visitor shown an admin's email

**Fix.** Added `lib/alerting/redact.ts` (`redactAuditForDemo`) and
`isDemoCaller()` in `lib/auth/index.ts` (keyed on `DEMO_USER.userId`, the
same sentinel `createDemoAuthContext()` already uses, rather than a second
hardcoded `'demo'` string). Wired into all four endpoints named in the
brief:

- `app/api/v2/alerts/route.ts` (GET, list)
- `app/api/v2/alerts/[id]/route.ts` (GET, and the PATCH response)
- `app/api/v2/alert-rules/route.ts` (GET, list)
- `app/api/v2/alert-rules/[id]/route.ts` (GET)

Each now captures the full `AuthContext` from `requireOrgMembership()` /
`requireAdmin()` (previously discarded — `await requireOrgMembership();`
with no assignment) and redacts before returning. Redacted actor fields
become the literal string `"an administrator"`; `'system'` actors
(auto-fired/auto-resolved/swept) are left untouched, since they were never a
person's identity and the UI text ("closed automatically...") already
depends on being able to tell the two apart. Confirmed PATCH is
`requireAdmin()`-only, so `isDemoCaller()` is unreachable-true there today
(a demo caller 403s before the handler body runs) — redaction is applied
anyway for defense in depth, per the brief's explicit instruction, and a
dedicated test (`should 403 a demo-mode visitor attempting to PATCH, never
reaching the response body`) documents and locks in why that path is
currently unreachable rather than leaving it as an unstated assumption.

A type issue surfaced during implementation: `WithAudit`'s `audit` field was
initially typed `Record<string, unknown>`, which the concrete `IAlertAudit`/
`IAlertRuleAudit` interfaces (no index signature) are not structurally
assignable to — `tsc` failed with "Index signature ... is missing" at all
four call sites. Fixed by typing the constraint as `audit?: object | null`
and casting internally only where field values are read/written (values are
never anything but replaced-string-with-string, so the internal cast is
safe by construction even though the public generic signature isn't).

**Tests.** Both integration test files (`alerts.integration.test.ts`,
`alert-rules.integration.test.ts`) got a new `describe('demo mode
redaction', ...)` block. Per-endpoint pairs: a demo-mode request whose
entire JSON body is asserted `not.toContain('@')` (deliberately blunt —
catches a leak through any field, not just the ones anticipated), and a
genuinely-authenticated-admin request to the same endpoint asserting the
real email IS present (proves the fix isn't unconditional over-redaction).
Plus one test confirming a `'system'` actor is left as `'system'`, not
relabeled to `"an administrator"`.

New tests: 8 in `alerts.integration.test.ts` (1 for M2's pending-404, 7 for
demo-mode redaction across list/single/PATCH-unreachable/PATCH-real/system-actor),
4 in `alert-rules.integration.test.ts` (list x2, single x2). Total: 12.

**Deletion-check evidence.** Stashed only the four route files'
redaction-wiring diff (`git stash push -- <4 files>`, keeping the new tests
and `lib/alerting/redact.ts` in place), then ran:

```
npx jest --selectProjects node -t "demo mode redaction" \
  __tests__/integration/api/alerts.integration.test.ts \
  __tests__/integration/api/alert-rules.integration.test.ts
```

Result: **4 failed** (the 4 "should redact..." tests), 7 passed (the "real
actor" / system-actor / PATCH-403 tests, which don't depend on the fix).
Failure output showed the actual leak, e.g.:

```
Received string: "...\"audit\":{...\"created_by\":\"admin@example.com\",
  ...\"acknowledged_by\":\"admin@example.com\"}}..."
```

i.e. against the unfixed routes, a demo-mode request's raw JSON body
contained `admin@example.com` verbatim, exactly the leak described. Restored
the stash (`git stash pop`) and re-ran the full suite to confirm all green
again before committing.

---

## IMPORTANT 2 — Ingest evaluates readings that may never have persisted

**Fix.** `app/api/v2/readings/ingest/route.ts`: added an `insertedReadings`
accumulator built alongside the existing batch-insert loop instead of
reusing `validReadings` (everything *attempted*) for evaluation.

- Success branch: `insertedReadings.push(...insertResult)` — the actual
  documents `insertMany` returned.
- Catch branch: read `error.insertedIds` (confirmed via `mongodb@7`'s own
  `mongodb.d.ts`: `MongoBulkWriteError.insertedIds` is a `{ [key: number]:
  any }` index→id map, "hash key is the index of the originating operation")
  and map each surviving index back to `batch[index]`.
- If `insertedIds` is absent but `insertedCount > 0` (a partial failure with
  no way to identify which specific entries survived), the batch
  contributes **nothing** to evaluation — a deliberate under-approximation,
  called out both in a code comment and here per the brief's instruction.
  `results.inserted` (the response's reported count) is unaffected by this
  choice; only alert evaluation's visibility into that batch is reduced.
  This is the same shape of fix already applied to the cron path in commits
  `2480e01`/`4cb3d26`, so the two write paths now agree.

`safeEvaluateReadings` is now called with `insertedReadings` and gated on
`insertedReadings.length > 0` rather than `results.inserted > 0` (the two
can differ in the fallback case above; the device-health-update block a few
lines up is intentionally left gated on `results.inserted`, since that
concern — "did anything persist" — is unrelated to alerting).

I did not extract a shared "only what persisted" helper between this route
and the cron route: the ingest route accumulates across multiple batches
with two distinct recovery paths (success-array vs. insertedIds-mapped),
while the cron route calls `ReadingV2.bulkInsertReadings()` once and gets
the subset directly. The actual duplicated logic between the two paths is
small (a few lines) and shaped differently enough (batching vs. not) that
extracting a helper looked like it would need its own indirection layer to
paper over the difference — more complexity than the ~15 duplicated lines
justify. Flagging this judgment call per the brief's "use your judgement."

**Tests.** Two new tests in `readings-ingest.integration.test.ts`'s new
`describe('partial insert handling', ...)`, mirroring the cron path's
existing "partial insert handling" tests but driving the rejection through
`jest.spyOn(ReadingV2, 'insertMany').mockRejectedValueOnce(bulkError)` (the
actual call this route makes) rather than mocking `bulkInsertReadings`
(which this route doesn't use) or mocking the evaluator's argument
directly. `evaluateReadings` is spied on with a plain `jest.spyOn` (calls
through to the real implementation), so the assertion on
`evaluateSpy.mock.calls[0][0]` reflects what the real recovery logic
actually produced.

1. `evaluates only the readings that actually persisted, never the full
   attempted batch` — 3 readings in, `insertedIds: {0: ..., 2: ...}`
   (index 1 "failed"). Asserts `body.data.inserted === 2`,
   `body.data.rejected === 1`, the evaluator received exactly 2 readings
   (device_01 and device_03, never device_02), and — the strongest
   assertion — no alert exists for device_02 even though it breaches the
   identical rule at the identical value as its surviving peers, while
   device_01 does have a firing alert.
2. `treats a batch as contributing nothing to evaluation when insertedIds
   is unavailable` — `insertedCount: 1`, no `insertedIds`. Asserts
   `evaluateSpy` is never called, a `logger.warn` fires mentioning
   `insertedIds`, and no alert is created despite the reading breaching.

**Deletion-check evidence.** Stashed only `app/api/v2/readings/ingest/
route.ts` (keeping the new tests), ran:

```
npx jest --selectProjects node -t "partial insert handling" \
  __tests__/integration/api/readings-ingest.integration.test.ts
```

Result: **2 failed**, matching the bug exactly —

```
evaluates only the readings that actually persisted...
  Expected length: 2
  Received length: 3   (all 3 attempted readings, including device_02, were passed to the evaluator)

treats a batch as contributing nothing...
  Expected number of calls: 0
  Received number of calls: 1   (evaluator was called even though there was no way to know what persisted)
```

Restored the stash and re-ran the full suite green before committing.

---

## IMPORTANT 5 — Evaluator write-confirmation race

**Fix.** `lib/alerting/evaluate.ts` Step 8's reconciliation query previously
confirmed every notification candidate (promotions and auto-resolves alike)
against a single shared predicate, `'audit.updated_at': now`. That field is
stamped by every op in a run, including the silent
observation-refresh updates a few lines above that carry no notification at
all, and by a concurrent evaluator whose own `now` lands in the same
millisecond.

Split into two ID buckets (`promotedIds`, `resolvedIds`) confirmed via
`$or` against a field only that transition type's op ever sets:
`fired_at` for promotions, `audit.resolved_at` for auto-resolves — mirroring
`sweep.ts`'s own resolve reconciliation, which already got this right.
Added a code comment stating the house rule explicitly per the brief: *"a
write-confirmation predicate must key on a field that only the confirming
operation sets."*

**Honest limitation, stated in the code comment and here:** this narrows
the collision window dramatically (from "any write to `audit.updated_at`
anywhere in `notifiedUpdateIds`, including routine per-pair refreshes that
happen on every single evaluation call" down to "two concurrent evaluators
racing to promote/resolve the exact same specific episode with `now` values
equal to the millisecond") but does not claim to make that narrower
residual mathematically impossible — two genuine winners of the same
promotion race, computing `now = new Date()` in the same millisecond, would
still both see `fired_at === now`. The reviewer's framing ("narrow
residual") matches this: the fix is a real, large reduction in surface
area, not a formal proof of elimination.

**Test.** `evaluate.test.ts` gained one test using `jest.useFakeTimers()`
(with an explicit `doNotFake` list covering every timer/microtask function
so only `Date` is frozen — `mongodb-memory-server`'s real connection is
unaffected) to make the millisecond collision expressible at all: without
freezing time, the internal `now = new Date()` the function computes is
real wall-clock time the test cannot predict, so a racer's stamp could
never be forced to equal it. The racer (inside a `bulkWrite` spy, delegating
to the real implementation after) sets `fired_at` to a *different*,
deliberately-distinguishable timestamp than `audit.updated_at` — simulating
"a concurrent write changed status and happened to share this run's
`audit.updated_at`, but never touched `fired_at`."

**Deletion-check evidence.** Stashed only `lib/alerting/evaluate.ts`, ran:

```
npx jest --selectProjects node \
  -t "should not confirm a promotion via audit.updated_at alone" \
  __tests__/unit/lib/alerting/evaluate.test.ts
```

Result: **1 failed**, exactly reproducing the bug:

```
Expected length: 0
Received length: 1
Received array: [{"...", "fired_at":"2026-08-01T12:02:00.500Z", ...,
  "trigger_value":36, ...}]
```

i.e. the old code reported a spurious `fired` notification (with the
*second* reading's value, `36`, proving it wasn't a leftover from the first
call) even though this run's own guarded update never matched anything.
Restored the stash and re-ran the full suite green before committing.

---

## IMPORTANT 6 — Malformed `ALERT_STALE_AFTER_SECONDS`

**Fix.** `lib/alerting/sweep.ts`: extracted `parseStaleAfterSeconds()`,
guarding with `Number.isFinite` (parseInt itself never throws) and also
rejecting non-positive values (a zero or negative staleness window is
equally nonsensical for "seconds after which to consider stale" and is in
the same spirit as "malformed"). Falls back to 1800 and calls
`logger.warn` with the raw value so the misconfiguration is visible instead
of merely inert. Added `ALERT_STALE_AFTER_SECONDS` to `example.env` with an
explanatory comment (there was previously no alerting section there at
all).

**Tests.** Three new tests using `jest.resetModules()` + a dynamic
`require()` (the same technique `__tests__/unit/lib/sentry.test.ts` already
uses for its own import-time, env-driven config) since `STALE_AFTER_SECONDS`
is computed once at module load: non-numeric value (asserts both the 1800
fallback — which would be `NaN` under the old code, so this assertion alone
is not vacuous — and that `logger.warn` was called with the value),
negative value, and a valid override passing through unchanged. The
`logger.warn` assertion required requiring `@/lib/monitoring` fresh
*before* spying and *before* requiring `sweep.ts` fresh, so the spy binds
to the same module instance `sweep.ts`'s own internal require resolves to
— spying on the test file's already-imported top-level `monitoring` would
bind to a discarded pre-`resetModules()` instance and silently not
intercept, the exact "spy on a re-export/stale binding" failure mode called
out in the brief.

No separate deletion-check run was performed for this item (not one of the
three the brief asked for), but the reasoning is the same: `STALE_AFTER_
SECONDS` would be `NaN` under the pre-fix `parseInt(... ) ` with no guard,
so `expect(fresh.STALE_AFTER_SECONDS).toBe(1800)` fails without the fix by
construction (`NaN !== 1800`).

---

## MINORS

**M1** (`app/api/v2/alerts/route.ts:14-19`) — Corrected the header comment.
It claimed "Nothing publishes alerts over Pusher yet either... Real-time
delivery is Task 13/14's job" — false, since `safeEvaluateReadings`/
`safeSweepStaleAlerts` (`lib/alerting/index.ts`) publish internally via
`publishAlertEvents`. Kept the surrounding "deliberately not cached"
paragraph, replaced only the false sentence with an accurate one describing
where publishing actually happens. Bundled into commit `2a19c82`.

**M2** (`app/api/v2/alerts/[id]/route.ts:72`) — `AlertV2.findById(id)` now
also checks `status !== 'pending'`, 404ing a pending alert to match the list
endpoint's enforced contract that `pending` is internal and never returned.
PATCH already 422s correctly via `AlertTransitionError`'s `NOT_YET_FIRING`
code and was left alone. New test:
`should 404 for a pending alert, matching the list endpoint's contract`.
Bundled into commit `2a19c82`.

**M3** (`scripts/v2/seed-v2.ts:337`) — Added `await AlertV2.deleteMany({})`
alongside the existing `DeviceV2`/`ReadingV2`/`AlertRuleV2` clears, plus the
`AlertV2` import. **This contradicts an earlier plan instruction** ("do not
delete `alerts_v2` in the seed", intended to let a reseed demonstrate the
staleness sweep) — made the change per the brief's explicit direction, and
per the brief, flagging it here for the plan correction. No automated test
added (see the rationale in commit `ea23fac`'s message — the script calls
`seed()` at import time against a real database, making it impractical to
unit test without a larger, out-of-scope refactor). Did not run `pnpm seed`
against the shared local container to verify, per the instruction not to
re-seed/drop unless a fix genuinely requires it — this one is a one-line
addition identical in kind to its three neighbors, and `tsc`/`build` cover
the import and call wiring; I judged that sufficient without touching the
shared container's data.

**M4** (`app/api/v2/alerts/[id]/route.ts:189`) — Wrapped the manual-resolve
`publishAlertEvents(...)` call in try/catch, mirroring
`safeEvaluateReadings`'s own nested try/catch around the identical call
(`lib/alerting/index.ts`). `notify.ts` already swallows Pusher's own
trigger failure internally, so the residual this closes is envelope
construction faulting after the resolve already committed to the database
— previously that would have surfaced as a 500 on an otherwise-successful
mutation. Bundled into commit `2a19c82`.

---

## IMPORTANT 3 — `docs/PHASE_4_HANDOFF.md`

Rewritten per the brief: dropped the "not finished, must not be merged"
banner, the "what is left" section (nothing is left — 20/20), and every
reference to the retired `tscheck`/`lintcheck` scripts. Retitled to `Phase
4 Alerting — Handoff & Retrospective` with a `Status: complete.` line up
top. Kept the "Notes to my future self" section verbatim (the plan-defect
table, the four-pattern "tests that pass for the wrong reason" taxonomy,
model-tiering observations, cross-task-boundary notes, session-limit
notes) and added one short update paragraph extending that taxonomy with
this final review's own finding (nine vacuous tests, a fifth pattern). Also
replaced the old "Deferred minor findings" list — which I found to contain
at least one now-inaccurate entry (its note about `recordAlert` being
incremented before `bulkWrite` no longer matches the current code, which
records after Step 8's confirmation) — with the final review's own,
current "fine to carry" list, rather than auditing and reconciling ~12
old bullets one-by-one against current code, which felt like unbounded
scope for what the brief asked. Numbers used: 20/20 tasks, 2598 tests / 115
suites, 33 v2 endpoints, gates strict — exactly as specified in the task.

## IMPORTANT 4 — `CLAUDE.md` / `README.md`

See commit `1df1d70`'s message for the itemized list. Highlights: endpoint
counts corrected (25→33, "8 categories"→"9 categories" in CLAUDE.md); a new
"Alerting (8 endpoints)" reference section; `AlertsPanel.tsx` reference
fixed to `AnomalyPanel.tsx`; `models/v2/AlertRuleV2.ts`/`AlertV2.ts`,
`lib/alerting/`, the 10 alert React Query hooks, `v2Api.alerts`/
`v2Api.alertRules`, the `/alerts` app routes, and `components/alerts/` all
added to their respective existing lists; RBAC permissions table gained 7
rows for the alert endpoints. README.md's endpoint count, project
structure tree, and API Overview table were updated the same way, plus one
Features bullet. Did not touch `DEMO_MODE`/`NEXT_PUBLIC_DEMO_MODE`
anywhere in either file — confirmed via `git log 539181d..HEAD` that demo
mode predates this branch entirely (zero commits touching
`lib/auth/index.ts`'s demo logic, `example.env`, or `DemoBanner.tsx` on this
branch), so its absence from CLAUDE.md is a pre-existing gap unrelated to
this phase, out of scope for this fix.

---

## Items explicitly NOT touched (per "Do NOT fix")

Confirmed left alone: the dead `forDurationSeconds` prop on
`AlertDetailView`; `clearAllCaches()` not clearing the alert-rules key; the
severity aggregation's missing index; the `rows.length < PAGE_SIZE`
pagination heuristic; the 33 wire/Zod type pairs (no conformance test
added); the `device-history` integration flake (not seen during this pass;
not modified).
