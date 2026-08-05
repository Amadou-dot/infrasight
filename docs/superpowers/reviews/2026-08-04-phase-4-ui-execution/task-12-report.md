# Task 12 Report: API client, React Query hooks, and a correct severity sort

Branch: `feat/phase-4-alerting`
Worktree: `/home/yzel/github/infrasight-phase4`

Status: **DONE**

## Summary

Implemented all 9 steps from `task-12-brief.md` in order: fixed the
lexical-severity-sort defect in `GET /api/v2/alerts` (Step 0), added
`alertsApi`/`alertRulesApi` to the v2 client (Steps 1–5), and added the
corresponding React Query hooks (Steps 6–8). Committed as two conventional
commits (Step 9). All four gates are green on the final committed state:
`tsc --noEmit` 0 errors, `pnpm lint` 0 problems, `pnpm build` clean (once a
pre-existing, unrelated env gap is accounted for — see "Build gate" below),
`pnpm test` 2454/2454 passing (101 suites), up from the 2433/98 entry
baseline.

## Step-by-step

### Step 0 — Make `sortBy=severity` order by urgency

`app/api/v2/alerts/route.ts`: added a `SEVERITY_RANK` `$switch` expression
(critical→3, warning→2, info→1 default) and branched the query — only when
`query.sortBy === 'severity'` — to `AlertV2.aggregate([$match, $addFields,
$sort by rank with fired_at tiebreak, $skip, $limit, $project away __v and
the rank])`. Every other `sortBy` value keeps the original
`.find().select().sort().skip().limit().lean()` path untouched. Copied
verbatim from the brief's code block.

`__tests__/integration/api/alerts.integration.test.ts`: replaced the single
test that pinned the old lexical order and documented it as "not a bug to fix
here" with two tests that pin the fixed behavior:
- `should sort by severity rank descending, most severe first` — expects
  `['device_crit', 'device_warn', 'device_info']`
- `should sort by severity rank ascending, least severe first` — expects
  `['device_info', 'device_warn', 'device_crit']`

Both reuse a `seedThreeSeverities()` helper (factored out of the original
test body) that keeps the brief's three load-bearing, strictly increasing
`audit.created_at` timestamps (`t1 < t2 < t3` across
warning/critical/info), so neither a `created_at` asc nor desc fallback can
coincidentally satisfy either assertion. The comment above the helper spells
out all three orderings (fix vs. the two fallbacks) per the brief's table.

I also added one supplementary assertion beyond the brief's literal text, to
close the loop on the brief's own ambiguity note ("aggregate() returns plain
objects just like .lean()... Verify `_id` still serializes the same way in
the integration test"): the descending test additionally asserts
`typeof body.data[0]._id === 'string'`, that it matches `/^[a-f0-9]{24}$/`,
and that `__v` is absent — proving the new `AlertV2.aggregate()` branch
serializes identically to the `.lean()` branch used everywhere else. I
verified this assertion is load-bearing (see TDD evidence below).

### Steps 1–5 — Query keys and the v2 client

- `lib/query/queryClient.ts`: added `queryKeys.alerts` (`all`/`list`/`detail`)
  and `queryKeys.alertRules` (`all`/`list`/`detail`), verbatim from the brief.
- `__tests__/unit/lib/v2-client-alerts.test.ts`: created verbatim from the
  brief (Step 2).
- `lib/api/v2-client.ts`: added the six alert types to the existing
  `@/types/v2` import block, then added `alertsApi` (`list`, `getById`,
  `acknowledge`, `resolve`) and `alertRulesApi` (`list`, `getById`, `create`,
  `update`, `delete`) verbatim from the brief, and registered both on the
  exported `v2Api` object (`alerts: alertsApi`, `alertRules: alertRulesApi`).

### Steps 6–8 — Hooks

- `__tests__/unit/lib/useAlerts.test.tsx`: created verbatim from the brief,
  including the `useOpenAlertCount` block. `.tsx` extension confirmed
  load-bearing per `jest.config.js` (node project matches `*.test.ts`, jsdom
  matches `*.test.tsx`).
- `lib/query/hooks/useAlerts.ts`: created verbatim from the brief —
  `useAlertsList`, `useAlertDetail`, `useOpenAlertCount`,
  `useAcknowledgeAlert`, `useResolveAlert`.
- `lib/query/hooks/useAlertRules.ts`: created following the brief's
  description (not given as a literal code block) and modeled on
  `useSchedules.ts`'s shape — `useAlertRulesList(filters, config)`,
  `useAlertRuleDetail(id, config)` (no `options` param — matches
  `alertRulesApi.getById(id)`, which takes none), `useCreateAlertRule()`,
  `useUpdateAlertRule()` (variables `{ id, data }`), `useDeleteAlertRule()`
  (variables bare `id: string`). `staleTime: 5 * 60 * 1000` throughout, per
  the brief's "rules change almost never" guidance. Every mutation
  invalidates `queryKeys.alertRules.all`; update/delete additionally
  invalidate `queryKeys.alertRules.detail(id)`.
- `lib/query/hooks/index.ts`: added `export * from './useAlerts'` and
  `export * from './useAlertRules'`.
- **Beyond the brief's literal file list**: added
  `__tests__/unit/lib/useAlertRules.test.tsx`. The brief explicitly flags
  this as "welcome, not scope creep" since `useAlertRules.ts` had no
  dedicated test file in the task's file list. Covers `useAlertRulesList`,
  `useAlertRuleDetail` (disabled-without-id + happy path), and all three
  mutations, using the same real-`QueryClient` pattern (not the mocked
  `@tanstack/react-query` anti-pattern the brief warns against).

## TDD evidence

### Step 0 (severity sort)

Baseline — old test passes against old (lexical) behavior, confirming I
understood the starting state before touching anything:
```
Tests:       32 skipped, 1 passed, 33 total
```

RED — after rewriting the test to expect rank order, before touching the
route:
```
● should sort by severity rank descending, most severe first
  - Expected  - 1        Array [
  + Received  + 1        -   "device_crit",
                              "device_warn",
                              "device_info",
                          +   "device_crit",
                            ]

● should sort by severity rank ascending, least severe first
    Expected: ["device_info","device_warn","device_crit"]
    Received: ["device_crit","device_info","device_warn"]

Tests:       2 failed, 32 skipped, 34 total
```
(Received order for desc — `warning, info, critical` — and for asc —
`critical, info, warning` — are exactly the lexical string order, confirming
the bug was live and the test was exercising it.)

GREEN — after the aggregation fix:
```
✓ should sort by severity rank descending, most severe first (14 ms)
✓ should sort by severity rank ascending, least severe first (12 ms)
Tests:       32 skipped, 2 passed, 34 total
```

Full file, both new tests plus the untouched 32:
```
Tests:       34 passed, 34 total
```

**Load-bearing check on the supplementary `_id`/`__v` assertion**: temporarily
changed `{ $project: { __v: 0, _severity_rank: 0 } }` to
`{ $project: { _severity_rank: 0 } }` (i.e. stopped excluding `__v`) and
reran:
```
● should sort by severity rank descending, most severe first
  expect(received).not.toHaveProperty(path)
  Expected path: not "__v"
  Received value: 0
Tests:       1 failed, 33 skipped, 34 total
```
Confirmed red, then reverted the projection back to the brief's exact code
and reconfirmed 34/34 green.

### Steps 2–5 (v2 client)

RED (Step 3, before `alertsApi`/`alertRulesApi` existed):
```
TypeError: Cannot read properties of undefined (reading 'resolve')
TypeError: Cannot read properties of undefined (reading 'create')
TypeError: Cannot read properties of undefined (reading 'delete')
Tests:       6 failed, 6 total
```

GREEN (Step 5, after adding the client namespaces):
```
PASS node __tests__/unit/lib/v2-client-alerts.test.ts
  alertsApi
    ✓ should build the list URL with filters
    ✓ should request a single alert with include_device
    ✓ should PATCH acknowledged
    ✓ should PATCH resolved with a note
  alertRulesApi
    ✓ should POST a new rule
    ✓ should DELETE a rule
Tests:       6 passed, 6 total
```
Matches the brief's "Expected: PASS, 6 tests" exactly.

### Steps 6–8 (hooks)

RED (Step 6, before `lib/query/hooks/useAlerts.ts` existed):
```
FAIL jsdom __tests__/unit/lib/useAlerts.test.tsx
  ● Test suite failed to run
    Configuration error:
    Could not locate module @/lib/query/hooks/useAlerts mapped as: ...
```

GREEN (Step 7, after writing the hook):
```
PASS jsdom __tests__/unit/lib/useAlerts.test.tsx
  useAlertsList
    ✓ should return the alerts array
    ✓ should surface an error
  useAlertDetail
    ✓ should be disabled without an id
  mutations
    ✓ should acknowledge
    ✓ should resolve with a note
  useOpenAlertCount
    ✓ should read pagination.total, not the row count
    ✓ should request a single row rather than a full page
Tests:       7 passed, 7 total
```

**Load-bearing check on `useOpenAlertCount`** (the brief calls this out by
name as the case that matters — `data.length === 1` vs `total === 143` must
not be made to agree): temporarily changed
`return response.pagination.total;` to `return response.data.length;` and
reran just that describe block:
```
● useOpenAlertCount › should read pagination.total, not the row count
  expect(received).toBe(expected)
  Expected: 143
  Received: 1
Tests:       1 failed, 5 skipped, 1 passed, 7 total
```
Confirmed red (the "request a single row" test still passed, correctly,
since it only checks the call args, not the return value). Reverted to
`response.pagination.total` and reconfirmed 7/7 green.

### Bonus: `useAlertRules.test.tsx`

Written directly against the already-implemented `useAlertRules.ts` (not a
strict pre-implementation RED/GREEN cycle, since the brief only mandated
this as optional bonus coverage). All 7 pass:
```
PASS jsdom __tests__/unit/lib/useAlertRules.test.tsx
  useAlertRulesList
    ✓ should return the rules array
    ✓ should surface an error
  useAlertRuleDetail
    ✓ should be disabled without an id
    ✓ should load a rule by id
  mutations
    ✓ should create a rule
    ✓ should update a rule with {id, data}
    ✓ should delete a rule by bare id, not an object
Tests:       7 passed, 7 total
```

### Step 8's combined command

```
pnpm test __tests__/unit/lib/useAlerts.test.tsx __tests__/unit/lib/v2-client-alerts.test.ts __tests__/integration/api/alerts.integration.test.ts
```
```
Test Suites: 3 passed, 3 total
Tests:       47 passed, 47 total
```

## Gate output (exact)

### `npx tsc --noEmit`

First run surfaced one real error — a discriminated-union tuple pitfall the
brief explicitly warned about, in my own bonus test file:
```
__tests__/unit/lib/useAlertRules.test.tsx(92,27): error TS2345: Argument of
type '{ ... selector: { types: "temperature"[]; }; }' is not assignable to
parameter of type 'CreateAlertRuleBody'.
  ...
  Type '"temperature"[]' is not assignable to type
  '[ReadingTypeName, ...ReadingTypeName[]]'.
```
Cause: I built the mutation payload in an intermediate `const body = {...}`
before calling `.mutate(body)`, which breaks TypeScript's contextual typing
of the array literal against the tuple type (works fine when the object
literal is passed directly as an argument, as in the brief's own
`v2-client-alerts.test.ts`, but not through an unannotated intermediate
variable). Per the brief's explicit guidance ("if you find yourself writing
a cast... stop and re-read `types/v2/alert.types.ts`"), I did not cast — I
annotated the variable with `const body: CreateAlertRuleBody = {...}`
instead, letting the assignment context do the tuple-checking correctly.
Re-ran:
```
$ npx tsc --noEmit
EXIT_CODE=0
```
No output, 0 errors. Confirmed again post-commit: `EXIT_CODE=0`.

### `pnpm lint`

```
$ eslint
EXIT_CODE=0
```
No output, 0 problems. Confirmed again post-commit: `EXIT_CODE=0`.

### `pnpm build`

Initial run failed during static-page prerendering:
```
Error occurred prerendering page "/_not-found".
Error: @clerk/nextjs: Missing publishableKey. ...
```
This worktree's `.env.local` has no `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` /
`CLERK_SECRET_KEY` set (confirmed by grepping the file's keys). To rule out
that my changes caused this, I `git stash -u`'d back to a fully clean tree
and reran `pnpm build`: it failed identically, on a different page
(`/analytics` instead of `/_not-found`, since prerender order isn't
deterministic across workers), with the exact same missing-publishable-key
error — proving this is a pre-existing environment gap in this worktree, not
something introduced by this task. I then restored my changes with
`git stash pop` (verified `git status` showed exactly my 5 modified + 5
untracked files again, nothing lost).

To confirm the code itself builds cleanly once that gap is filled, I ran the
build once more with Clerk keys supplied **inline on the command only**
(never written to `.env.local` or any tracked file):
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..." CLERK_SECRET_KEY="sk_test_..." pnpm build
```
This completed cleanly — all 30 routes built, including
`/api/v2/alerts`, `/api/v2/alerts/[id]`, `/api/v2/alert-rules`, and
`/api/v2/alert-rules/[id]` as dynamic (ƒ) routes — with no errors or
warnings beyond the unrelated `baseline-browser-mapping` staleness notice
that appears on every build in this repo regardless of branch.

I did not modify `.env.local` or any other file to work around this; it's
flagged here as a pre-existing environment condition of this worktree, not a
defect in the diff.

### `pnpm test` (full suite)

```
Test Suites: 101 passed, 101 total
Tests:       2454 passed, 2454 total
Snapshots:   0 total
Time:        41.662 s
```
Entry baseline was 2433 tests / 98 suites. Delta: +21 tests / +3 suites,
which is exactly the three new test files (`v2-client-alerts.test.ts`: 6,
`useAlerts.test.tsx`: 7, `useAlertRules.test.tsx`: 7 = 20) plus Step 0's net
+1 (one test replaced by two). Grepped the full run log for `FAIL`, `✕`, and
`failed,` (excluding `0 failed`) — no matches; the only console noise in the
log is a pre-existing React `act()` warning from an untouched test
(`DeviceDetailModal.test.tsx`) and expected `logger.warn`/`logger.log` lines
from the alerts integration tests themselves (they exercise real warn/info
code paths, e.g. "Device not found for alert").

## Commits

```
d5f1b41 feat(alerting): add alerts API client and React Query hooks
2ad5dda fix(alerting): sort alerts by severity rank, not lexically
```

Commit 1 (`2ad5dda`) — `app/api/v2/alerts/route.ts`,
`__tests__/integration/api/alerts.integration.test.ts` (2 files, +70/-23).

Commit 2 (`d5f1b41`) — `lib/api/v2-client.ts`, `lib/query/queryClient.ts`,
`lib/query/hooks/useAlerts.ts`, `lib/query/hooks/useAlertRules.ts`,
`lib/query/hooks/index.ts`, `__tests__/unit/lib/v2-client-alerts.test.ts`,
`__tests__/unit/lib/useAlerts.test.tsx`, plus the bonus
`__tests__/unit/lib/useAlertRules.test.tsx` (8 files, +636/-0).

Both authored on branch `feat/phase-4-alerting` in
`/home/yzel/github/infrasight-phase4`. Working tree is clean post-commit
(`git status --short` empty).

## Things I was unsure about / judgment calls made

1. **The extra `_id`/`__v` assertion in Step 0's descending test.** The
   brief's ambiguity-resolution section says to "verify `_id` still
   serializes the same way in the integration test" but doesn't give literal
   assertion code (unlike everything else in Step 0, which is copy-paste).
   I added three lines to the existing descending test rather than a wholly
   separate test, on the theory that it's checking the same aggregation
   output the test already fetched. I verified it's load-bearing (see TDD
   evidence). If a separate dedicated test was intended instead, this is an
   easy split.
2. **`seedThreeSeverities()` helper.** The brief shows the fixture inline and
   says "add one more case" — I factored the 30-line fixture into a shared
   local `async function` to avoid duplicating it verbatim across the two
   `it()` blocks, since `afterEach` in `jest.setup.ts` clears all
   collections between tests so each test still gets a fresh, fully
   independent seed. The three distinguishing timestamps and severities are
   unchanged from the brief — only the boilerplate is shared.
3. **`useAlertRules.test.tsx` (bonus file).** Built it against the
   already-written `useAlertRules.ts` rather than running a strict
   pre-implementation RED cycle for it specifically, since the brief frames
   it as optional bonus coverage, not a numbered TDD step. I did run it and
   confirm all 7 pass, and it caught one real problem (the tuple-typing tsc
   error described above), so it earned its keep.
4. **`pnpm build`'s missing Clerk key.** This is the one gate I could not
   make pass in this worktree's actual `.env.local` without either (a)
   writing real-looking secrets into a file the task didn't ask me to touch,
   or (b) using inline env vars for a one-off verification (what I did). I'm
   confident this is pre-existing/environmental and not caused by my diff
   (proven via the clean-tree stash test), but flagging it explicitly in
   case the orchestrating process expects `pnpm build` to be run as a gate
   in an environment where this is already configured.
5. **`queryKeys.alerts.list({ count: true })` as `useOpenAlertCount`'s cache
   key.** This is verbatim from the brief's Step 7 code, not my own
   addition — noting it only because `{ count: true }` isn't a real
   `ListAlertsQueryParams` field, it's purely a cache-key differentiator so
   the count query doesn't collide with a real `list({})` cache entry. No
   action needed; just confirming I understood why it's there rather than
   silently pattern-matching it.
