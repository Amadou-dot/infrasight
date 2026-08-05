# SDD ledger — plan: /home/yzel/github/infrasight/docs/superpowers/plans/2026-08-01-alerting-subsystem.md

Worktree: /home/yzel/github/infrasight-phase4 (branch `feat/phase-4-alerting`, off `origin/main` 539181d)
Plan lives on branch `docs/phase-4-alerting-design` in /home/yzel/github/infrasight (commit 65821fb).

## Environment

- Baseline `pnpm test`: 85 suites / 2173 tests, all green. STRICT gate.
- Baseline `pnpm build`: clean. STRICT gate.
- Baseline `npx tsc --noEmit`: **39 pre-existing errors**, all in `__tests__/`. Gate is `./.superpowers/sdd/2026-08-01-alerting-subsystem/tscheck` (diffs against baseline, fails only on additions).
- Baseline `pnpm lint`: **311 problems (308 errors)**. Gate is `./.superpowers/sdd/2026-08-01-alerting-subsystem/lintcheck` (same mechanism).
- Local MongoDB for Tasks 19–20: Docker container `infrasight-phase4-mongo`, replica set `rs0`, on `mongodb://127.0.0.1:27018`. Worktree `.env.local` points at it.
- Jest needs no external DB (mongodb-memory-server + mocked Pusher env in `__tests__/setup/globalSetup.ts`).

## Pre-flight rulings

- `usePusherAlerts` ref pattern (Task 14): human ruled **lint-clean for both hooks** — the new hook AND the existing `usePusherReadings` move the ref assignment into a commit-phase effect. Deviates from "copy the existing shape verbatim" because that shape is baseline lint error `lib/pusher-context.tsx | react-hooks/refs`; copying it would add a second instance. Expect `lintcheck` to report 310 after Task 14.
- Plan defect fixed before execution: seeded alert rules moved to `scripts/v2/alert-rule-seeds.ts` (side-effect-free) because `seed-v2.ts` calls `seed()` at module scope and importing it from a test would wipe the test DB.

## Progress

Task 1: complete (commits 539181d..d2da082, review clean — spec ✅, quality Approved, 0 Critical/Important)
Task 1: controller-verified ⚠️ item — reviewer could not confirm self-reported gate results; I ran both: tscheck 0, lintcheck 0.
Task 1: controller-verified implementer's baseline edit — regenerated the true baseline from BASE 539181d; 39 errors before and after, sole delta was factories.ts(136,5)->(137,5), same TS2741. Nothing hidden.
Task 1: gate hardened — tscheck now normalizes away line:column so baselines cannot drift when an edit shifts lines in a baseline-carrying file. No agent needs to touch the baseline again.
Task 1: plan corrected (docs branch b7dacde) — two real defects found by the implementer: Mongoose implicit [] default on selector array paths (now `default: undefined`), and `Types` imported as a value though only used as a type. Task 2's model code carried the same import defect and was fixed too.
Task 1: minor (deferred): dropped the explanatory comment above the `type Types` import (AlertRuleV2.ts:1) — signpost lost for why this differs from Task 7's value import.
Task 1: minor (deferred): pre('save') branch (AlertRuleV2.ts ~365) untested; only the findOneAndUpdate middleware path is exercised.
Task 1: minor (deferred): no negative test that an invalid selector.types value is rejected by the schema enum.

Task 2: complete (commits d2da082..b1de00a, review clean — spec ✅, quality Approved, 0 Critical/Important)
Task 2: controller-resolved ⚠️ item — `resolved_value` declared but unset in this task. Confirmed Task 7's auto-resolve bulk write sets `resolved_value: state.lastValue`. Manual resolve (Task 10) and sweep (Task 8) deliberately leave it unset: neither has a reading to attribute. Field is not dead weight.
Task 2: controller-verified partialFilterExpression reaches collection.createIndex (create-indexes-v2.ts:278-281); both gates 0.
Task 2: plan corrected (docs branch 77ca206) — AlertInput.rule_id was `unknown`, which collapses to `never` against Mongoose create() overloads; now Types.ObjectId. Test count 15 -> 16.
Task 2: minor (deferred): acknowledge() redundantly $sets is_open: true (AlertV2.ts:602) — defensive no-op, wants a clarifying comment.
Task 2: minor (deferred): AlertV2Schema has no pre('findOneAndUpdate') hook unlike ScheduleV2, so a future direct findOneAndUpdate bypassing the statics won't bump audit.updated_at. Plan-mandated shape.

Task 3: complete (commits b1de00a..d009ae3, review clean — spec ✅, quality Approved, 0 Critical/Important, no ⚠️)
Task 3: controller-verified types/v2/alert.types.ts has ZERO import statements (client-safe for lib/pusher-context.tsx in Task 14); both gates 0.
Task 3: plan corrected (docs branch 394efbc) — generic multiValue<T> helper loses inner literal types under Zod 4 and fails typecheck; unions now inline, matching schedule.validation.ts. Also folded the date-range refine into the schema instead of an append-after instruction, and fixed test count 12 -> 13.
Task 3: minor (deferred): selector tags rules hand-duplicated rather than sharing an un-defaulted helper with common.validation.ts tagsSchema (which carries .default([]) and so cannot be reused directly).
Task 3: minor (deferred): no test covers typesRequiredForValueMetric via the UPDATE path (reviewer traced it manually and confirmed correct); only the create path is asserted.
Task 3: minor (deferred): updateAlertRuleSchema atomic-group refine always anchors its error to path ['metric'] even when metric was absent from the payload.

Task 4: review -> Needs fixes. 3 Important, all test-coverage (production code correct):
  (1) getMetricsSnapshot().alerts untested + stale toHaveProperty enumeration; (2) resetMetrics() nested alerts fields unasserted; (3) invalidateAlertRules() has no test at all.
Task 4: controller ruling on finding (3) — reviewer labeled it plan-mandated because Task 4's file list omitted cacheInvalidation.test.ts. An omission is not a mandate: adding the test contradicts no plan text and matches the convention all 7 sibling functions in that file follow. Routed into the fix loop rather than to the human.
Task 4: fix round 1/5 (3 addressed, 0 open — snapshot alerts coverage, resetMetrics nested fields, invalidateAlertRules tests; commits 2dcac3f..28d8d6f, test-only)
Task 4: complete (commits d009ae3..28d8d6f, review clean after 1 fix round)
Task 4: minor (deferred): clearAllCaches() docstring says "all application caches" but its Promise.all does not del(alertRulesKey()).
Task 4: minor (deferred): recordAlert describe block has a redundant beforeEach(resetMetrics) duplicating the outer block's.
Task 4: minor (deferred): the nested `alerts` MetricsStore group lacks a one-line JSDoc, unlike sibling groups cache/ingestion/database.

Task 5: complete (commits 28d8d6f..eb78aad, review clean — spec ✅, quality Approved, 0 Critical/Important, no ⚠️)
Task 5: implemented on haiku (49k tokens / 14 tool uses vs sonnet's ~120k). Reviewer explicitly checked for sloppiness and found none. Haiku is the right tier for tasks whose plan text carries complete code.
Task 5: minor (deferred): compare() uses `default: return false` rather than a never-exhaustiveness guard; a 5th AlertComparison would silently return false instead of failing at compile time.
Task 5: minor (deferred): matchesSelector's param is widened to `IAlertRuleSelector | undefined` vs the brief's signature; no test covers the undefined branch.

Task 6: complete (commits eb78aad..bd6ae7b, review clean — spec ✅, quality Approved, 0 Critical/Important)
Task 6: implemented on haiku (50k tokens / 13 tool uses). Reviewer verified every named correctness detail: _id normalization on both paths, 15-type pre-seeding, empty-array-as-fleet-wide, $exists:false predicate, maxCooldownSeconds 0 (not -Infinity) for empty rule set.
Task 6: plan corrected (docs branch 8b7d21d) — my earlier global sed fixing Task 3's test count also rewrote Task 6's, which was already right at 12. Reverted. Lesson: anchor sed to a line number when the pattern is not unique.
Task 6: minor (deferred): no test asserts ruleCount === rules.length for a non-empty set (only the 0 case).
Task 6: minor (deferred): redundant `as ReadingType` cast at rule-cache.ts:60 — READING_TYPES is already typed readonly ReadingType[].

Task 7: review -> Approved, 0 Critical/Important, 5 Minor, 1 ⚠️.
Task 7: controller-resolved ⚠️ — "acknowledged never returns to firing" had no direct test (shares the tested `firing` fallthrough). Behaviour verified correct by inspection, but the guarantee is design-load-bearing and a future branch split would go uncaught. Confirmed as a real gap -> fix round.
Task 7: fix round 1/5 (1 addressed, 0 open — acknowledged re-breach test, all 5 required assertions present; commits 41eb576..26840b0, test-only)
Task 7: minor (deferred): recordAlert('fired'/'resolved') is incremented in the decision loop BEFORE bulkWrite, so it is not reconciled against failedIndices. Under a concurrent E11000 race both callers count a fire though only one document is created. Persisted state and Pusher notifications are correctly guarded; only counter precision is affected.
Task 7: minor (deferred): the readings/devices-empty early return skips recordAlertEvaluationDuration, while the pairs-empty branch records it. Inconsistent observability.
Task 7: minor (deferred): three "refresh observation only" updateOne blocks repeat the same filter/$set/$max skeleton; a small helper would DRY it.
Task 7: minor (deferred): `as number` / `as Date` / `as unknown as IAlertV2` casts are safe today only because they sit inside the `state.breaching` branch; nothing in the type system enforces that.
Task 7: >>> CARRY INTO TASK 8/9 <<< an updateOne that loses a race to the staleness sweep matches ZERO documents rather than erroring, so it is not filtered by failedIndices and would still broadcast. Consider whether notifications need reconciling against bulkWrite's per-op matchedCount/modifiedCount, not just writeErrors.
Task 7: complete (commits bd6ae7b..26840b0, review clean after 1 fix round)

Task 8: implementer adffc4c7b8a33db52 cut off by session limit after writing sweep.ts + sweep.test.ts; lib/alerting/index.ts missing, nothing committed. Resumed with the remainder -> commit 9ee710f.
Task 8: review -> Needs fixes. 2 Important, BOTH originating in the plan's own code:
  (1) DATA LOSS RACE — sweep's pending deleteMany filtered on _id alone. A concurrent evaluateReadings can promote pending->firing (via its own status-guarded update) between the sweep's snapshot read and its bulk write; the unguarded delete then destroys a legitimately-fired alert's history. Materially worse than the tolerated resolve-path interleaving, where the worst case is a spurious notification.
  (2) VACUOUS TEST — the safeEvaluateReadings swallow test seeded no rule, so pairs.size===0 short-circuited before the mocked AlertV2.find throw was ever reached. The assertion held regardless of whether the try/catch ran.
Task 8: this validates carrying Task 7's interleaving note forward — the reviewer used it to confirm resolve/refresh interleaving is tolerable AND to find that the delete path is not.
Task 8: plan corrected (docs branch e3ac047) — deleteMany now guarded on status:'pending'; swallow test now seeds a matching rule and asserts the mock + logger.error were actually called.
Task 8: fix round 1/5 (2 addressed, 0 open — deleteMany status guard + de-vacuumed swallow test; commits 9ee710f..9f606b3)
Task 8: minor (deferred): STALE_AFTER_SECONDS parseInt has no NaN guard; a malformed ALERT_STALE_AFTER_SECONDS silently disables the staleness check (device-inactive detection still works).
Task 8: minor (deferred): sweep.ts:45 re-wraps last_observed_at in new Date() though .lean<IAlertV2[]>() already returns a Date.
Task 8: complete (commits 26840b0..9f606b3, review clean after 1 fix round)
Task 8: the guard test asserts deleted===0 AND resolved===1 — a concurrently-promoted episode is now correctly RESOLVED (device inactive) rather than destroyed. Stronger than what I asked for.

Task 9: complete (commits 9f606b3..d274bcf, review Approved — 0 Critical, 1 Important PLAN-MANDATED parked, 3 Minor)
Task 9: controller-verified both projections carry _id/type/location/metadata.tags; safeSweepStaleAlerts present in cron route only (0 refs in ingest); both gates 0.
Task 9: plan corrected (docs branch 5b519a6) — the failure-isolation test spied on the @/lib/alerting barrel, which does NOT intercept safeEvaluateReadings' direct import binding to evaluateReadings. The mocked throw was never reached and the 201 assertion passed vacuously. Now spies on @/lib/alerting/evaluate and asserts toHaveBeenCalledTimes(1). Also `unit` is required on the bulk ingest item schema and was missing from the sample payloads. This is the THIRD vacuous-test defect found in my plan (Task 8 had one, Task 9 had one, Task 4's was a coverage gap).
Task 9: >>> PARKED, NEEDS HUMAN RULING <<< Important, plan-mandated: on the ingest path `validReadings` is built BEFORE the batch-insert loop and is never pruned to the successfully-inserted subset. Evaluation is gated only on `results.inserted > 0`, not "these specific readings persisted", so a reading from a partially-failed batch can fire an alert for a value never written to readings_v2. Plan's Step 3 code mandates exactly this; fixing it means zipping validReadings against insertMany's acknowledged docs / bulkError.insertedIds per batch.
  Controller ruling: REAL but LOW severity and nothing downstream depends on it. Upstream Zod validation makes partial insertMany failure rare (schema errors are caught before send; timeseries has no unique constraints), and the consequence is a spurious alert that auto-resolves on the next in-bounds reading. Deferred to the human rather than dispatching a fix that contradicts the plan. MUST be raised at the final review.
Task 9: minor (deferred): CronDevice's `metadata: IDeviceMetadata` declares `department` required though the projection only returns `tags`; a future selector field would silently read undefined.
Task 9: minor (deferred): ingest passes `existingDevices as unknown as Parameters<typeof safeEvaluateReadings>[1]` — a double-unknown cast suppressing all structural checking. Brief-mandated.
Task 9: minor (deferred): no failure-injection integration test on the cron path (ingest has one).

Task 10: review -> Needs fixes. 1 Important: list date-range filtered audit.created_at (stamped when the INVISIBLE pending episode is created) instead of fired_at (the visible domain event). With for_duration_seconds those differ by the whole duration. Diverged from codebase convention (readings->timestamp, schedules->scheduled_date). Shipped unverified — the plan had NO date-range test.
Task 10: controller check before accepting the finding — confirmed fired_at is never absent on a visible alert: pending episodes are DELETED rather than resolved by both the evaluator and the sweep, so every client-visible alert has fired_at set. Reviewer is right.
Task 10: plan corrected (docs branch 5b48342).
Task 10: fix round 1/5 (1 addressed, 0 open — fired_at filter + 3 discriminating tests; commits fcfc2d8..9542cc8). RED run confirmed each test returned the OPPOSITE alert before the fix.
Task 10: reviewer independently traced the two negative tests the implementer self-flagged (PATCH 403-member, 404-unknown-id) and confirmed both fail for their stated reason — not vacuous, just missing an error-code assertion.
Task 10: minor (deferred): `if (note)` discards an explicit note: '' , so a caller cannot clear an existing note. Consider `if (note !== undefined)`.
Task 10: minor (deferred): audit.updated_at is bumped twice when a note is supplied (once in the static, once by pre('save')).
Task 10: minor (deferred): PATCH 403/404 tests assert status only, not error.code.
Task 10: complete (commits d274bcf..9542cc8, review clean after 1 fix round)

Task 11: complete (commits 9542cc8..d2a01e5, review clean — spec ✅, quality Approved, 0 Critical/Important, no ⚠️)
Task 11: reviewer went further than asked — traced the cache-invalidation spy at the COMPILED-JS level to rule out the re-export-binding vacuity that bit Task 9, and ran the suite directly. Confirmed live.
Task 11: plan corrected (docs branch b61a265) — Task 3's readingTypeSchema cast to [string, ...string[]] erased the literal union, so selector.types inferred as string[] and would not assign to IAlertRuleSelector. Broke these routes at compile time.
Task 11: minor (deferred): PATCH sets 'audit.updated_at' explicitly though the pre('findOneAndUpdate') hook already does it unconditionally — dead code.
Task 11: minor (deferred): the atomic-group 400 test only exercises { threshold } alone; { metric } or { comparison } alone untested.

=== STOPPED HERE AT USER REQUEST (11/20). See docs/PHASE_4_HANDOFF.md on the feature branch. ===

## RESUMED 2026-08-04 — environment changed under us

The human ran a multi-agent backend review of PR #116 and remediated it: 16 commits
(ee92de9..35a247a), including a merge of origin/main. All 4 Critical and 7 Important
findings fixed. Full record on the docs branch at
`docs/superpowers/reviews/2026-08-03-pr116-backend-remediation/`.

**Gates changed — the baseline-diffing scripts are RETIRED.** main's b43468d merged in:
- `npx tsc --noEmit` -> **0 errors** (was 39). Verified myself, exit 0.
- `pnpm lint` -> **0 problems** (was 311). Verified myself, exit 0.
- `pnpm test` -> **2433 / 98 suites** (node 2272 + jsdom 161).
- Do NOT run or consult `tscheck` / `lintcheck` / their baselines again. Plan updated.

**jest.config.js has two projects.** node = `*.test.ts`, jsdom = `*.test.tsx`. A test
file's EXTENSION picks its environment. This bit Task 12 (see below).

Pre-flight ruling on `usePusherAlerts` ref pattern is now **half-obsolete**:
`lib/pusher-context.tsx:105-109` already uses the commit-phase effect with `[callback]`
(b43468d fixed it). Task 14 only writes the new hook; do not touch the existing one.

### Human rulings this session (AskUserQuestion, both "Recommended" taken)

- **severity sort**: fix the API, not the widget. `sortBy=severity` sorted lexically so
  desc gave warning -> info -> critical. Landed as Task 12 Step 0 ($switch rank
  aggregation, `.find()` retained for all other sort fields).
- **cron Pusher payload**: fold into Task 13. `insertedReadings` already exists in
  simulate/route.ts; only the trigger still sent `newReadings`.

### Plan corrections (docs branch bce7490) — 9 defects found in MY tasks 12-20

1. Global Constraints: gates rewritten strict; all 19 tscheck/lintcheck invocations replaced.
2. T12 Step 0 added: severity sort fix + rewrite of the test pinning lexical order.
3. T12: `useAlerts.test.ts` -> `.test.tsx` (would have run under node with no DOM).
4. T12: removed false claim that `useSchedules.test.ts` has a QueryClientProvider to copy —
   it mocks @tanstack/react-query wholesale. Repointed at `useDeviceDetail.test.tsx`.
5. T12: added `useOpenAlertCount()` (reads pagination.total).
6. T13: added cron Pusher step + files.
7. T14: deleted the stale "fix usePusherReadings / expect lintcheck 310" paragraph.
8. T15: Select props were written as a native <select> (`onChange`/`e.target.value`/
   `aria-label`); real contract is `{ value, onValueChange, options, label, size }`.
   Also resolved the Step 5 vs Step 6 URL-sync contradiction into
   `components/alerts/useAlertFilterParams.ts`, and added the Suspense boundary.
9. T17: `CreateAlertRuleBody` is now a discriminated union whose 'value' arm needs a
   non-empty tuple — a flat object literal cannot compile. Added cast-free construction.

### Carry-forward into tasks 12-20

- T18 badge must use `useOpenAlertCount()`, never `useAlertsList({limit:100}).data?.length`
  (API caps limit at 100; TopNav renders on every route).
- T18 renames `components/AlertsPanel.tsx`, does NOT delete it — live at
  `app/analytics/page.tsx:5,84`. Issue #99 calling it orphaned is stale.
- T19/T20 need the local DB: `docker start infrasight-phase4-mongo` (mongo:7, rs0, :27018).
  Container exists but is STOPPED.
- Known-remaining backend follow-ups the human logged as non-blocking: a malformed
  non-metric rule field can still abort a batch at the bulk write; AlertV2's dedup index
  has no explicit name; the 60s rule-cache TTL is a latent test trap (safe only because
  REDIS_URL is undefined under ts-jest).

Task 12: complete (commits 35a247a..d5f1b41, review clean — spec ✅, quality Approved, 0 Critical/Important)
Task 12: controller-resolved ⚠️ item — reviewer could not verify `pnpm build`. I confirmed the cause is
  environmental and pre-existing: neither the worktree's nor the main repo's `.env.local` defines
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY or CLERK_SECRET_KEY, so ClerkProvider throws during prerender.
  `pnpm build` has therefore never been runnable in this environment. Tasks 1-11 were unaffected (no
  build step); **Tasks 14, 15, 17 and 18 all have a `pnpm build` verification step that cannot run.**
  Raised with the human. Substitute gate until keys exist: `npx tsc --noEmit` + the jsdom test suite.
Task 12: reviewer independently re-derived both load-bearing fixtures rather than trusting the report —
  computed all three possible orderings for the severity test (severity-desc / created_at-desc /
  created_at-asc are pairwise distinct in BOTH directions) and confirmed useOpenAlertCount's mock keeps
  data.length=1 vs pagination.total=143. The "would this fail if the behaviour were deleted?" framing in
  the review prompt is working; keep it.
Task 12: minor (deferred): no assertion that `_severity_rank` is absent from the response, though `__v` is
  asserted. Implementation excludes it correctly (route.ts:124); the test just doesn't pin it.
Task 12: minor (deferred): useAlertDetail has only a disabled-without-id test, no happy path — plan-mandated
  (brief Step 6 code), but it is the hook Task 16's detail page consumes.
Task 12: minor (deferred): useAlertDetail's cache key ignores `options.include_device`, so two calls for the
  same id with different values share a cache entry. Mirrors the existing useScheduleDetail precedent.
Task 12: minor (deferred): severity aggregation sorts on a computed field with no supporting index and no
  allowDiskUse, unlike the indexed .find().sort() path. Plan-mandated; bounded set, so likely inconsequential.
Task 12: minor (deferred): near-identical mutation/invalidation blocks across the four alert/rule mutations.
  Matches the established useSchedules.ts idiom, so consistent rather than novel debt.
ENV UPDATE (mid-Task-13): human added NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY to
  .env.local. `pnpm build` verified working — full route manifest, no errors. The build gate is
  LIVE again for Tasks 14/15/17/18. Supersedes the Task 12 note that it could not run.

Task 13: review -> Needs fixes. Spec ✅, quality Approved, 0 Critical, 2 Important:
  (1) publishAlertEvents shares the DB call's try in both safe wrappers — a throw in the publish path
      fires the outer catch, recording evaluation_error and returning an empty result, discarding an
      evaluation that was already computed and COMMITTED. **Plan-mandated** (Step 4's literal code).
  (2) Two integration files now make real outbound pusherServer.trigger calls: readings-ingest
      (implementer disclosed) and alerts.integration (NOT disclosed, and this task edited that file).
Task 13: HUMAN RULING on finding (1) — asked which governs, plan text or reviewer. Human ruled **fix it**.
  Rationale accepted: the plan's stated goal was "so a broadcast problem is also isolated", and a dedicated
  catch isolates it just as well without corrupting the return value. Plan updated (docs 3f795be).
Task 13: reviewer verified the barrel-spy hazard was NOT present — traced TS's CommonJS codegen (named
  imports compile to live property lookups; `export {x} from` yields a configurable getter) AND ran the test
  standalone, observing auditUser="admin@example.com" while the broadcast actor="user_test_admin". That is
  the standard to hold reviewers to.
Task 13: OUT-OF-SCOPE finding carried into Task 14 — AlertEvent's `storm` variant had no field saying
  whether the storm was fired or resolved, and AlertToaster announced every storm as "N alerts firing".
  Resolved storms are expected (a floor-wide condition clearing is exactly what overflows the resolved
  list), so a mass recovery would have been reported as a mass outage. Predates Task 13 and its code
  matched the type exactly, so NOT routed into Task 13's fix loop. Landed in the plan as Task 14 Step 0
  (`of: 'fired' | 'resolved'`), plus a new Step 5b — Task 14 had NO AlertToaster test at all, though the
  toast/no-toast decision is the entire component.
Task 13: fix round 1/5 (2 addressed, 0 open — broadcast catch scoped in both wrappers + doc comment
  updated; @/lib/pusher mocked in both integration files; commits 4cb3d26..004a462, +2 tests)
Task 13: re-reviewer verified the spy target EMPIRICALLY rather than by reasoning — compiled index.ts
  through the real typescript package with module:CommonJS and confirmed call sites emit as
  `(0, notify_1.publishAlertEvents)(...)`, a property read off the module object. Implementer had
  correctly spied `@/lib/alerting/notify` (not the barrel) because index.ts imports `./notify`.
Task 13: complete (commits d5f1b41..004a462, review clean after 1 fix round)
Task 13: minor (RESOLVED, not deferred) — re-review found the new nested catches are comment-only, so a
  throw from the synchronous envelope math now vanishes with no log, no Sentry, no metric (trigger()
  wraps only the network call). Same shape as the Critical the backend review already fixed once. Did
  NOT reopen the loop; folded into Task 14 Step 0, which already edits notify.ts. Plan docs 26a6865.

Task 14: complete (commits 004a462..9b759d2, review clean — spec ✅, quality Approved, 0 Critical/Important)
Task 14: two plan defects found by the implementer, both correctly self-resolved, both fixed on docs cd4a2d5:
  (a) Step 0 made `of` required but Step 1's verbatim test literal omitted it, so the given code failed tsc;
  (b) Step 8's git add list never picked up lib/alerting/index.ts or sweep.test.ts though Step 0 edits both.
Task 14: controller-resolved ⚠️ (1) — verified `git show b3b93e2 --stat`: all five Step 0 files landed in the
  first commit as claimed (types, notify.ts, index.ts, notify.test.ts, sweep.test.ts). Boundary is correct.
Task 14: controller-resolved ⚠️ (2) — PII audit of the Pusher wire types, since Task 14 is the first code to
  actually deliver them to a browser. `FiredAlert` has no *_by/email field at all. `ResolvedAlert.actor` is
  the only candidate and is clean at ALL THREE producers: sweep.ts:102 and evaluate.ts:476 emit 'system',
  route.ts:201 emits `userId` (not auditUser). No created_by/updated_by rides along. Privacy trap is closed.
Task 14: minor (deferred): AlertToaster severity->toast-type map only exercises critical->error and
  info->info; warning->warning is never triggered by a fired alert. Low risk (Record<AlertSeverity,...> is
  exhaustively typed, so a missing key fails tsc).
Task 14: minor (deferred): sweep.test.ts errorSpy asserted with toHaveBeenCalledWith but no
  toHaveBeenCalledTimes(1), unlike the paired captureSpy. A stray extra logger.error would not be caught.

Task 15: review -> Needs fixes. Spec ❌, 0 Critical, 3 Important:
  (1) AlertList hand-rolled admin gating with useRbac (always-visible-disabled for ANY non-admin),
      introducing a THIRD pattern. useAdminAction() (lib/auth/rbac-client.tsx:53) already exists and is
      used by 4 screens; ScheduleList hides entirely. **Plan-mandated** — and my plan CONTRADICTED
      ITSELF, since Task 17 already mandated useAdminAction().
  (2) Row missing the relative timestamp the plan's own prose required. Compiled and tested clean, so
      nothing caught it — the opposite failure mode from the setPage defect, which threw a type error.
  (3) Pagination buttons icon-only with no accessible name. Tell: the test reached them via positional
      querySelectorAll('button')[0] because nothing was queryable by role+name.
Task 15: HUMAN RULING on finding (1) — **useAdminAction()**. Rationale: consistency with 4 existing call
  sites and with Task 17; on the demo deployment it still renders disabled+tooltip so the Definition of
  Done is satisfied, while a real org:member gets it hidden like everywhere else. Plan updated (14fb442),
  including the DoD, which had wrongly described disabled-with-tooltip as unconditional rather than as
  the demo-mode branch.
Task 15: plan defect found by the implementer and self-resolved — AlertList's example called
  setPage(p => p - 1) against a declared `setPage: (page: number) => void`. Fixed on docs 72f8fd5.
Task 15: minor (deferred): onError drops ScheduleList's `err instanceof Error` guard; a non-Error
  rejection would throw inside the toast call.
Task 15: minor (deferred): useAlertFilterParams cannot distinguish "never set" from "explicitly reset to
  default", so a non-default initialFilters would snap back after a user resets a filter. Dormant —
  app/alerts/page.tsx passes no initialFilters. Matters if Task 16/17 start passing them.
Task 15: fix round 1/5 (3 addressed, 0 open — useAdminAction gating across all 3 branches, formatRelativeTime
  with fired_at ?? breached_since, labelled pagination; commits 3d0513e..1f875ec, +6 tests)
Task 15: complete (commits 9b759d2..1f875ec, review clean after 1 fix round)
Task 15: re-reviewer went beyond the report — noticed jest.setup.jsdom.ts ALREADY mocks '@clerk/nextjs'
  with a factory that has no useAuth, so AlertList.test.tsx's local re-mock of the same module was itself
  a candidate for the "mocks the hook it claims to exercise" failure. Ran the file to prove the local
  registration overrides and that NEXT_PUBLIC_DEMO_MODE is read dynamically under ts-jest (not inlined
  the way Next's webpack would). 19/19 pass, all three gating branches genuinely distinguished.
Task 15: implementer chose to stub only Clerk's useAuth and let the real useRbac/useAdminAction chain run,
  rather than mocking useAdminAction. Stronger than the plan asked for; matches rbac-client.test.ts.
Task 15: minor (deferred): formatRelativeTime's week/month/year branches are untested — unreachable in
  practice since readings/alerts carry a 7-day TTL, so only seconds/minutes/hours/days fire.
Task 15: minor (deferred): useAdminAction() called twice rather than once and shared. Followed the plan's
  example literally; harmless (the hook is pure and cheap).

Task 16: review -> Needs fixes. Spec ✅, 0 Critical, 1 Important:
  Bracket-window readings fetch (app/alerts/[id]/page.tsx:34-58) passed no limit/sortBy/sortDirection.
  I verified the defaults myself: paginationSchema limit=20 (common.validation.ts:48-51) and
  readings/route.ts:104-105 sorts timestamp DESC. So a ±15min window silently kept the 20 NEWEST rows
  and dropped the run-up to the breach — a partial, plausible-looking table rather than an error.
  Untested too: AlertDetailPage.test.tsx mocks useQuery wholesale (returns [] regardless of args) and
  AlertDetailView.test.tsx feeds bracketingReadings as a prop, so params/window math were unverified.
Task 16: controller-resolved ⚠️ — reviewer could not confirm from the diff that GET /api/v2/alerts/[id]
  really 404s for an unknown id. Verified: route.ts:73 throws ApiError(ALERT_NOT_FOUND, 404) and
  alerts.integration.test.ts:455-465 asserts both the status AND the error code. Narrowing is sound.
Task 16: three implementer judgment calls all ENDORSED by the reviewer, each independently checked —
  (a) AlertDetailView owning its mutations: DeviceDetailView has no mutations at all (only a
  headerAction slot), so AlertList is the right precedent; (b) notFound() only on a genuine 404 mirrors
  useDeviceDetail.ts:104-108, and refetch() beats devices' window.location.reload(); (c) the "42"/
  "Resolved" text-collision reasoning re-derived from Testing Library's getNodeText semantics.
Task 16: minor (deferred): AlertList.tsx:75 comment says formatRelativeTime is "Shared with
  AlertDetailView (Task 16)" but the detail view uses its own absolute formatTimestamp. Comment is stale;
  the absolute-time choice itself is right for a forensic view.
Task 16: minor (deferred): report's "Admin-gating state — four checks" header documents only two
  mutations. The overall count of nine reconciles across the whole report; the subsection is mislabeled.
Task 16: minor (deferred): loading spinners lack role="status"/aria-live. Pre-existing convention across
  AlertList and devices/[id]; not a regression here, but a gap on a page reached from a toast mid-incident.
Task 16: fix round 1/5 (1 addressed, 0 open — limit:100 + sortBy:timestamp + sortDirection:asc pinned,
  useQuery wholesale mock replaced with a real QueryClient + v2Api module-boundary mock; commits
  0b18496..27022f4, +3 tests)
Task 16: complete (commits 1f875ec..27022f4, review clean after 1 fix round)
Task 16: implementer found a LANDMINE while applying the fix — types/v2/reading.types.ts's
  ListReadingsQuery (what v2Api.readings.list is declared against) had NO sortBy/sortDirection fields at
  all, only a vestigial unread `sort?: string`. Added them. Re-reviewer verified the added literal unions
  match the SERVER exactly (readingSortFields at reading.validation.ts:213, sortDirectionSchema at
  common.validation.ts:138) rather than merely making the page compile, confirmed buildQueryString has no
  key allowlist so they reach the wire, and confirmed the only other caller
  (components/devices/useDeviceDetail.ts:67-72) cannot break.
Task 16: DEFERRED FOR FINAL REVIEW — there are TWO same-named `ListReadingsQuery` types: the client wire
  type in types/v2/reading.types.ts and the Zod-inferred one in lib/validations/v2/reading.validation.ts:415
  used by the route. Pre-existing, not introduced here, but it is exactly how the missing-fields drift
  happened and it can drift again. Also the vestigial `sort?: string` survives beside the new fields —
  now documented as dead, but a future caller writing `sort: 'timestamp:desc'` gets a silent no-op.
Task 16: the new test asserts the full call object with toHaveBeenCalledWith (exact deep equality, not
  objectContaining), so dropping limit or the sort genuinely fails it. Mock binds at '@/lib/api/v2-client',
  the same specifier the page imports — verified, not assumed.

Task 17: complete (commits 27022f4..c4964ae, review clean — spec ✅, quality Approved, 0 Critical/Important)
Task 17: two cross-cutting changes, both verified safe by the reviewer against every existing call site —
  (a) optional `id?: string` added to components/ui/select.tsx and components/devices/TagInput.tsx so every
  input could carry a real <label htmlFor>. Neither had an id before nor generated one; all 9 Select
  call sites and the 1 TagInput call site pass none, so existing output is byte-identical.
  (b) guarded ResizeObserver polyfill in the GLOBAL jest.setup.jsdom.ts. Grep found no other suite
  referencing ResizeObserver, so it cannot mask a failure; this is genuinely the first test to render a
  Radix Checkbox.
Task 17: the cast-free discriminated-union construction worked — buildCreateBody branches on the literal
  and destructures [firstType, ...restTypes]. Reviewer verified it against the real union at
  alert.types.ts:90-110 rather than accepting the report. Client validation bounds cross-checked against
  the live server refinements (alert-rule.validation.ts:64-74) — inclusivity matches exactly.
Task 17: notable deletion-check result — removing the outer `types required` guard alone left the
  "create not called" assertion GREEN, because buildCreateBody's own `if (!firstType) return null`
  independently blocks submission. Real defence-in-depth, discovered by actually running the mutation.
Task 17: plan defect — the brief's literal CreateAlertRuleModal.test.tsx used fireEvent.change on
  components/ui/select.tsx, which is not a native <select>. Implementer rewrote the interactions per the
  interface notes. Same class of defect as Task 15's Select bug; the plan's test code had it too.
Task 17: minor (deferred): validate()'s threshold-bounds if/else chain has unbraced arms, a stray
  3-space-indented `else`, and a trailing-whitespace blank line. Cosmetic; passes eslint.
Task 17: minor (deferred): selectorChips keyed by raw string, so a tag named identically to a reading
  type would duplicate a React key. Vanishingly unlikely; `${category}-${chip}` would remove it.

Task 18: review -> Needs fixes. Spec ✅, 0 Critical, 1 Important:
  Nav badge is a bare <span>{count}</span> in both renderers, so a screen reader announces "Alerts 5".
  **Plan-mandated** — copied verbatim from my snippet. CONTROLLER RULING: routed into the fix loop
  without asking the human, because the plan never said NOT to label it. An omission is not a mandate —
  same reasoning as Task 4's finding (3). Plan updated (docs branch).
Task 18: also folded in one Minor, deliberately: TopNav.tsx:47-50's comment claimed usePusherAlerts
  "re-subscribes when the callback identity changes". pusher-context.tsx:158-181 depends only on [ctx],
  and the hook's own doc at :155-157 says the opposite. A wrong comment about a shared hook causes future
  bugs and the file was already open. Deferred the other Minor (badge JSX duplicated across desktop/mobile
  renderers) — the file duplicates ALL nav item markup, so extracting only the badge reduces consistency.
Task 18: rename verified complete by me — `grep -rn AlertsPanel --include=*.ts --include=*.tsx` returns
  nothing outside node_modules. That closes a Definition of Done item.
Task 18: reviewer independently confirmed four things rather than trusting the report — the severity sort
  really is $switch rank-based (route.ts:39-58), useOpenAlertCount really reads pagination.total
  (useAlerts.ts:50-68), SystemHealthWidget really uses the plain-div shell the implementer matched, and
  AlertToaster really invalidates the same queryKeys.alerts.all the new TopNav subscription does.
Task 18: the widget's empty vs error branches ARE genuinely distinct (ActiveAlertsWidget.tsx:57-61 vs
  :63-68, disjoint conditions) and each test asserts the OTHER state's text is absent — the exact failure
  mode the review prompt was primed for, actually guarded against.
Task 18: fix round 1/5 (2 addressed, 0 open — aria-label on BOTH nav renderers with toHaveAccessibleName
  assertions, memoization comment corrected; commit 558c966, test count unchanged because the assertions
  extended existing it-blocks)
Task 18: complete (commits c4964ae..558c966, review clean after 1 fix round)
Task 18: re-review run on HAIKU — 3 tool calls, 50k tokens, correct verdicts including checking that the
  test asserts the accessible NAME rather than the digit (aria-label REPLACES the accessible name, so a
  /5/ query would no longer match and would not prove the label exists). Confirms the ledger's earlier
  note: scoped re-reviews of small fix diffs are the right place for the cheap tier.
Task 18: local MongoDB started for Tasks 19-20 — `docker start infrasight-phase4-mongo`, rs.status().ok=1,
  27018->27017. .env.local MONGODB_URI confirmed pointing at it; SEED_SECRET present.

Task 19: review -> Needs fixes. Spec ✅, 0 Critical, 1 Important + 1 pre-existing promoted into scope:
  (1) **The Low battery seed can NEVER fire.** Rule is battery_level `lt` 20; the evaluator reads
      reading.context.battery_level (selector.ts:25) and BOTH generators hard-floor it at exactly 20
      (seed-v2.ts:299 randomInt(20,100); lib/simulation/readings.ts:262 clamp(...,20,100)). 20 < 20 is
      always false. Plan-mandated (my threshold), and it kills precisely the rule chosen to demonstrate
      that selector.types is optional. CONTROLLER RULING: routed into the fix loop without asking —
      the plan's own table says this rule exists to demo fleet-wide matching, so a threshold that
      prevents it contradicts the plan's stated intent rather than expressing it. Now `lt 25`.
  (2) **create-indexes-v2.ts crashes deterministically on a fresh DB.** Reviewer DISPROVED the
      implementer's "re-running clears it" framing: createCollectionIndexes()'s first
      `await collection.indexes()` (line 279) is outside the try/catch, so NamespaceNotFound on a
      never-created alerts_v2 exits 1; and the script imports no models, so nothing in it can
      auto-vivify the collection. The &&-chained DoD command therefore short-circuits and
      verify-indexes never runs — re-running fails identically forever. What actually rescued the
      implementer was running verify-indexes SEPARATELY (its model imports auto-create the collection).
      Pre-existing, but it blocks a literal Definition of Done line on the fresh-database scenario this
      phase targets, so promoted into scope with a NamespaceNotFound (code 26) guard.
Task 19: reviewer independently verified the mongod-log evidence — grepped the container's own logs and
  matched the implementer's cited createCollection timestamp AND connection id exactly. Good standard.
Task 19: IMPORTANT CONTEXT FOR TASK 20 — neither `pnpm seed` nor `scripts/v2/simulate.ts` triggers
  evaluation. Both insert via raw ReadingV2.insertMany, bypassing the API routes, which are the only
  place evaluateReadings is called (ingest, alerts/[id], cron/simulate). So alerts_v2 stays EMPTY after
  a seed. Alerts appear only after authenticated GET /api/v2/cron/simulate calls. Task 20's plan text
  already prescribes exactly that, so the DoD line is achievable — but the seed module's comments
  claiming "/alerts is populated on first load" were false and are being corrected.
Task 19: minor (deferred): verify-indexes.ts and create-indexes-v2.ts disagree on readings_v2's
  device_timestamp index — different NAME (device_timestamp vs metadata_device_timestamp) and different
  direction (timestamp:1 vs timestamp:-1), so it always reports missing. Unrelated to alerting; a
  working index exists. Told the implementer explicitly NOT to fix it.
Task 19: fix round 1/5 dispatched and returned (commits a6a072e..54234b4) — low-battery threshold 20->25
  with rationale comment, NamespaceNotFound (code 26) guard in create-indexes-v2.ts plus a subprocess
  regression test, and both "populated on first load" comment overclaims reworded.
Task 19: OPEN QUESTION under re-review — implementer reports proving the guard took THREE passes, because
  dropping only alerts_v2 still left create-indexes-v2 exiting 1, from a SEPARATE pre-existing auto-index
  naming collision on devices_v2/readings_v2/alert_rules_v2 that manifests when `pnpm seed` runs BEFORE
  create-indexes-v2 ever has. They report running create-indexes-v2 FIRST avoids it and gives a clean
  exit 0 with all 8 alert indexes. That matters because the plan's Step 5 prescribes exactly the failing
  order (seed first). Re-reviewer (sonnet, not haiku, for this reason) asked to diagnose the collision,
  verdict whether the DoD line passes in the DOCUMENTED order, and recommend fix-collision vs
  change-documented-order. Controller decides after.
Task 19: implementer also flagged devices_v2's `last_seen` index showing the same direction-mismatch
  category as the deferred readings_v2 one. Flagged only, not touched, per my explicit deferral.
Task 19: re-review round 1 — findings 1 (threshold) and 3 (comments) ADDRESSED; finding 2's named defect
  (unguarded .indexes()) ADDRESSED with a genuine regression test, but the DoD line still FAILS in the
  plan's documented seed-first order. Root cause diagnosed from source: models declare indexes via
  UNNAMED Schema.index({...}), so Mongoose autoIndex builds them under auto-generated names on first
  model init; create-indexes-v2 then requests the same key patterns under custom names and MongoDB
  rejects ("already exists with a different name") -> [FAIL] -> exit 1. lib/db.ts also leaves autoIndex
  at default, so this is NOT seed-specific — any dev-server start reproduces it. The implementer's
  Pass 3 "success" was an artifact: Pass 2 had already planted the custom-named indexes.
Task 19: HUMAN RULING — **fix the root cause**, not the documented order. Reordering docs only holds
  until someone starts the app first, which dbConnect() makes trivial. Fix round 2 dispatched:
  shape-match in createCollectionIndexes(), skip when an equivalent index exists under any name.
Task 19: CRITICAL CONSTRAINT carried into fix round 2 — "shape" must include partialFilterExpression and
  unique, NOT just the key pattern. A plain unique index on {rule_id, device_id} has the SAME key pattern
  as the correct dedup index but no partial filter, and permits exactly one alert per pair forever. The
  human's own remediation deliberately made create-indexes-v2 exit non-zero on that case. Key-only
  matching would silently re-open that Critical. Three buckets specified: full match -> SKIP;
  key matches but shape differs -> stay loud + non-zero; no match -> create.
Task 19: minor (deferred): the new subprocess test is the THIRD mutating alerts_v2 in Jest's single shared
  mongodb-memory-server with maxWorkers:'50%'. Latent cross-file race, not reproduced, extends an existing
  two-instance pattern. Told the implementer not to add a fourth and to report intermittency rather than
  re-running until green.
Task 19: fix round 2/5 (1 addressed, 0 open — shape-match scan in createCollectionIndexes(); commit
  42b4ff8, +2 regression tests). Re-review verdict: all findings addressed, no new Critical/Important.
Task 19: complete (commits 558c966..42b4ff8, review clean after 2 fix rounds)
Task 19: **THE MOST IMPORTANT FINDING OF THIS PHASE.** The re-reviewer independently reproduced MongoDB's
  actual createIndex conflict rules with a standalone script against a disposable memory-server:
    - same key + SAME options + different name  -> REJECTED (code 85, IndexOptionsConflict)
    - same key + DIFFERENT options + different name -> **ACCEPTED; both indexes coexist**
  So pre-fix, facing a leftover plain-unique {rule_id, device_id}, create-indexes-v2 would have printed
  "✅ [CREATE] ... success" and left the DANGEROUS index fully active alongside the correct one. The
  human's own remediation added a "loud mismatch, non-zero exit" guarantee for exactly this case — and
  that guarantee was NEVER REACHABLE via a driver error in the no-name-match scenario. Only the explicit
  pre-check added in this round can catch it. Verified by reproduction, not by reading docs.
Task 19: DoD proven in the previously-failing seed-first order — re-reviewer reproduced the whole
  sequence on its own memory-server rather than touching the container: seed exit 0 -> create-indexes-v2
  exit 0 (Created 15, Skipped 11, Mismatched 0, Failed 0) -> verify-indexes exit 0, AlertRuleV2 2/2 and
  AlertV2 6/6 present. Independent of the implementer's run.
Task 19: 8th and 9th vacuous tests of this phase, both SELF-CAUGHT by the implementer mid-round —
  [MISMATCH]/[FAIL] go to stderr, not stdout, so round 1's string assertions could never observe them;
  and importing AlertV2 made the shared Mongoose connection race-build indexes, breaking exact-name
  verification. Fixed by combining both streams and making assertions shape-based.
Task 19: minor (deferred): comments at create-indexes-v2.ts:271-272 and the CLI test:34 claim EVERY index
  in the file is also schema-declared. True for all 8 alert indexes, false file-wide — DeviceV2 has 4
  script indexes with no schema declaration and 1 direction-mismatched. Documentation precision only.
Task 19: minor (deferred): the shape scan short-circuits on first full match, so a DB holding BOTH a
  correct and a leftover wrong-shaped dedup index would report a clean [SKIP] and never flag the
  leftover. Only reachable via the pre-fix bug, and auditing extraneous indexes was never this script's
  job — noted for future awareness.
Task 19: minor (deferred): devices_v2 health.last_seen direction mismatch (schema ascending vs script
  descending) — same category as the deferred readings_v2 one; both coexist after a fresh run.

Task 20: review -> Needs fixes. Spec ✅ on all 7 surfaces, 0 Critical, 2 Important:
  (1) The `selector` TYPE CONTRACT is a lie, and it is what caused the /alerts/rules crash E2E found.
      types/v2/alert.types.ts:54 and models/v2/AlertRuleV2.ts:65 both declare `selector` REQUIRED, but
      every alert-rules route reads via .lean() and Mongoose's default `minimize` strips the field
      entirely for an empty selector. That is exactly why `tsc --noEmit` was clean before AND after the
      optional-chaining fix — the type asserted a guarantee the runtime does not provide. Routed into the
      fix loop: widen both to `selector?`. NOT `minimize: false` — default: () => ({}) is already there
      and still does not survive persistence (proven by seed-alert-rules.test.ts:81-89's own round trip);
      it would only affect future writes and callers would still need to handle absence.
  (2) Reviewer reported `pnpm test` RED at device-history.integration.test.ts:77
      (expected 'created', got 'updated'), twice. **I COULD NOT REPRODUCE: 4 full runs, 115/115 suites
      and 2597/2597 tests every time.** Genuine intermittent flake under heavy parallel load (the
      reviewer ran while several other subagents were active). PRE-EXISTING — nothing on this branch
      touches DeviceV2 or its history route, and the sibling test at line 80 already carries
      `await sleep(10)` with the comment "Wait a moment to ensure different timestamps", so the file
      already knows audit timestamps can collide and sort unstably. Told the implementer NOT to chase it
      or paper over it with sleeps. **CARRY TO THE FINAL WHOLE-BRANCH REVIEW.**
Task 20: E2E EARNED ITS KEEP — it caught a real production crash on /alerts/rules
  ("Cannot read properties of undefined (reading 'types')") that every unit test missed, because the unit
  tests' makeRule() always supplies a complete selector. Confirmed at every layer by the reviewer: seed
  data, schema default, the .lean() read path, and the required wire type. Also folded a Jest regression
  test into the fix round — without one, the only guard is E2E happening to meet an empty-selector rule.
Task 20: reviewer verified the promotion-never-observed disclosure and found it BENIGN for a stronger
  reason than the implementer gave — pending is excluded from VISIBLE_STATUSES
  (app/api/v2/alerts/route.ts:36-38), so a pending episode is structurally invisible to /alerts in every
  mode the suite exercises. It could never be the "first alert" the deep-link test clicks. And the
  pending->firing transition IS deterministically tested at evaluate.test.ts:207-221. Only the live,
  wall-clock RNG demo path failed to produce one.
Task 20: skip guards confirmed honest — zero test.skip() in e2e/alerts.spec.ts; the brief's two canned
  guards were replaced with hard assertions. 8/8 passed, 0 skipped, across 3 runs.
Task 20: minor (deferred): only Acknowledge is exercised for the useAdminAction gating; Resolve and
  New rule share the identical contract and are named in the DoD but are not visited by the E2E suite.
Task 20: minor (deferred): e2e/alerts.spec.ts:21-26 asserts only the static page <h1>, not any
  AlertList-rendered content — shallower than the rules-page test, which asserts real seeded content.
Task 20: fix round 1/5 (1 addressed, 0 open — selector widened to optional on BOTH AlertRuleV2Response
  and IAlertRuleV2, plus a Jest regression test for an entirely-absent selector; commits 5f5d17f..02684ef)
Task 20: complete (commits 42b4ff8..02684ef, review clean after 1 fix round)
Task 20: re-reviewer verified the "4 hydrated sites were always safe" claim AT THE MONGOOSE SOURCE LEVEL —
  Document.prototype.$__init (node_modules/mongoose/lib/document.js:724) unconditionally calls
  applyDefaults on hydration, and applyDefaults backfills any undefined path with its schema default when
  no projection is active. So a non-lean read really does backfill selector to {}. Not a hand-wave.
Task 20: re-reviewer also wrote a repo-external repro proving the new regression test fails pre-fix for
  the RIGHT reason — confirmed makeRule({selector: undefined}) yields undefined (not {}), that the
  pre-fix selectorChips throws the exact reported message on it, and that the sibling describeCondition
  call in the same row touches only metric/comparison/threshold, so it cannot confound the failure.
Task 20: minor (deferred): 3 assertions (AlertRuleV2.test.ts:39, seed-alert-rules.test.ts:104-105) now
  read `selector?.types` and would silently pass under a hypothetical selector-itself-absent regression
  that previously threw. Narrow — none of those tests' stated purpose is "prove selector survives"; they
  prove the types array's `default: undefined` override survives, which `?.` does not affect. Every
  production consumer already treats selector as optional. An explicit expect(rule.selector).toBeDefined()
  alongside them would close it if wanted.
Task 20: minor (deferred): commit 6a77a67's body has a typo ("direct property enerak"). Cosmetic, body
  only; implementer correctly declined to amend an existing commit without being asked.

=== ALL 20 TASKS COMPLETE. Proceeding to the final whole-branch review. ===

=== FINAL WHOLE-BRANCH REVIEW (opus) — 1 Critical, 6 Important, 4 Minor ===
Critical: demo-mode anonymous visitors were shown admin EMAIL ADDRESSES on /alerts/[id]. audit.*_by is
  written by getAuditUser (user?.email || userId); DEMO_MODE grants anonymous callers userId:'demo',
  orgRole:'org:member', so requireOrgMembership() passes and the full audit block is returned. I verified
  all three legs myself before acting. The Pusher path had been hardened against exactly this; the
  REST+render path had not.
=== FIX WAVE (one dispatch, per the skill) — commits 02684ef..1df1d70, 7 commits, +18 tests ===
Fix wave re-review verdict: ALL findings addressed, no new Critical/Important. Ready to merge: YES.
  Re-reviewer independently re-ran all four gates (tsc 0, lint 0, build clean, 2616/2616 / 115 suites)
  and ran the new tests rather than trusting the report.

RESIDUAL FAST-FOLLOWS — parked with rulings, NOT blocking (no second fix wave, per the skill):
 (1) evaluate.ts:525-527's comment claims "nothing else touches either field". FALSE for
     audit.resolved_at — sweep.ts:111 and AlertV2.resolve() (manual PATCH) both write it. fired_at IS
     exclusive (verified by grep), so the promotion side is exact; the resolve side is not. Consequence
     is a MISLABELED notification (broadcast says resolution:'auto' when the document says manual/stale/
     device_inactive), not data corruption — the document write is still protected by atomic per-document
     semantics and the partial unique index. Re-reviewer notes the residual is MORE plausible than the
     implementer framed it: ingest(evaluate) and cron(sweep) are genuinely concurrent paths, and an admin
     clicking Resolve as a fresh reading lands is ordinary. Low-cost tightening available and not taken:
     also match 'audit.resolution': 'auto' (verified set nowhere else). RULING: park — narrow, not
     exploitable, and the skill allows no second fix wave. Surface to the human.
 (2) alert-rules/[id] PATCH lacks the redactAuditForDemo wrapping its alerts/[id] sibling got. Inert
     today — requireAdmin() 403s a demo caller first. RULING: park, defence-in-depth only.
 (3) The handoff rewrite replaced the deferred-minors list wholesale rather than reconciling it, and
     silently dropped a STILL-LIVE entry: alerts/[id]:192-195's `if (note)` cannot clear a note with ''
     and bumps audit.updated_at twice. Pre-existing, outside the 11 findings. RULING: park, but it is a
     real loss of institutional tracking — must be re-recorded somewhere durable.
 (4) M4 has no regression test for the publishAlertEvents-rejects-but-PATCH-still-200 path. RULING: park.
