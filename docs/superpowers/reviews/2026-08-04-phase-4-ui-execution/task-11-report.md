# Task 11 Report: Alert rules API

## What I implemented

- `app/api/v2/alert-rules/route.ts` — `GET` (list, paginated, excludes soft-deleted, filters on `enabled`/`metric`/`severity`, sortable) and `POST` (admin-only, Zod-validated, audit-stamped, rate-limited, cache-invalidated).
- `app/api/v2/alert-rules/[id]/route.ts` — `GET` (single rule, 404s on soft-deleted or unknown id), `PATCH` (admin-only, atomic condition-group validation surfaced from `updateAlertRuleSchema`, cache-invalidated), `DELETE` (admin-only, calls `AlertRuleV2.softDelete`, cache-invalidated).
- `__tests__/integration/api/alert-rules.integration.test.ts` — 23 tests (brief specified 16; I added 7: three cache-invalidation-spy assertions for POST/PATCH/DELETE, a list-after-delete exclusion check, a PATCH-on-soft-deleted-rule 404 check, and two side-effect checks on 403 responses).

Both route files are verbatim from the brief's Step 3/Step 4 code blocks — same imports, same helper wrappers (`withErrorHandler`, `withRateLimit`, `withRequestValidation`), same shape as the Task 10 alerts routes. No deviation from the brief's design.

## A real defect found and fixed (one line, outside the brief's file list)

The brief's route code, copied verbatim, failed `tscheck` with three new errors in `app/api/v2/alert-rules/route.ts`:

```
error TS2769: No overload matches this call.                 (AlertRuleV2.create({...}))
error TS2339: Property '_id' does not exist on type 'never'.
error TS2339: Property 'toObject' does not exist on type 'never'.
```

Root cause, confirmed with a scratch type probe: in `lib/validations/v2/alert-rule.validation.ts` (Task 3),

```ts
export const readingTypeSchema = z.enum(READING_TYPES as unknown as [string, ...string[]]);
```

casts to a plain `[string, ...string[]]` tuple, which erases the literal union and makes `z.infer` produce `selector.types?: string[]`. The Mongoose model (`IAlertRuleSelector.types?: ReadingType[]`, in `models/v2/AlertRuleV2.ts`) expects the literal union. Every other enum in that file (`alertMetricSchema`, `alertComparisonSchema`, `alertSeveritySchema`) is declared with a literal array directly, so only `readingTypeSchema` had this cast-induced widening — nothing before Task 11 spread this schema's inferred type directly into a strictly-typed `.create()` call, so nothing had surfaced it yet.

Fix (one line, no behavior change — the runtime enum values are identical, only the TS type improves from `string` to the literal `ReadingType` union already used everywhere else in this file):

```ts
export const readingTypeSchema = z.enum(
  READING_TYPES as unknown as [(typeof READING_TYPES)[number], ...(typeof READING_TYPES)[number][]]
);
```

This matches the pattern of prior commits on this branch that corrected real defects surfaced by later tasks in earlier tasks' code (e.g. "fix two real defects in the plan's Task 1/2 model code"). I did not touch anything else in that file, and did not touch either baseline gate file.

## TDD Evidence

**RED** — `pnpm test __tests__/integration/api/alert-rules.integration.test.ts` (test file written, routes not yet created):

```
FAIL node __tests__/integration/api/alert-rules.integration.test.ts
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/app/api/v2/alert-rules/route mapped as:
    /home/yzel/github/infrasight-phase4/$1.
    ...
      > 12 | import { GET as listRules, POST } from '@/app/api/v2/alert-rules/route';
```

Failed for the expected reason: the route modules did not exist yet. Zero tests ran (suite-level failure, not an assertion failure), confirming this is a true "not implemented" RED, not a false negative.

**GREEN** — after writing both route files and the one-line validation fix, same command:

```
PASS node __tests__/integration/api/alert-rules.integration.test.ts
  Alert Rules API Integration Tests
    GET /api/v2/alert-rules
      ✓ should list rules and exclude soft-deleted ones (54 ms)
      ✓ should filter by enabled (12 ms)
      ✓ should allow a member to read (6 ms)
    POST /api/v2/alert-rules
      ✓ should create a rule with audit and defaults (21 ms)
      ✓ should invalidate the alert rules cache on create (5 ms)
      ✓ should 400 when metric is 'value' and selector.types is missing (6 ms)
      ✓ should 400 when the threshold is outside the metric bounds (4 ms)
      ✓ should 403 for a member (4 ms)
    GET /api/v2/alert-rules/[id]
      ✓ should return a single rule (7 ms)
      ✓ should 404 for a soft-deleted rule (10 ms)
      ✓ should 404 for an unknown id (7 ms)
    PATCH /api/v2/alert-rules/[id]
      ✓ should toggle enabled (11 ms)
      ✓ should update the full condition group (8 ms)
      ✓ should invalidate the alert rules cache on update (7 ms)
      ✓ should 400 on a partial condition update (5 ms)
      ✓ should 400 on an empty body (4 ms)
      ✓ should 404 for a soft-deleted rule (7 ms)
      ✓ should 403 for a member (6 ms)
    DELETE /api/v2/alert-rules/[id]
      ✓ should soft delete, preserving the document (7 ms)
      ✓ should exclude the deleted rule from a subsequent list (11 ms)
      ✓ should invalidate the alert rules cache on delete (6 ms)
      ✓ should 404 when already deleted (6 ms)
      ✓ should 403 for a member (5 ms)

Test Suites: 1 passed, 1 total
Tests:       23 passed, 23 total
```

## Full test run

`pnpm test`:

```
Test Suites: 95 passed, 95 total
Tests:       2362 passed, 2362 total
```

Baseline was 94 suites / 2339 tests. Delta is exactly +1 suite / +23 tests — the new file, nothing else moved. No regressions.

`pnpm test __tests__/integration/api` (all 21 integration suites, run in isolation to double check no cross-suite interference):

```
Test Suites: 21 passed, 21 total
Tests:       530 passed, 530 total
```

## Gate results

`./.superpowers/sdd/2026-08-01-alerting-subsystem/tscheck` (checked actual exit code directly, not through a pipe to `tail` — an early run of mine piped through `tail` and silently reported exit 0 from `tail` while the real script had exited 1; caught and corrected before relying on it):

```
OK: no new type errors (39 total, all pre-existing baseline).
```
Exit code: 0.

`./.superpowers/sdd/2026-08-01-alerting-subsystem/lintcheck`:

```
OK: no new lint problems (311 total, all pre-existing baseline).
```
Exit code: 0.

## Cache invalidation — confirmed on all three mutations

All three of POST, PATCH, DELETE call `await invalidateAlertRules()` (see the three route handlers). Proof, not just code inspection: the test file spies on the real `invalidateAlertRules` binding —

```ts
import * as cache from '@/lib/cache';
...
jest.spyOn(cache, 'invalidateAlertRules');
```

— and three dedicated tests assert `expect(cache.invalidateAlertRules).toHaveBeenCalledTimes(1)` after POST, after PATCH, and after DELETE respectively. `jest.spyOn` here calls through to the real implementation (it isn't stubbed), so these assertions prove the route code actually invokes the cache-invalidation path exactly once per mutation, not merely that the import exists. All three passed.

I checked for the "spied on a re-export binding that never intercepted the real call" failure mode called out in the task instructions before trusting this: `lib/cache/index.ts` re-exports `invalidateAlertRules` from `./invalidation` via `export { ... } from './invalidation'`, which TypeScript can compile as a non-configurable getter in some configurations — a shape where `jest.spyOn` on the barrel can throw or silently no-op. I verified empirically (not just by assumption) that the spy call succeeded and the assertions correctly failed when I temporarily removed a `invalidateAlertRules()` call during development, then correctly passed once restored — the call-count assertions are load-bearing, not decorative.

## Soft-delete confirmed: 404 on GET, absent from list

- `GET /api/v2/alert-rules/[id]` after `AlertRuleV2.softDelete(...)`: test `should 404 for a soft-deleted rule` asserts `response.status === 404` AND `body.error.code === 'ALERT_RULE_NOT_FOUND'` (not just the status — this is deliberate, per the task's warning that a 403 dressed as a 400 looks identical if you only check status). Passed.
- `GET /api/v2/alert-rules` (list) after a `DELETE`: test `should exclude the deleted rule from a subsequent list` creates two rules, deletes one via the route (not the model directly), then lists and asserts exactly one result remains and it's the right one. Passed.
- The document itself survives: `should soft delete, preserving the document` reads the row back with `AlertRuleV2.findById` after the DELETE route call and asserts it's non-null with `audit.deleted_at` set — proving DELETE is soft, not a Mongo document removal.

## Files changed

- `app/api/v2/alert-rules/route.ts` (new)
- `app/api/v2/alert-rules/[id]/route.ts` (new)
- `__tests__/integration/api/alert-rules.integration.test.ts` (new)
- `lib/validations/v2/alert-rule.validation.ts` (one-line fix, see above)

## Self-review

- **Completeness against brief**: both routes match the brief's specified interfaces exactly (`GET`/`POST` on the collection, `GET`/`PATCH`/`DELETE` on `[id]`), same response shapes (`jsonPaginated`, `jsonSuccess` with the specified payloads and status codes).
- **Naming**: matches brief and Task 10 precedent (`SORT_FIELD_MAP`, `assertValidId`, `handleCreateAlertRule`, etc.).
- **YAGNI**: added nothing beyond what the brief's routes need. Test file additions (7 extra tests) are all direct responses to the assigning agent's explicit instructions (assert cache invalidation really happens; make negative tests fail for their stated reason) rather than speculative extras.
- **Every negative test fails for its stated reason**: all 400s assert `error.code === 'VALIDATION_ERROR'`; all 404s assert `error.code === 'ALERT_RULE_NOT_FOUND'`; all 403s additionally assert no mutation occurred (record count unchanged / `enabled` unchanged / `deleted_at` unset), so a 403 can't be masking a different failure that happened to also return 403.
- **Test output**: clean run, only expected structured-logger `console.log`/`console.warn` lines (consistent with how every other integration suite in this repo behaves — not something I introduced).
- **Endpoint count**: verified directly rather than assumed. Baseline was 25 (per CLAUDE.md). Task 10 added 3 handlers (`GET /api/v2/alerts`, `GET /api/v2/alerts/[id]`, `PATCH /api/v2/alerts/[id]`), bringing the total to 28. Task 11 adds 5 handlers (`GET`/`POST` on the collection, `GET`/`PATCH`/`DELETE` on `[id]`), bringing the total to 33 — matching the brief's Step 6 claim exactly.

## Concerns

- I made a one-line fix to a Task 3 file (`lib/validations/v2/alert-rule.validation.ts`) that was outside this task's stated file list, because the brief's literal route code did not compile without it. The change is type-level only (no runtime behavior change — the enum's runtime values are unchanged, only its inferred TypeScript type improves from `string` to the literal `ReadingType` union, matching how the file's other three enums are already typed), and I verified the entire test suite plus the tscheck baseline is unaffected other than curing the three new errors. Flagging for visibility since it technically touches a previous task's file, though it's the kind of course-correction this branch's history already establishes as normal (see prior commits: "fix two real defects in the plan's Task 1/2 model code", "fix AlertInput.rule_id typing and test count in plan Task 2").
