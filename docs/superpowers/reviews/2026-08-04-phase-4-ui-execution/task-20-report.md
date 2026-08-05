# Task 20: End-to-end coverage — Report

Status: **DONE**

Branch: `feat/phase-4-alerting`, worktree `/home/yzel/github/infrasight-phase4`.

## Summary

Wrote `e2e/alerts.spec.ts` (7 tests, 0 skipped) and, in the process of making it
prove real behavior against real seeded data, found and fixed a genuine crash
on `/alerts/rules` (`components/alerts/AlertRuleList.tsx`). Both are committed.
All four strict gates (tsc, lint, jest, build) are clean. The Playwright suite
was run three separate times against the real dev server + seeded Mongo
container, 8/8 passing every time (7 test cases + 1 auth-setup step; 0 skips).

## How alerts got into the database

`alerts_v2` was confirmed empty (0 docs) before this task, exactly as expected
— `pnpm seed` and `scripts/v2/simulate.ts` both insert readings via raw
`ReadingV2.insertMany`, bypassing the API routes where `evaluateReadings` runs.
`alert_rules_v2` already had the 4 seeded starter rules from Task 19.

Steps taken:

1. Started the dev server manually against the existing seeded container, so
   I could hit the cron endpoint before running Playwright:
   ```
   E2E_TESTING=true pnpm dev
   ```
   (`MONGODB_URI=mongodb://127.0.0.1:27018/infrasight?replicaSet=rs0&directConnection=true`
   from `.env.local`, pointing at `infrasight-phase4-mongo`.)

2. Called the cron endpoint with the `SEED_SECRET` bearer token 5 times back
   to back:
   ```bash
   SEED_SECRET=$(grep '^SEED_SECRET=' .env.local | cut -d'=' -f2- | tr -d '"')
   curl -s -H "Authorization: Bearer $SEED_SECRET" http://localhost:3000/api/v2/cron/simulate
   ```
   Every call returned `"success":true,"count":500,"rejected":0,...}` — 500
   readings inserted (one per active device) per call.

3. Verified real documents in the database directly (not just API responses):
   ```
   docker exec infrasight-phase4-mongo mongosh \
     "mongodb://127.0.0.1:27017/infrasight?replicaSet=rs0" --quiet --eval '
   db.alerts_v2.aggregate([
     { $group: { _id: { rule: "$rule_name", status: "$status" }, count: { $sum: 1 } } }
   ]).forEach(printjson);'
   ```
   After the 5 calls: **275 alert documents**, breaking down as `High anomaly
   score` (18 firing / 81 resolved), `Low battery` (22 firing / 126 resolved),
   `Power spike` (5 firing / 22 resolved), and `High temperature` (1 pending).
   `is_open: true` count was 46 (45 firing + 1 pending).

   After a few more opportunistic calls made later (see below), the tally at
   the time the E2E suite was finally run was **391 documents**: `High anomaly
   score` (36 firing / 116 resolved), `Low battery` (28 firing / 176 resolved),
   `Power spike` (5 firing / 29 resolved), `High temperature` (1 pending).
   69 alerts open (firing) across three rules the whole time — comfortably
   enough for every locator in the spec to find real rows without skipping.

### The "High temperature" `for_duration_seconds: 300` rule specifically

I read `lib/alerting/evaluate.ts` closely before assuming this would "just
work" with a few calls. The mechanics: a temperature reading only breaches
`>30` on the anomaly branch of `lib/simulation/readings.ts` (the non-anomaly
branch caps out at `18 + 10 + jitter ≈ 29`), anomaly probability per device
per call is only ~1.2%–24%, and only ~50% of anomalous temperature readings
land "hot" (30–40) rather than "cold" (5–15). Worse: **any call where the same
device's reading doesn't re-breach deletes its pending episode outright**
(`evaluate.ts`'s not-breaching branch: `push({ deleteOne: { filter: { _id:
existing._id, status: 'pending' } } })`), so promotion needs the *same*
device to independently roll hot again on a call at least 300s later, with
zero intervening calls (each intervening call is another independent, mostly-
losing roll for that device).

I made two correctly-timed, single-shot attempts (call once, wait ≥300s with
*no* other cron calls in between so as not to wipe the pending episode, call
exactly once more):

- Call at `23:26:24.967Z` opened a pending episode on `device_v2_0106`
  (trigger 39.33). A single follow-up call at `23:31:39.586Z` (315s later)
  found `device_v2_0106` no longer hot — episode deleted — but two *new*
  devices (`device_v2_0011` at 39.94, `device_v2_0267` at 37.68) rolled hot in
  that same call, opening two fresh pending episodes.
- A second follow-up call at `23:41:10.535Z` (~9.5 min later, comfortably past
  300s) found neither `0011` nor `0267` still hot — both deleted — but yet
  another device (`device_v2_0409` at 37.99) rolled hot, opening a new pending
  episode.

So across the whole session I observed **4 distinct pending episodes get
created** for "High temperature" (real evidence the `for_duration_seconds`
gate and the pending-episode mechanism work exactly as designed), but never
observed an actual promotion to `firing` — the simulator's RNG makes that a
low-probability-per-attempt event (my estimate: roughly 3–8% per attempt,
depending on how many devices happen to be pending going into the next call),
and reliably forcing it would mean dozens of real 5-minute wall-clock cycles.

**This does not block anything required.** None of the 7 spec assertions
depend on the temperature rule reaching `firing`: the rules page test only
checks that the rule *name* "High temperature" renders on `/alerts/rules`
(true regardless of alert state — it's a rules list, not an alert list), and
every alert-existence assertion is satisfied by the other three rules, which
fire immediately (`for_duration_seconds: 0`) and did so reliably on the very
first cron call. I'm flagging this transparently per your instructions rather
than quietly declaring victory — the mechanism is proven to construct
pending episodes correctly; sustained-breach promotion specifically was not
witnessed firing in this session.

## A real bug found and fixed along the way

While first running the new suite, the test `should reach the rules page and
show the seeded High temperature rule` failed — not on a bad locator, but
because `/alerts/rules` was actually **crashing** with a Next.js dev overlay:

```
Runtime TypeError: Cannot read properties of undefined (reading 'types')
  components/alerts/AlertRuleList.tsx (30:41) @ selectorChips
```

Root cause: `alert-rule-seeds.ts` deliberately sets `selector: {}` for the
"Low battery" and "High anomaly score" rules (battery is a device property,
not a reading-type constraint — see that file's own comment). Mongoose's
default `minimize: true` behavior strips an empty nested object before
persisting, so those two rule documents have **no `selector` key at all** in
MongoDB (confirmed directly: `db.alert_rules_v2.find({}, {selector:1})` shows
`High temperature`/`Power spike` with a `selector.types` array, and `Low
battery`/`High anomaly score` with no `selector` field whatsoever).

This is exactly the runtime shape `lib/alerting/selector.ts`'s
`matchesSelector(device, selector: IAlertRuleSelector | undefined)` and
`lib/alerting/rule-cache.ts`'s `rule.selector?.types?.length` already guard
against — the evaluator was already written defensively for this. The one
place that wasn't was `AlertRuleList.tsx`'s `selectorChips()`, which trusted
`AlertRuleV2Response.selector` being non-optional (per its TS type) and did
`selector.types` unguarded. The existing unit test
(`__tests__/unit/components/AlertRuleList.test.tsx`) only ever mocks a
fully-formed `selector: { types: [...] }`, so it never exercised this path —
this is precisely the kind of gap unit tests miss and real-DB E2E catches.

Fix (`components/alerts/AlertRuleList.tsx`, commit `4d812ca`): widened
`selectorChips`'s parameter to `AlertRuleSelector | undefined` and switched
every access to optional chaining, mirroring the exact convention already
used in `selector.ts`/`rule-cache.ts`. I deliberately did *not* touch the
Mongoose schema's `minimize` behavior or the wire type — the rest of the
codebase has already standardized on "selector may be absent at runtime," so
matching that existing convention at the one broken call site is the smaller,
safer, more consistent fix. Verified: `pnpm test` still 2597/115 after the
change (jest doesn't touch `/e2e/`, so this was purely a regression check).

I did not weaken or route around this in the spec — the "should reach the
rules page" test still visits the real page and asserts the real rule name
renders; the fix is what makes that assertion legitimately pass instead of
crashing.

## Playwright output — passed vs skipped

Ran three times total (once right after writing the fix, once via the exact
`pnpm test:e2e e2e/alerts.spec.ts` command, once more after all four gates
passed) to check for flakiness. All three runs: **8/8 passed, 0 failed, 0
skipped** (7 test cases in `e2e/alerts.spec.ts` + 1 `[setup] authenticate`
step from `e2e/auth.setup.ts` = 8 total; Playwright's own count includes the
setup project).

Final run (`pnpm test:e2e e2e/alerts.spec.ts --reporter=list`):

```
Running 8 tests using 7 workers

  ✓  1 [setup] › e2e/auth.setup.ts:15:6 › authenticate (1.3s)
  ✓  2 [chromium] › e2e/alerts.spec.ts:21:7 › Alerts › should render the active alerts page (838ms)
  ✓  3 [chromium] › e2e/alerts.spec.ts:28:7 › Alerts › should reach alerts from the top navigation, with an open-alert count badge (1.7s)
  ✓  4 [chromium] › e2e/alerts.spec.ts:49:7 › Alerts › should switch to history via the status filter, reflected in the Select (853ms)
  ✓  5 [chromium] › e2e/alerts.spec.ts:62:7 › Alerts › should survive a refresh on a deep-linked alert (2.3s)
  ✓  6 [chromium] › e2e/alerts.spec.ts:83:7 › Alerts › should render the styled 404 for an unknown alert id (1.7s)
  ✓  7 [chromium] › e2e/alerts.spec.ts:90:7 › Alerts › should reach the rules page and show the seeded High temperature rule (1.8s)
  ✓  8 [chromium] › e2e/alerts.spec.ts:102:7 › Alerts › should render acknowledge as a gated control -- visible, disabled, tooltipped -- rather than hiding it (1.7s)

  8 passed (5.0s)
```

**Why there are no skips**: the brief's canned spec text used
`test.skip(count === 0, 'No alerts present...')` in two places. I removed both
guards and replaced them with hard `await expect(locator).toBeVisible(...)`
assertions, per your instruction that a skip is only honest for something
genuinely optional — and since seeding alerts was this task's own job, the
data being present is not optional. I verified the precondition first (real
firing alerts in the DB, confirmed via `mongosh`, stable for the whole session
since nothing in the test run itself mutates data — the gated
Acknowledge/Resolve buttons are disabled, so there's no risk of a test
accidentally consuming the very data a later test depends on) before writing
the assertions this way.

`playwright.config.ts`'s `webServer` block (`E2E_TESTING=true pnpm dev`,
`reuseExistingServer: !process.env.CI`) detected my already-running dev server
on `:3000` and reused it rather than spawning a duplicate, exactly as
documented.

## Gate outputs

All four run from `/home/yzel/github/infrasight-phase4` on branch
`feat/phase-4-alerting`, after both commits below.

**`npx tsc --noEmit`** — exit 0, no output (0 errors).

**`pnpm lint`** (`eslint`) — exit 0, no output (0 problems).

**`pnpm test`** (jest) — run twice (once as a pre-change baseline, once after
the `AlertRuleList.tsx` fix): identical both times —
```
Test Suites: 115 passed, 115 total
Tests:       2597 passed, 2597 total
Snapshots:   0 total
Time:        ~47.6 s
```
Matches the stated entering baseline exactly (2597/115); the fix didn't move
this number, as expected (`jest.config.js` ignores `/e2e/` entirely, and the
one component change only widens a parameter type / adds optional chaining —
behaviorally identical for a fully-formed selector, which is all the existing
unit test ever passes).

**`pnpm build`** — exit 0. Route manifest confirms `/alerts` (static),
`/alerts/[id]` (dynamic), `/alerts/rules` (static), `/api/v2/alert-rules`,
`/api/v2/alert-rules/[id]`, `/api/v2/alerts`, `/api/v2/alerts/[id]` all
present alongside the rest of the app's routes. No errors or warnings in the
build output beyond the pre-existing `baseline-browser-mapping` staleness
notice (unrelated, present before this task).

I also smoke-tested `e2e/device-detail.spec.ts` before touching anything, to
make sure Playwright + the dev server + the seeded Mongo container actually
work together in this sandbox (no prior confirmation that E2E had ever been
run here). 12 of its 16 tests failed — but on inspection this is a pre-
existing staleness issue unrelated to this task: that spec's locators target
`[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]`,
and `components/DeviceGrid.tsx` is actually a `@tanstack/react-table` grid
with none of those class names or test ids — the spec predates a dashboard
refactor. I did not touch `device-detail.spec.ts` (out of scope for Task 20,
which only asks for `e2e/alerts.spec.ts`), but flagging it since it means
this environment's E2E harness itself (Chromium, dev server, seeded DB, RBAC/
demo-mode wiring) is confirmed healthy — the failures are stale selectors,
not environment breakage. Chromium had to be installed for this session
(`npx playwright install chromium`, browser build v1200) since the cached
build id in `~/.cache/ms-playwright` didn't match what this `@playwright/
test@1.57.0` install expected; the standard `--with-deps` flag failed on
missing sudo, so I ran the plain (no-system-deps) install, which succeeded.

## Environment notes

- `NEXT_PUBLIC_DEMO_MODE=true` and `DEMO_MODE=true` in `.env.local` — this
  deployment **is** in demo mode. Combined with `E2E_TESTING=true` bypassing
  Clerk in `proxy.ts` and `e2e/auth.setup.ts` never actually signing in
  (it just navigates to `/` and snapshots storage state), every page in this
  suite is visited as an anonymous, non-admin demo visitor. Per
  `lib/auth/rbac-client.tsx`'s `useAdminAction()`, that means Acknowledge/
  Resolve/New-rule controls must render **visible + disabled + tooltip**, not
  hidden. I verified this is what actually renders (not just what the brief
  assumed) before asserting it: the spec checks `toBeDisabled()` and
  `toHaveAttribute('title', /admin only/i)` in addition to visibility.
- No outbound internet in this sandbox for some services: Redis (Upstash)
  DNS resolution failed (`ENOTFOUND exact-wildcat-21846.upstash.io`) and
  Pusher's real trigger call returned `413` (payload too large for 500
  readings in one event) on every cron call. Both are caught/logged by
  existing error handling and don't affect the alerts API, the DB writes, or
  anything this suite depends on. `cdn.playwright.dev` *was* reachable (used
  to download Chromium), so outbound access isn't fully blocked, just
  inconsistent per-host.
- The dev server I started manually for seeding was left running through
  `pnpm build` (a production build) without apparent conflict — I was mildly
  concerned about `.next` contention between `next dev` and `next build`
  sharing a directory, but the dev server kept responding to a cron call I
  made for curiosity immediately after the build finished. I stopped that
  dev server process at the end of the session; it is not left running.

## Commits

```
5f5d17f test(alerting): add end-to-end coverage for the alerts UI
4d812ca fix(alerting): guard selectorChips against a minimized-away selector
```

Both on `feat/phase-4-alerting` in `/home/yzel/github/infrasight-phase4`.
Working tree is clean after both commits (`git status` confirms nothing
outstanding). `/home/yzel/github/infrasight` and `/home/yzel/github/
infrasight-docs` were not touched.

## Anything I was unsure about

- Whether to fix `AlertRuleList.tsx` at all, given the task's stated file list
  was only `e2e/alerts.spec.ts`. I decided fixing it was correct rather than
  optional, because: (a) the task's own framing ("prove the alerting surfaces
  actually work when wired together") and the explicit "failure mode" warning
  about specs that assert nothing real both point toward not routing around a
  live crash; (b) the crash is triggered by the exact starter rule set Task 19
  itself seeds, so it isn't a contrived edge case — any real visitor to
  `/alerts/rules` on a freshly-seeded deployment hits it; (c) the fix is a
  4-line, purely-more-defensive change with no behavioral difference for any
  already-passing case, verified by an unchanged 2597/115 Jest result. Happy
  to split it into its own PR/review if you'd rather keep Task 20 strictly to
  the test file — the two commits are already separated for exactly that
  reason.
- Whether to force the "High temperature" rule all the way to `firing`. Given
  the RNG analysis above, I judged that continuing to burn real wall-clock
  time on low-probability attempts (my two correctly-timed tries both missed)
  wasn't a good use of the session versus writing this up transparently,
  especially since no assertion depends on it. If you want this demonstrated
  definitively, the fastest reliable path would be a small script that
  inserts one directly-crafted `ReadingV2` breach 5+ minutes in the past via
  `ReadingV2.insertMany` for a single known device and lets one cron call
  evaluate it — but that starts to blur "seeded via the real write path"
  versus "constructed to force the outcome," so I held off doing that without
  checking first.
- The nav-badge test and the Select-reflects-status-in-URL test go beyond the
  brief's literal canned code (which only checked the heading was visible in
  both cases). I strengthened both because they were cheap, real, already-
  verified-true assertions of interfaces the task explicitly called out
  ("Nav has an 'Alerts' entry with an open-count badge...", "Filters are
  Select components... `/alerts?status=resolved` is a shareable link") — but
  flagging in case you'd rather the spec hew exactly to the canned text.

---

## Fix round 1 — report

Status: **DONE**

Addressed the reviewer's one Critical-adjacent finding (the `selector` type
contract still lying after the call-site patch) and the one Minor they asked
for (a Jest regression test). Left the two deferred Minors and the
`device-history` flake alone, as instructed.

### 1. Widened `selector` to optional on both type contracts

- `types/v2/alert.types.ts:54` — `AlertRuleV2Response.selector: AlertRuleSelector`
  → `selector?: AlertRuleSelector`, with a comment pointing at the Mongoose
  `minimize` behavior that makes this true.
- `models/v2/AlertRuleV2.ts:65` — `IAlertRuleV2.selector: IAlertRuleSelector`
  → `selector?: IAlertRuleSelector`, same reasoning.

Did **not** touch `minimize` on the schema — the reviewer's own evidence
(`seed-alert-rules.test.ts`'s round-trip test, `default: () => ({})` already
not surviving persistence) is correct and I re-confirmed it rather than take
it on faith: the schema already defaults to `{}`, and it still doesn't
survive `insertMany`/`save`. Flipping `minimize: false` would change nothing
for the 4 rules already sitting in the seeded database, and every reader
would still need to tolerate absence for anything written before the flag
changed. Widening the type and fixing the readers is strictly less risky and
actually fixes the thing that's broken today.

### 2. What `tsc --noEmit` found after widening — investigated, not papered over

Re-running `tsc --noEmit` after the widening surfaced exactly 4 errors, all
in test files, none in `components/alerts/AlertRuleList.tsx` (already fixed)
or in any production code path:

```
__tests__/unit/lib/seed-alert-rules.test.ts(104,12): error TS2532: Object is possibly 'undefined'.
__tests__/unit/lib/seed-alert-rules.test.ts(105,26): error TS2532: Object is possibly 'undefined'.
__tests__/unit/models/AlertRuleV2.test.ts(29,14): error TS18048: 'rule.selector' is possibly 'undefined'.
__tests__/unit/models/AlertRuleV2.test.ts(39,14): error TS18048: 'rule.selector' is possibly 'undefined'.
```

I read all four call sites before touching anything, because I wanted to know
whether these were "the same latent bug" (an access that really can blow up
at runtime) or a different Mongoose nuance entirely. They're the latter, and
it's worth spelling out since it's genuinely subtle:

- All four read `.selector.types` off a **hydrated Mongoose document**
  (`AlertRuleV2.create(...)` in the model test, `AlertRuleV2.findOne(...)`
  with no `.lean()` in the seed test) — never a `.lean()` read.
- Mongoose's `minimize` behavior only strips empty nested objects at the
  moment a document is **persisted** (the raw BSON written to Mongo). It does
  not apply when Mongoose **hydrates** a document from a query result: for a
  single-nested-subdocument path like `selector`, hydration reconstructs the
  subdocument via the schema's `default: () => ({})` even when the stored
  BSON has no `selector` key at all. `.lean()` skips all of that — it hands
  back the raw POJO with the key genuinely missing, no defaults applied.
- So on a hydrated document, `rule.selector` is never actually `undefined` at
  runtime — only on a `.lean()` read of already-persisted data (exactly the
  API-route path `AlertRuleList.tsx` consumes) is it genuinely absent.

That means these 4 sites are not can't-happen-in-practice the way the
original crash was avoidable-but-real; they're TypeScript being newly (and,
for the hydrated-document case, overly) conservative once the type no longer
distinguishes "hydrated document" from "lean-read POJO." The fix is still not
a cast, though, and still matches the existing convention: switched all four
to `?.` (`rule.selector?.types`, `rehydrated!.selector?.types`), the same
optional-chaining style already used in `lib/alerting/selector.ts` and
`rule-cache.ts`. I checked this doesn't quietly weaken either test:
  - Two assertions check `.types` **is** `['temperature']` on a rule created
    with an explicit non-empty selector — if `.selector` were ever genuinely
    undefined here (it isn't, but hypothetically), `?.types` would be
    `undefined` and the `toEqual(['temperature'])` assertion would fail
    loudly, not pass vacuously.
  - Two assertions check `.types` **is** `undefined` on a rule created with
    an empty selector — `?.` and direct access produce the identical result
    here by construction, so nothing changed about what's being verified.
  - Confirmed empirically, not just by inspection: ran both files
    (`npx jest __tests__/unit/models/AlertRuleV2.test.ts
    __tests__/unit/lib/seed-alert-rules.test.ts`) after the `?.` edit —
    18/18 passed, same as before the type change.

`tsc --noEmit` is clean (0 errors) after these four edits. No casts, no `!`
non-null assertions, no `@ts-expect-error` anywhere in this round.

### 3. Jest regression test for the crash itself

Added to `__tests__/unit/components/AlertRuleList.test.tsx`, in the
"rendering rows" describe block:

```typescript
it('should render a rule whose selector is entirely absent, without crashing', () => {
  mockUseAlertRulesList.mockReturnValue({
    data: [makeRule({ name: 'Low battery', metric: 'battery_level', selector: undefined })],
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  });

  render(<AlertRuleList />);

  expect(screen.getByText('Low battery')).toBeInTheDocument();
});
```

Verified it actually catches the regression, not just that it passes now:

1. Added the test first, then temporarily reverted **only**
   `selectorChips` in `components/alerts/AlertRuleList.tsx` to its pre-fix
   body (`selector: AlertRuleSelector`, unguarded `selector.types`), leaving
   everything else (including the new test) as-is.
2. Ran `npx jest __tests__/unit/components/AlertRuleList.test.tsx -t "whose
   selector is entirely absent"` — **failed**, with the identical error the
   browser hit: `TypeError: Cannot read properties of undefined (reading
   'types')` at `selectorChips`, thrown from inside `AlertRuleList`'s render
   via `Array.map`. 1 failed, 10 skipped (this is a call-site regression test
   working as intended, not one more test that asserts nothing).
3. Restored the fixed `selectorChips` body exactly (confirmed via `git diff
   components/alerts/AlertRuleList.tsx` — empty, i.e. byte-identical to the
   already-committed fix) and re-ran the full file: **11/11 passed**.

### Gate re-run (after all fix-round-1 changes)

All from `/home/yzel/github/infrasight-phase4` on `feat/phase-4-alerting`,
after both new commits below.

- **`npx tsc --noEmit`** — exit 0, 0 errors.
- **`pnpm lint`** — exit 0, 0 problems.
- **`pnpm test`** — `Test Suites: 115 passed, 115 total` /
  `Tests: 2598 passed, 2598 total` (2597 + the 1 new regression test; suite
  count unchanged since no new test file was created). Did **not** hit the
  `device-history.integration.test.ts` flake you flagged, consistent with you
  not reproducing it either — I did not touch anything in `DeviceV2` or its
  history route this round, and did not add sleeps or otherwise chase it, per
  your instruction.
- **`pnpm build`** — exit 0, clean. Route manifest unchanged from the first
  report (`/alerts`, `/alerts/[id]`, `/alerts/rules`, `/api/v2/alert-rules`,
  `/api/v2/alert-rules/[id]`, `/api/v2/alerts`, `/api/v2/alerts/[id]` all
  present).
- **`pnpm test:e2e e2e/alerts.spec.ts`** — restarted the dev server against
  the same seeded Mongo container (data survived untouched: 69 firing / 391
  total alerts, unchanged from the first report) and re-ran the full E2E
  spec: **8/8 passed, 0 skipped** again. Not strictly asked for this round
  (nothing in the amended code touches runtime app behavior — the component
  fix itself is byte-identical to before, and everything else is types/tests
  only), but cheap enough to confirm rather than assume.

### Commits (fix round 1)

```
02684ef test(alerting): add a regression test for a rule with no selector
6a77a67 fix(alerting): make selector optional on the rule type contracts
```

Both on `feat/phase-4-alerting`. Working tree clean after both.

### One thing to flag on myself

The body of commit `6a77a67` has a typo — "direct property enerak" should
read "direct property read". I noticed it after the commit was already made.
Per the git safety protocol (create new commits rather than amend unless
explicitly asked), I left it rather than rewrite the commit — it's cosmetic,
confined to the message body, and doesn't affect the diff, the subject line,
or anything checked by the gates. Flagging it here so it isn't a surprise if
you read the log; happy to have it amended or squashed later if you'd
rather, since at that point it would be an explicit request.
