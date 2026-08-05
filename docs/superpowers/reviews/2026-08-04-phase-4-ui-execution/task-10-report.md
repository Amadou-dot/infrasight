# Task 10 Report: Alerts API

## What I implemented

Two new route files exposing `AlertV2` over HTTP, exactly as specified in the brief:

- `app/api/v2/alerts/route.ts` — `GET /api/v2/alerts`: paginated, filtered list of alerts. Defaults to open alerts (`firing` + `acknowledged`); intersects any client-supplied `status` filter with a `VISIBLE_STATUSES` allow-list (`firing`, `acknowledged`, `resolved`) so `pending` can never leak through, even via an explicit `?status=pending`. Filters: `status`, `severity`, `device_id`, `rule_id`, date range on `audit.created_at`. Sortable on 5 fields. Not cached (deliberate — the brief's rationale: the list changes on every ingest and is already pushed over Pusher). Read access via `requireOrgMembership()`.
- `app/api/v2/alerts/[id]/route.ts`:
  - `GET` — fetch a single alert by id (`alertIdParamSchema`), optional `include_device` join against `DeviceV2` (returns `device: null` if the device is gone, logs a warning). 404 `ALERT_NOT_FOUND` for unknown ids. Read access via `requireOrgMembership()`.
  - `PATCH` — the only mutation path for alerts; there is no `DELETE`. Body validated by `updateAlertSchema` (`status: 'acknowledged' | 'resolved'`, optional `note`). Dispatches to `AlertV2.acknowledge()` or `AlertV2.resolve(id, by, 'manual')`. Illegal transitions (`AlertTransitionError`) are mapped through a `TRANSITION_CODE_MAP` to 422 `ApiError`s — three codes only (`ALERT_ALREADY_ACKNOWLEDGED`, `ALERT_ALREADY_RESOLVED`, `INVALID_ALERT_STATUS_TRANSITION`), matching the model's `AlertTransitionCode` union. `null` return from the static (unknown id) maps to 404 `ALERT_NOT_FOUND`. A `note` is applied to `updated.audit.note` and persisted with `.save()` on the *document returned by the transition static* before serialization, so the response carries the note. `recordAlert('resolved', { resolution: 'manual' })` fires on a successful resolve. Write access via `requireAdmin()`. Exported as `withRateLimit(withRequestValidation(handleUpdateAlert, ValidationPresets.jsonApi))`, mirroring `app/api/v2/schedules/[id]/route.ts`.

Both files are the verbatim code given in the brief; I did not deviate from the specified implementation.

## What I tested and the results

`__tests__/integration/api/alerts.integration.test.ts` (verbatim from the brief) — 21 tests across three groups:
- `GET /api/v2/alerts` (8 tests): default-open filtering, explicit `status=pending` exclusion, `status=resolved` history retrieval, severity filter, device_id filter, pagination, 400 on invalid query, member read access.
- `GET /api/v2/alerts/[id]` (5 tests): single fetch, `include_device` join (present and gone-device cases), 404 unknown id, 400 malformed id.
- `PATCH /api/v2/alerts/[id]` (8 tests): acknowledge, resolve-with-note, 422×3 (already-acknowledged, already-resolved, pending/NOT_YET_FIRING), 403 member, 400 unsupported status, 404 unknown id.

All 21 pass. Full suite: 94 suites / 2336 tests passed (was 93/2315 at baseline — exactly +1 suite, +21 tests, no other changes).

## TDD Evidence

**RED** — `pnpm test __tests__/integration/api/alerts.integration.test.ts` before any route code existed:

```
FAIL node __tests__/integration/api/alerts.integration.test.ts
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/app/api/v2/alerts/route mapped as:
    /home/yzel/github/infrasight-phase4/$1.
    ...
      > 12 | import { GET as listAlerts } from '@/app/api/v2/alerts/route';

Test Suites: 1 failed, 1 total
Tests:       0 total
```

Failed for the expected reason: the route modules did not exist yet, not a logic error in the test itself.

**GREEN** — same command after writing `app/api/v2/alerts/route.ts` and `app/api/v2/alerts/[id]/route.ts`:

```
PASS node __tests__/integration/api/alerts.integration.test.ts
  Alerts API Integration Tests
    GET /api/v2/alerts
      ✓ should default to open alerts and exclude pending and resolved (76 ms)
      ✓ should never return pending even when explicitly requested (11 ms)
      ✓ should return history when status=resolved (9 ms)
      ✓ should filter by severity (11 ms)
      ✓ should filter by device_id (12 ms)
      ✓ should paginate (16 ms)
      ✓ should reject an invalid query parameter with 400 (4 ms)
      ✓ should allow a member to read (8 ms)
    GET /api/v2/alerts/[id]
      ✓ should return a single alert (8 ms)
      ✓ should include device details when requested (13 ms)
      ✓ should return null device when the device is gone (18 ms)
      ✓ should 404 for an unknown id (6 ms)
      ✓ should 400 for a malformed id (3 ms)
    PATCH /api/v2/alerts/[id]
      ✓ should acknowledge a firing alert (12 ms)
      ✓ should resolve a firing alert and record a manual resolution (10 ms)
      ✓ should return 422 ALERT_ALREADY_ACKNOWLEDGED (9 ms)
      ✓ should return 422 ALERT_ALREADY_RESOLVED (9 ms)
      ✓ should return 422 INVALID_ALERT_STATUS_TRANSITION for a pending alert (9 ms)
      ✓ should 403 for a member (5 ms)
      ✓ should 400 for an unsupported status (6 ms)
      ✓ should 404 for an unknown id (6 ms)

Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
```

## Files changed

- Created: `/home/yzel/github/infrasight-phase4/app/api/v2/alerts/route.ts`
- Created: `/home/yzel/github/infrasight-phase4/app/api/v2/alerts/[id]/route.ts`
- Created: `/home/yzel/github/infrasight-phase4/__tests__/integration/api/alerts.integration.test.ts`

`git status --porcelain` shows exactly these three new (untracked) paths — nothing else touched.

## Gate results

`./.superpowers/sdd/2026-08-01-alerting-subsystem/tscheck`:
```
OK: no new type errors (39 total, all pre-existing baseline).
```

`./.superpowers/sdd/2026-08-01-alerting-subsystem/lintcheck`:
```
OK: no new lint problems (311 total, all pre-existing baseline).
```

Also ran `npx eslint` directly on the three new files (`app/api/v2/alerts/route.ts`, `app/api/v2/alerts/[id]/route.ts`, the integration test) — zero output, i.e. zero problems, confirming the gate pass isn't hiding anything in the new files specifically.

`pnpm test` (full suite): `94 passed, 94 total` suites / `2336 passed, 2336 total` tests (baseline was 93/2315).

## Confirmation: `pending` cannot reach a client

- `GET /api/v2/alerts` (no query): `VISIBLE_STATUSES = ['firing','acknowledged','resolved']`, default `requested = OPEN_STATUSES = ['firing','acknowledged']`, filtered again through `VISIBLE_STATUSES` — pending is absent from both the default set and the allow-list, so it can never appear regardless of what a caller passes. Verified by test: `should default to open alerts and exclude pending and resolved` — 4 alerts seeded (firing, acknowledged, pending, resolved), only firing+acknowledged returned.
- `GET /api/v2/alerts?status=pending`: the query schema accepts `pending` as a syntactically valid `alertStatusSchema` value (so validation doesn't reject it), but the route's `statuses = requested.filter(s => VISIBLE_STATUSES.includes(s))` strips it before it ever reaches the Mongo filter — `requested = ['pending']` becomes `statuses = []`, so `filter.status = { $in: [] }`, matching nothing. Verified by test: `should never return pending even when explicitly requested` — seeds one pending alert, queries `status=pending`, asserts `body.data` has length 0.
- `GET /api/v2/alerts/[id]` and `PATCH /api/v2/alerts/[id]` do not status-filter on lookup (they fetch by id directly, as does the schedules precedent). This is safe because a pending alert's id is never exposed by any API surface — the list endpoint is the only enumeration path and it excludes `pending` unconditionally, so no client can ever learn a pending alert's id to fetch or PATCH it directly. `PATCH` additionally treats a pending alert as `NOT_YET_FIRING` and returns 422 `INVALID_ALERT_STATUS_TRANSITION` rather than performing a transition — verified by test `should return 422 INVALID_ALERT_STATUS_TRANSITION for a pending alert`.

## Self-review findings

- Compared the implementation to the brief line-by-line; matches verbatim (both route files, the test file).
- Naming: `VISIBLE_STATUSES`, `OPEN_STATUSES`, `SORT_FIELD_MAP`, `TRANSITION_CODE_MAP`, `rethrowAsApiError`, `handleUpdateAlert` all mirror the naming conventions and structure of `app/api/v2/schedules/route.ts` and `app/api/v2/schedules/[id]/route.ts`.
- YAGNI: no `DELETE` export exists on either route file (confirmed no `DELETE` symbol present) — consistent with "an alert is resolved, never cancelled and never removed." No action sub-routes were added.
- `curly: ['error','multi']`: ran eslint directly on the new files with zero output, confirming no single-statement braces were introduced (e.g. the `if (!validationResult.success) throw ...` and `if (note) { updated.audit.note = note; await updated.save(); }` — the latter has two statements so braces are correct there).
- Negative-test check (403/422/404 per the "beware vacuous tests" lesson):
  - Both 404 tests (GET and PATCH... GET's asserts `body.error.code === 'ALERT_NOT_FOUND'`; PATCH's 404 test only asserts status, not code — but it exercises the real `AlertV2.acknowledge()` returning `null` for an unknown ObjectId, which is a genuine "not found" path with no other way to produce a 404 here, so the status check alone is unambiguous.
  - All three 422 tests assert on `body.error.code` (`ALERT_ALREADY_ACKNOWLEDGED`, `ALERT_ALREADY_RESOLVED`, `INVALID_ALERT_STATUS_TRANSITION`) — verified these are produced by real `AlertTransitionError` codes thrown by the actual `AlertV2.acknowledge`/`resolve` statics (read `models/v2/AlertV2.ts` to confirm the exact code each scenario throws), not just asserted against a mock.
  - The 403 test only checks `response.status === 403`, not an error code. I traced this to `lib/auth/index.ts`: `requireAdmin()` calls `getAuthContext()` (which itself validates org membership/role from the *mocked* Clerk `auth()`) and then throws `ApiError.forbidden(...)` only if `orgRole !== 'org:admin'`. With `mockAuthAsMember()` set, this is a real role check against a real mocked session (not a short-circuited stub), so the test fails for the stated reason even without a code assertion. This exactly matches the precedent in the schedules integration tests, which use the same pattern.
- No caching was added to the list endpoint, per the brief's explicit instruction.
- I did not modify any baseline files, the model, the validation schemas, or errorCodes.ts — all interfaces from Tasks 2–4 were consumed as-is.

## Concerns

None. Implementation, tests, and both gates are clean; nothing outside the brief's scope was touched.

---

## Fix Report: date-range filter targeted the wrong timestamp

### Finding (from review)

`app/api/v2/alerts/route.ts` filtered the `startDate`/`endDate` query on `audit.created_at`, which is stamped when the invisible `pending` episode is first created (`lib/alerting/evaluate.ts:258-263`). The visible domain event a client actually means by "which alerts fired in this window" is `fired_at`, set at insert time for an immediate fire (`for_duration_seconds: 0`) or later, when the duration elapses. With a non-zero `for_duration_seconds` the two timestamps diverge by the whole duration, so the date-range filter silently returned the wrong alerts (excluding ones that fired inside the window, including ones that merely started breaching inside the window). This also diverged from the codebase's own convention — `readings` filters on `timestamp`, `schedules` on `scheduled_date` — both domain events, never an audit field. No test exercised the date range at all, which is why it shipped.

### What I changed

`app/api/v2/alerts/route.ts` — the date-range block now sets `filter.fired_at` instead of `filter['audit.created_at']`, with a comment explaining why (matches the reviewer's suggested fix verbatim). The `created_at` **sort** option (`SORT_FIELD_MAP.created_at -> 'audit.created_at'`) was left untouched — the review only flagged the filter, and `created_at` remains a legitimate, separately-named sort key.

### Covering tests — how they distinguish `fired_at` from `audit.created_at`

Added a `describe('date range filtering (fired_at, not audit.created_at)', ...)` block to `__tests__/integration/api/alerts.integration.test.ts`, with three tests. Each test seeds two firing alerts whose `fired_at` and `audit.created_at` are **swapped relative to the query window**, so the two candidate filters (`fired_at` vs `audit.created_at`) select two entirely different, mutually exclusive alerts — not overlapping sets, not the same alert with a different count. That makes each assertion fail under the old field and pass only under the new one; a test that happened to pass under both fields would not prove anything, which is why the swap was necessary:

1. **Range test** (`startDate` + `endDate`, window `[t2, t3]`):
   - `device_fired_in_window`: `fired_at = t2` (in range), `audit.created_at = t1` (out of range)
   - `device_created_in_window`: `fired_at = t1` (out of range), `audit.created_at = t2` (in range)
   - Asserts exactly 1 result with `device_id === 'device_fired_in_window'`. Under the buggy `audit.created_at` filter this assertion fails because the route would instead return `device_created_in_window` — confirmed in the RED run below.

2. **`startDate`-only test** (cutoff `t3`, no `endDate` — exercises the `$gte`-only branch):
   - `device_fired_after_cutoff`: `fired_at = t4` (>= cutoff), `audit.created_at = t1` (< cutoff)
   - `device_created_after_cutoff`: `fired_at = t1` (< cutoff), `audit.created_at = t4` (>= cutoff)
   - Asserts exactly 1 result with `device_id === 'device_fired_after_cutoff'`.

3. **`endDate`-only test** (cutoff `t2`, no `startDate` — exercises the `$lte`-only branch):
   - `device_fired_before_cutoff`: `fired_at = t1` (<= cutoff), `audit.created_at = t4` (> cutoff)
   - `device_created_before_cutoff`: `fired_at = t4` (> cutoff), `audit.created_at = t1` (<= cutoff)
   - Asserts exactly 1 result with `device_id === 'device_fired_before_cutoff'`.

All three use `createAlertInput` with an explicit top-level `fired_at` override and a full `audit` override object (`{ created_at, created_by: 'system', updated_at: created_at, updated_by: 'system' }`, since the factory's `...overrides` spread replaces `audit` wholesale rather than merging it).

### RED — new tests against the unfixed route

Command: `pnpm test __tests__/integration/api/alerts.integration.test.ts -t "fired_at"`

```
date range filtering (fired_at, not audit.created_at)
  ✕ should return the alert whose fired_at falls in the window, not the one whose audit.created_at does (77 ms)
  ✕ should filter by fired_at with startDate only (16 ms)
  ✕ should filter by fired_at with endDate only (12 ms)

  ● ... should return the alert whose fired_at falls in the window, not the one whose audit.created_at does

    expect(received).toBe(expected) // Object.is equality

    Expected: "device_fired_in_window"
    Received: "device_created_in_window"

  ● ... should filter by fired_at with startDate only

    Expected: "device_fired_after_cutoff"
    Received: "device_created_after_cutoff"

  ● ... should filter by fired_at with endDate only

    Expected: "device_fired_before_cutoff"
    Received: "device_created_before_cutoff"

Test Suites: 1 failed, 1 total
Tests:       3 failed, 21 skipped, 24 total
```

Failed for the stated reason exactly: the route returned the alert selected by `audit.created_at`, the opposite of the one the test (and the fix) require — not an unrelated error, not a config/import failure.

### GREEN — same tests after the fix

Command: `pnpm test __tests__/integration/api/alerts.integration.test.ts`

```
PASS node __tests__/integration/api/alerts.integration.test.ts
  Alerts API Integration Tests
    GET /api/v2/alerts
      ✓ should default to open alerts and exclude pending and resolved (78 ms)
      ✓ should never return pending even when explicitly requested (12 ms)
      ✓ should return history when status=resolved (10 ms)
      ✓ should filter by severity (10 ms)
      ✓ should filter by device_id (12 ms)
      ✓ should paginate (16 ms)
      ✓ should reject an invalid query parameter with 400 (4 ms)
      ✓ should allow a member to read (8 ms)
      date range filtering (fired_at, not audit.created_at)
        ✓ should return the alert whose fired_at falls in the window, not the one whose audit.created_at does (10 ms)
        ✓ should filter by fired_at with startDate only (11 ms)
        ✓ should filter by fired_at with endDate only (11 ms)
    GET /api/v2/alerts/[id]
      ✓ should return a single alert (7 ms)
      ✓ should include device details when requested (12 ms)
      ✓ should return null device when the device is gone (18 ms)
      ✓ should 404 for an unknown id (4 ms)
      ✓ should 400 for a malformed id (4 ms)
    PATCH /api/v2/alerts/[id]
      ✓ should acknowledge a firing alert (12 ms)
      ✓ should resolve a firing alert and record a manual resolution (10 ms)
      ✓ should return 422 ALERT_ALREADY_ACKNOWLEDGED (9 ms)
      ✓ should return 422 ALERT_ALREADY_RESOLVED (9 ms)
      ✓ should return 422 INVALID_ALERT_STATUS_TRANSITION for a pending alert (9 ms)
      ✓ should 403 for a member (6 ms)
      ✓ should 400 for an unsupported status (5 ms)
      ✓ should 404 for an unknown id (7 ms)

Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```

### Full suite and gates after the fix

`pnpm test` (full suite): `94 passed, 94 total` suites / `2339 passed, 2339 total` tests (was 2336 before this fix; +3 for the new date-range tests).

`./.superpowers/sdd/2026-08-01-alerting-subsystem/tscheck`:
```
OK: no new type errors (39 total, all pre-existing baseline).
```

`./.superpowers/sdd/2026-08-01-alerting-subsystem/lintcheck`:
```
OK: no new lint problems (311 total, all pre-existing baseline).
```

Also re-ran `npx eslint` directly on the two touched files (`app/api/v2/alerts/route.ts`, the integration test) — zero output.

### Files changed (this fix)

- Modified: `/home/yzel/github/infrasight-phase4/app/api/v2/alerts/route.ts` (date-range filter field: `audit.created_at` -> `fired_at`)
- Modified: `/home/yzel/github/infrasight-phase4/__tests__/integration/api/alerts.integration.test.ts` (added the 3-test `describe` block above)

### Concerns

None. The fix is a one-line field change plus a comment; the three new tests are constructed so that reverting the fix makes them fail again for the same reason they failed originally (confirmed via the RED run above, captured before the fix was applied).
