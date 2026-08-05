# Deferred minors and carried-forward items — Phase 4 alerting

Extracted from the SDD ledger. These were triaged as non-blocking during per-task reviews.
The final review should decide which, if any, must be fixed before merge.

Task 1: minor (deferred): dropped the explanatory comment above the `type Types` import (AlertRuleV2.ts:1) — signpost lost for why this differs from Task 7's value import.
Task 1: minor (deferred): pre('save') branch (AlertRuleV2.ts ~365) untested; only the findOneAndUpdate middleware path is exercised.
Task 1: minor (deferred): no negative test that an invalid selector.types value is rejected by the schema enum.
Task 2: minor (deferred): acknowledge() redundantly $sets is_open: true (AlertV2.ts:602) — defensive no-op, wants a clarifying comment.
Task 2: minor (deferred): AlertV2Schema has no pre('findOneAndUpdate') hook unlike ScheduleV2, so a future direct findOneAndUpdate bypassing the statics won't bump audit.updated_at. Plan-mandated shape.
Task 3: minor (deferred): selector tags rules hand-duplicated rather than sharing an un-defaulted helper with common.validation.ts tagsSchema (which carries .default([]) and so cannot be reused directly).
Task 3: minor (deferred): no test covers typesRequiredForValueMetric via the UPDATE path (reviewer traced it manually and confirmed correct); only the create path is asserted.
Task 3: minor (deferred): updateAlertRuleSchema atomic-group refine always anchors its error to path ['metric'] even when metric was absent from the payload.
Task 4: minor (deferred): clearAllCaches() docstring says "all application caches" but its Promise.all does not del(alertRulesKey()).
Task 4: minor (deferred): recordAlert describe block has a redundant beforeEach(resetMetrics) duplicating the outer block's.
Task 4: minor (deferred): the nested `alerts` MetricsStore group lacks a one-line JSDoc, unlike sibling groups cache/ingestion/database.
Task 5: minor (deferred): compare() uses `default: return false` rather than a never-exhaustiveness guard; a 5th AlertComparison would silently return false instead of failing at compile time.
Task 5: minor (deferred): matchesSelector's param is widened to `IAlertRuleSelector | undefined` vs the brief's signature; no test covers the undefined branch.
Task 6: minor (deferred): no test asserts ruleCount === rules.length for a non-empty set (only the 0 case).
Task 6: minor (deferred): redundant `as ReadingType` cast at rule-cache.ts:60 — READING_TYPES is already typed readonly ReadingType[].
Task 7: minor (deferred): recordAlert('fired'/'resolved') is incremented in the decision loop BEFORE bulkWrite, so it is not reconciled against failedIndices. Under a concurrent E11000 race both callers count a fire though only one document is created. Persisted state and Pusher notifications are correctly guarded; only counter precision is affected.
Task 7: minor (deferred): the readings/devices-empty early return skips recordAlertEvaluationDuration, while the pairs-empty branch records it. Inconsistent observability.
Task 7: minor (deferred): three "refresh observation only" updateOne blocks repeat the same filter/$set/$max skeleton; a small helper would DRY it.
Task 7: minor (deferred): `as number` / `as Date` / `as unknown as IAlertV2` casts are safe today only because they sit inside the `state.breaching` branch; nothing in the type system enforces that.
Task 7: >>> CARRY INTO TASK 8/9 <<< an updateOne that loses a race to the staleness sweep matches ZERO documents rather than erroring, so it is not filtered by failedIndices and would still broadcast. Consider whether notifications need reconciling against bulkWrite's per-op matchedCount/modifiedCount, not just writeErrors.
Task 8: minor (deferred): STALE_AFTER_SECONDS parseInt has no NaN guard; a malformed ALERT_STALE_AFTER_SECONDS silently disables the staleness check (device-inactive detection still works).
Task 8: minor (deferred): sweep.ts:45 re-wraps last_observed_at in new Date() though .lean<IAlertV2[]>() already returns a Date.
Task 9: complete (commits 9f606b3..d274bcf, review Approved — 0 Critical, 1 Important PLAN-MANDATED parked, 3 Minor)
Task 9: minor (deferred): CronDevice's `metadata: IDeviceMetadata` declares `department` required though the projection only returns `tags`; a future selector field would silently read undefined.
Task 9: minor (deferred): ingest passes `existingDevices as unknown as Parameters<typeof safeEvaluateReadings>[1]` — a double-unknown cast suppressing all structural checking. Brief-mandated.
Task 9: minor (deferred): no failure-injection integration test on the cron path (ingest has one).
Task 10: minor (deferred): `if (note)` discards an explicit note: '' , so a caller cannot clear an existing note. Consider `if (note !== undefined)`.
Task 10: minor (deferred): audit.updated_at is bumped twice when a note is supplied (once in the static, once by pre('save')).
Task 10: minor (deferred): PATCH 403/404 tests assert status only, not error.code.
Task 11: minor (deferred): PATCH sets 'audit.updated_at' explicitly though the pre('findOneAndUpdate') hook already does it unconditionally — dead code.
Task 11: minor (deferred): the atomic-group 400 test only exercises { threshold } alone; { metric } or { comparison } alone untested.
Task 12: minor (deferred): no assertion that `_severity_rank` is absent from the response, though `__v` is
Task 12: minor (deferred): useAlertDetail has only a disabled-without-id test, no happy path — plan-mandated
Task 12: minor (deferred): useAlertDetail's cache key ignores `options.include_device`, so two calls for the
Task 12: minor (deferred): severity aggregation sorts on a computed field with no supporting index and no
Task 12: minor (deferred): near-identical mutation/invalidation blocks across the four alert/rule mutations.
Task 13: minor (RESOLVED, not deferred) — re-review found the new nested catches are comment-only, so a
Task 14: minor (deferred): AlertToaster severity->toast-type map only exercises critical->error and
Task 14: minor (deferred): sweep.test.ts errorSpy asserted with toHaveBeenCalledWith but no
Task 15: minor (deferred): onError drops ScheduleList's `err instanceof Error` guard; a non-Error
Task 15: minor (deferred): useAlertFilterParams cannot distinguish "never set" from "explicitly reset to
Task 15: minor (deferred): formatRelativeTime's week/month/year branches are untested — unreachable in
Task 15: minor (deferred): useAdminAction() called twice rather than once and shared. Followed the plan's
Task 16: minor (deferred): AlertList.tsx:75 comment says formatRelativeTime is "Shared with
Task 16: minor (deferred): report's "Admin-gating state — four checks" header documents only two
Task 16: minor (deferred): loading spinners lack role="status"/aria-live. Pre-existing convention across
Task 16: DEFERRED FOR FINAL REVIEW — there are TWO same-named `ListReadingsQuery` types: the client wire
Task 17: minor (deferred): validate()'s threshold-bounds if/else chain has unbraced arms, a stray
Task 17: minor (deferred): selectorChips keyed by raw string, so a tag named identically to a reading
Task 19: minor (deferred): verify-indexes.ts and create-indexes-v2.ts disagree on readings_v2's
Task 19: minor (deferred): the new subprocess test is the THIRD mutating alerts_v2 in Jest's single shared
Task 19: minor (deferred): comments at create-indexes-v2.ts:271-272 and the CLI test:34 claim EVERY index
Task 19: minor (deferred): the shape scan short-circuits on first full match, so a DB holding BOTH a
Task 19: minor (deferred): devices_v2 health.last_seen direction mismatch (schema ascending vs script
      or paper over it with sleeps. **CARRY TO THE FINAL WHOLE-BRANCH REVIEW.**
Task 20: minor (deferred): only Acknowledge is exercised for the useAdminAction gating; Resolve and
Task 20: minor (deferred): e2e/alerts.spec.ts:21-26 asserts only the static page <h1>, not any
Task 20: minor (deferred): 3 assertions (AlertRuleV2.test.ts:39, seed-alert-rules.test.ts:104-105) now
Task 20: minor (deferred): commit 6a77a67's body has a typo ("direct property enerak"). Cosmetic, body
