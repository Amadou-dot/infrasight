# SDD ledger — plan: /tmp/claude-1000/-home-yzel-github-infrasight/f4a9f31c-9ee3-4454-8794-1236ae4db1db/scratchpad/pr116-fixes-plan.md

Branch: feat/phase-4-alerting
Worktree: /home/yzel/github/infrasight-phase4
Base at start: c5395ff
PR: https://github.com/Amadou-dot/infrasight/pull/116

Task 1: dispatched (base c5395ff, model sonnet) — sweep reconciliation + stale-resolve race + vacuous test replacement
Task 1: complete (commits c5395ff..ee92de9, review clean — spec ✅, quality approved)
  - Controller independently reproduced all 4 mutations; full node suite 2204/2204, 82 suites.
  - Note (deferred, not this plan): reviewer counted 54 pre-existing tsc errors; PHASE_4_HANDOFF.md claims 39. Worth reconciling separately.
  - Note (accepted design limit): sweep reconciliation keys on exact `audit.resolved_at === now`; a same-millisecond concurrent resolver would be miscounted. Inherent to the one-query design; documented.
Task 2: implemented (commits ee92de9..fd1966d, model opus) — evaluator write confirmation
  - Controller reproduced 4 mutations independently; full node suite 2210/2210, 82 suites.
Task 2: review — spec ✅, quality Approved w/ 1 Important + 3 Minor
Task 2: minor (deferred): COST comment conditions 2 of 4 clauses; recentlyResolved (maxCooldownSeconds>0) and bulkWrite (ops.length>0) are also conditional. Traces to the brief's prescribed wording.
Task 2: minor (deferred): EvaluationResult mixes driver-confirmed pendingCleared with candidate pendingOpened, undocumented at the type.
Task 2: minor (deferred): reconciliation keys on audit.updated_at (wider than sibling sweep.ts's audit.resolved_at), widening the same-millisecond false-confirm window.
Task 2: ruling — pendingOpened left as a candidate count. Reviewer independently judged this correctly scoped (brief item 2 scopes insert confirmation to notifications; fix needs index tracking, not a driver count). No consumer outside types.ts and tests. Accepted, not parked as a defect.
Task 2: fix round 1/5 dispatched — Important: recordAlert has no positive coverage (deleting both calls passes all 2210 tests; controller reproduced).
Task 2: fix round 1/5 (1 addressed, 0 open — recordAlert positive coverage; commits fd1966d..746112d, test-only)
Task 2: complete (commits ee92de9..746112d, review clean, 3 minors deferred)
  - Controller + re-reviewer both independently confirmed deleting either recordAlert call now fails a test.
Task 3: complete (commits 746112d..84eb30c, model sonnet, review clean — spec 5/5 ✅, quality approved, no defects)
  - Controller reproduced 5 mutations; reviewer independently reproduced 7. Full suite 2218/2218, 82 suites.
  - Implementer self-caught a vacuous test (its "log once per call" test was protected by ruleValidationCache, not the reportedSkips gate it named) and rewrote it. Controller's MUT A confirms the rewrite bites.
  - Resolved: Types.ObjectId.isValid() 12-char concern does NOT apply — bson@7.0.0 does not treat 12-char strings as raw bytes (reviewer tested empirically). No hole.
  - Note: the invalid-rule-id guard is load-bearing, not belt-and-braces — validateRule runs OUTSIDE the try/catch, so removing that guard reproduces the original whole-batch abort exactly.
Task 3: deferred (out of scope, pre-existing): a rule passing validateRule but with a malformed non-metric field (name, severity) can still raise a non-11000 bulk-write error at Step 7, which is rethrown and aborts the batch. Predates this task; governed by Step 7 logic left untouched. For final-review triage.
Task 4: complete (commits 84eb30c..d72bcbf, model sonnet, review clean — spec ✅, quality approved)
  - Controller reproduced 2 mutations (incl. >= vs > boundary); reviewer reproduced 3. Full suite 2221/2221.
  - Resolved: elapsedMs >= 0 holds unconditionally (lastObservedAt is a running max over ALL readings; breachedSince is one breaching reading's ts). So for_duration_seconds:0 provably reduces to the old behavior.
  - 4th brief scenario (duration:0 fires immediately) covered by pre-existing test at evaluate.test.ts:106-123, verified non-vacuous under the > mutation. Correctly not duplicated.
  - Test diff is pure addition (0 deletions) — no existing assertion rewritten to accommodate the behavior change.
Task 4: minor (deferred): test 1 doesn't explicitly assert pendingOpened === 0 (implied by mutual exclusivity, not a coverage gap).
Task 4: minor (deferred): boundary test doesn't assert breached_since, unlike its two siblings.
Task 4: watch: one flaky failure in __tests__/integration/api/device-history.integration.test.ts under parallel load; passed in isolation and on rerun. Pre-existing, outside alerting scope.
Task 5: implemented (commits d72bcbf..2879d08, model sonnet) — Sentry reporting + call-site fired/resolved logging
  - Controller reproduced 3 mutations; reviewer reproduced 4. Full suite 2224/2224, 82 suites.
Task 5: review — spec ✅, quality Approved w/ 1 Important + 2 Minor
Task 5: ruling — safeSweepStaleAlerts' return value stays discarded. Reviewer independently agreed with the implementer: brief item 2 says "both call sites" of the EVALUATOR (sweep has one caller), SweepResult has no .fired field, and sweep resolutions are ALREADY visible via recordAlert('resolved', {resolution}) in the metrics map. Missing piece is an enrichment log line only, not observability. Accepted, not a defect.
Task 5: minor (deferred): near-identical logging blocks at the two call sites; no shared route-logging helper exists in this codebase.
Task 5: minor (deferred, pre-existing): unguarded String(error) in lib/alerting/index.ts logger.error calls (~L61-66, ~L79-82) sits outside reportToSentry's guard. Not reachable today (all throw sites raise real Errors) but the "wrapper never throws" property is not hermetic.
Task 5: fix round 1/5 dispatched — Important: captureException's { tags } lands in `extra`, not as a Sentry tag facet. PLAN-MANDATED (my brief specified the call syntax); escalated to user, who chose to fix the wrapper. Alerting is the wrapper's only caller, so zero blast radius.
Task 5: fix round 1/5 (1 addressed, 0 open — Sentry tag now a first-class facet; commits 2879d08..b1516a6)
  - Re-review confirmed ADDRESSED both directions + isolation guarantee NOT regressed + backward compat (withSentryErrorHandling at sentry.ts:181 is another 2-arg caller, unaffected).
Task 5: fix round 2/5 dispatched — re-reviewer empirically DISPROVED the implementer's ESLint justification. Built probes showing jest.resetModules() + await import() gives a fresh module instance in this ts-jest config and lints clean. "require() is structurally required" is false; +4 no-require-imports is avoidable. Converting the 2 new tests.
Task 5: fix round 2/5 (1 addressed, 0 open — require() -> await import(); commits b1516a6..0a5c7aa)
  - ESLint back to exact baseline (34 no-require-imports / 41 file / 311 project-wide). Assertions byte-identical through the conversion. Module isolation verified by probe.
Task 5: complete (commits d72bcbf..0a5c7aa, review clean after 2 fix rounds, 2 minors deferred)
Task 6: complete (commits 0a5c7aa..2480e01, model sonnet, review clean — spec ✅, quality approved w/ 1 minor)
  - Controller reproduced 3 mutations incl. the surgical anomaly-only trap; reviewer independently ran the same surgical mutation and confirmed the anomaly assertion has isolated bite. Full suite 2228/2228.
  - Verified: dropping `?.` on quality is safe AND more correct (schema default + non-optional interface + generator always sets it; newReadings are pre-default, insertedReadings are post).
  - Verified: `rejected` field mirrors ingest route precedent; no consumer does whole-object equality, purely additive.
Task 6: minor (deferred): comment at route.ts:61-65 claims insertedReadings "is the only thing downstream steps may treat as having happened", but the Pusher trigger 6 lines below (route.ts:71) still sends the full newReadings. Comment overclaim is NEW content from this diff -> chargeable here. One-line fix (scope the claim to evaluation + response).
Task 6: NEW FINDING for final-review triage (product-level Important, out of plan scope): Pusher broadcasts unpersisted readings to every connected dashboard; they render then vanish on refresh. Same defect class as this task. Fix is low-risk (PusherReading consumes only metadata.device_id, metadata.type, timestamp, value — identical across both arrays) BUT changes payload from plain objects to hydrated Mongoose docs (_id, __v ride along). Not in the plan's Out-of-scope list; newly discovered.
Task 7: implemented (commits 2480e01..c662866, model sonnet) — index shape verification + first-ever test coverage for these scripts (18 tests, new suite)
  - Controller reproduced 3 mutations; reviewer reproduced the brief's own falsification + live-verified against a real mongod (incl. catastrophic-misconfig simulation, exit 1, no auto-drop).
  - Reviewer empirically confirmed MongoDB does NOT normalize bare-equality partialFilterExpression into $eq form on read-back — no false-mismatch risk.
Task 7: review — spec ✅ 5/5, quality Approved w/ 1 Minor
Task 7: UPHELD — implementer's pushback on the brief was correct: my specified `rule_device_resolved_at` test does NOT isolate the fix (passes even reverted, caught by the pre-existing unique check). Their adversarial companion test is what proves item 3.
Task 7: confirmed correct — 2 newly-visible sort-direction mismatches (DeviceV2 last_seen, ReadingV2 device_timestamp) are genuine pre-existing drift, surfaced not caused. verify-indexes is NOT in CI (manual pnpm script only), so no build impact.
Task 7: minor (deferred): verify-indexes per-index output doesn't distinguish "index absent" from "index present but wrong shape".
Task 7: fix round 1/5 dispatched — NEW HOLE found by reviewer during live testing, partially defeats this task's purpose: verify-indexes imports models -> Mongoose autoIndex (never disabled repo-wide) silently creates a correctly-shaped index under auto-name rule_id_1_device_id_1 -> name-agnostic checkIndexExists finds it -> FALSE GREEN while the broken rule_device_open_unique still breaks alerting. Controller confirmed all 3 facts. Escalated to user, who chose: connect with autoIndex:false (a verifier must not mutate what it verifies). Schema naming explicitly rejected this round (existing deployments carry a duplicate auto-named index; separate cleanup decision).
Task 7: fix round 1/5 (autoIndex:false added to verify-indexes; commits c662866..3545814) — SOURCE FIX CORRECT, TESTS DO NOT GUARD IT.
  - Controller ran the source mutation (revert to mongoose.connect(uri)): BOTH new tests still pass, incl. the one named "[the fix, verified]".
  - Cause: tests at verify-indexes-autoindex.integration.test.ts:96 and :133 build their OWN connections with hand-chosen options; nothing imports or executes verify-indexes.ts. They prove the mechanism (valuable, keeping them) but assert nothing about which option the script uses.
  - Implementer's report claimed "both mutation-verified in both directions" — false for the source mutation. Correction requested.
Task 7: fix round 2/5 dispatched — add a guard so deleting { autoIndex: false } from verify-indexes.ts fails a test. Implementer's choice of subprocess e2e or exporting the connect options; noted that a config assertion PAIRED with the existing mechanism tests closes the loop honestly (my round-1 "behavioral not config" instruction was right in isolation, wrong as applied here).
Task 7: fix round 2/5 (1 addressed, 0 open — real subprocess guard; commits 3545814..51eec73)
  - Controller: 3/3 fail on revert, 3/3 pass restored. Re-reviewer: 4/4 fail, 3/3 pass. Deterministic both directions.
  - Implementer chose subprocess e2e over the cheaper config assertion; report corrected honestly re: the false "mutation-verified" claim.
  - Note: the CLI test's stdout assertion is racy by design (connect resolves before autoIndex build finishes); the live index-name assertion is the deterministic guard.
Task 7: complete (commits 2480e01..51eec73, review clean after 2 fix rounds, 1 minor deferred)
FLAKINESS (resolved): 7+ clean full-suite runs. Both intermittent failures occurred in a shell invocation immediately after `git checkout` restores — correlates with the controller's mutate/restore harness racing Jest's file reads, NOT a property of the suite. Earlier framing as suite flakiness was likely wrong.
Task 8: complete (commits 51eec73..2acef16, model sonnet, review clean — spec ✅ 6/6, quality approved, 2 informational minors)
  - Controller: reverting all __v stripping fails 7 tests; tsc 39 and ESLint 311 both unchanged; suite 2256/2256.
  - Reviewer independently re-derived type/schema fidelity: 24 tsc + 20 live .safeParse() assertions cross-checked, zero discrepancies. Over-tightening scan with 12 valid fixtures: none wrongly rejected.
  - Implementer self-caught a real bug in its own first draft: a shared create/update union wrongly made `selector` optional on update for non-'value' metrics. createAlertRuleSchema has .default({}); updateAlertRuleSchema does not, and its atomic-group refine requires all four condition fields. Split into CreateAlertRuleCondition/UpdateAlertRuleCondition. Verified correct by controller AND reviewer independently.
  - All 7 response-producing call sites across 4 routes covered; correct mechanism per read style. DELETE's hand-built response never carried __v (correctly untouched).
Task 8: minor (deferred): UpdateAlertRuleBody still type-checks {} though the schema's "at least one field" refine rejects it at runtime. Encoding that in vanilla TS is disproportionate.
Task 8: minor (deferred, pre-existing): AlertRuleBodyBase.enabled?: boolean is narrower than the schema's boolean|string input union.
Task 9: complete (commits 2acef16..b2d1c39, model sonnet, review clean — spec ✅ 9a/9b/9c, quality approved, no issues)
  - Test-only diff (no source changes). Controller ran all 3 named mutations: 9a=2 fail, 9b=1 fail, 9c=2 fail. Suite 2263/2263.
  - Vacuity probe A (controller): matchesSelector forced to always-true -> 2 fail (the negative twins). They genuinely discriminate.
  - Vacuity probe B: requireAdmin substituted for requireOrgMembership -> member test 403, unauth still passes. Confirmed on BOTH routes (alerts by the first reviewer before it was cut off; alert-rules by the second).
  - 9b judgment call UPHELD: brief asked for 2 tests, 1 added. The evaluateReadings-throws half already existed at simulate-cron.integration.test.ts:718-727 on the CRON call site (not the ingest test) with a spy-called assertion.
  - NOTE (latent trap, not a defect): loadActiveRules has a 60s cache TTL and these tests create rules via AlertRuleV2.create(), bypassing route cache invalidation. Safe only because REDIS_URL is undefined in the Jest process (no dotenv loading under ts-jest). Would become flaky if Redis were ever wired into the test env.
  - First review agent terminated early on a session limit; controller completed the outstanding checks and re-dispatched a narrowed review rather than repeating work.
Task 10: complete (commits b2d1c39..fe875d7, model sonnet, review clean — spec ✅ 10a-10e, quality approved, 2 minors)
  - Test-only. Controller mutations: 10a cost-loop=1 fail, 10b rewind-guard=1 fail, 10c sweep recordAlert=1 fail, 10d drop dedup index=3 fail (was 1 before this task — the original review's exact complaint).
  - Found a gap NOT in the brief: the sweep's own recordAlert('resolved') was uncovered. Task 2's fix round covered only the evaluator's.
  - HONEST LIMITATION REPORTED: `rule_id instanceof Types.ObjectId` cannot fail at the evaluator write-site (Mongoose bulkWrite schema-casts). Reviewer verified and went further — there are TWO independent normalizing layers (validateRule's pre-parse AND Mongoose casting), so rule-cache.ts:24-32's comment overstates the risk more than reported.
  - 10e: sortBy=severity lexical ordering (warning > info > critical desc) surfaced and pinned by test, NOT fixed, per brief. Reviewer judged pinning correct: documentation-via-test, and a future fix must touch that assertion.
Task 10: minor (deferred): rule-cache.ts:24-32 comment overstates the string-rule_id risk; needs more than a one-line tweak.
Task 10: minor (deferred): task-10-report.md cites sweep.test.ts:327/:360, now :347/:380 (stale self-reference).

=== ALL 10 TASKS COMPLETE — 2272 tests (from 2173 at branch point), tsc 39, ESLint 311, all at baseline ===

=== FINAL WHOLE-BRANCH REVIEW (opus, c5395ff..fe875d7, 15 commits) — CLEAN, RECOMMENDS MERGE ===
  - Headline numbers independently verified: 2272/2272 tests across 85 suites; tsc 39; ESLint 311.
  - COMPOSITION SOUND: the 4 commits touching evaluate.ts and 2 touching sweep.ts compose correctly; no later task undermined an earlier one. The two files CONVERGED on one idiom; their single divergence (reconciliation key: audit.updated_at vs audit.resolved_at) is forced, not drift — the evaluator must confirm two op kinds in one query and a promotion never sets resolved_at.
  - No source change lacks a test (16 source files cross-referenced). No test weakened/deleted across all 15 commits — every removed line accounted for; the only removed test body is the vacuous race test the plan explicitly mandated replacing, and its replacement is strictly stronger.
  - 3 new cross-cutting findings, all Minor: (a) sweep.ts:72 cites evaluate.ts:345, now :449 (archetypal aggregate-only defect — no task-scoped reviewer could see it); (b) recordAlertRuleSkipped's doc at metrics.ts:212-218 overstates the boundary for the unexpected_error path; (c) evaluate's reconciliation has a false-NEGATIVE window sweep lacks (a concurrent silent-refresh overwriting audit.updated_at drops a real firing) — fails safe, under-reports, never false-pages.
  - Pusher unpersisted-readings finding DOWNGRADED to Minor: path is machine-generated (closed switch over 15 device types, no user input), so rejectedCount is normally 0; consequence is a briefly-stale tile that self-corrects. Fix cheaply but note the payload-size caution: use .toObject({versionKey:false}) rather than a bare swap.
  - Unnamed schema index DOWNGRADED to Minor: proven harmless in BOTH deployment orderings against a real mongod. Exactly one correctly-shaped index always ends up enforcing dedup.
CORRECTION (controller error): ledger line ~64 claimed existing deployments "carry a duplicate auto-named index". FALSE — MongoDB refuses a second index with the same key+options under a different name, so a duplicate cannot exist. Adding name:'rule_device_open_unique' to the schema is SAFE.
NEW, PREVIOUSLY UNRECORDED: Mongoose autoIndex aborts its batch on the first failure, so in a correctly-provisioned deployment autoIndex builds NONE of AlertV2's six indexes, ever. It is not a safety net. If any of the other five were dropped, nothing rebuilds them and nothing reports it. Argues for putting verify-indexes in CI more than for renaming the index.
TOP FOLLOW-UPS (none blocking): (1) malformed non-metric rule field still aborts the batch at Step 7 — same fleet-wide failure mode Task 3 closed, via a different door; (2) sortBy=severity lexical ordering must be fixed before any UI exposes the control; (3) add a comment about the 60s rule-cache TTL trap before anyone wires Redis into the test env.
