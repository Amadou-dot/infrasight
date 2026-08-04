# Task 8 Report: Make the client-facing wire contract true

Branch `feat/phase-4-alerting`, worktree `/home/yzel/github/infrasight-phase4`.
Started at `51eec73`.

## What I implemented

All six required items, in `types/v2/alert.types.ts` plus the four alert/alert-rule route files.

### 1. False header claim

`types/v2/alert.types.ts:4-5` claimed `lib/pusher-context.tsx imports AlertEvent from this
file`. I grepped `lib/pusher-context.tsx` and confirmed zero occurrences of "alert" anywhere in
it (verified again just now — see Verification). Changed the header to state the true premise:
nothing imports from this file yet; `lib/pusher-context.tsx` will consume `AlertEvent` once
Task 13/14 wires up delivery.

### 2. `UpdateAlertRuleBody` — atomic condition group

Was `Partial<CreateAlertRuleBody>`, which type-checks `{ threshold: 5 }` even though
`updateAlertRuleSchema` always rejects a partial `metric`/`comparison`/`threshold`/`selector`
group (`alert-rule.validation.ts:144-154`, the `CONDITION_FIELDS` refine).

Modeled as `Partial<AlertRuleBodyBase> & (UpdateAlertRuleCondition | NoConditionUpdate)`, where
`NoConditionUpdate` pins all four condition keys to `undefined` and `UpdateAlertRuleCondition` is
a discriminated union requiring all four together (see item 3 for why it's a *separate* union
from create's, not a shared one — this is where I found and fixed a real bug during self-review).

### 3. `CreateAlertRuleBody` — discriminated union on `metric`

`selector` was `?: AlertRuleSelector` unconditionally, but `createAlertRuleSchema` requires
`selector.types` to be a non-empty array specifically when `metric === 'value'`
(`typesRequiredForValueMetric`, `alert-rule.validation.ts:64-67`).

Added `ValueMetricSelector` (selector with `types` narrowed to the non-empty tuple
`[ReadingTypeName, ...ReadingTypeName[]]`) and `CreateAlertRuleCondition`, a union discriminated
on `metric`:
- `'value'` → `selector: ValueMetricSelector` (required, non-empty `types`).
- `'anomaly_score'` / `'battery_level'` → `selector?: AlertRuleSelector` (optional; comment notes
  the threshold must be within `[0,1]` / `[0,100]` respectively, enforced by Zod's
  `thresholdWithinMetricBounds`, not representable in TypeScript).

`CreateAlertRuleBody = AlertRuleBodyBase & CreateAlertRuleCondition`, where `AlertRuleBodyBase`
holds the fields that don't participate in the condition (`name`, `description?`, `enabled?`,
`for_duration_seconds?`, `severity`, `cooldown_seconds?`).

### A bug I found and fixed during self-review (still item 2/3, not scope creep)

My first draft shared one `AlertRuleCondition` union between create and update. While doing the
"do the new types actually match the Zod schemas" self-review, I re-read `createAlertRuleSchema`
vs `updateAlertRuleSchema` side by side and noticed `selector` has `.default({})` on create but
only `.optional()` on update — and the atomic-group refine tests `data.selector !== undefined`
against the *parsed* data, before any default would apply. I did not trust that reading and
instead probed the live Zod schemas directly (throwaway test, removed before commit — see
Verification):

| Input | `updateAlertRuleSchema` | `createAlertRuleSchema` |
|---|---|---|
| `{metric:'anomaly_score', comparison:'gt', threshold:0.5}` (no `selector` key) | **REJECTED**: "metric, comparison, threshold and selector must be updated together — send all four or none" | **ACCEPTED** (`selector` defaults to `{}`) |
| same + `selector: {}` | ACCEPTED | ACCEPTED |

So on **update**, `selector` must be an explicit key whenever the condition group is touched, for
*every* metric, not just `'value'` — unlike create, where it's genuinely optional for
`anomaly_score`/`battery_level`. My shared-union draft had `selector?: AlertRuleSelector` on
those arms, which would have let `UpdateAlertRuleBody` represent
`{metric:'anomaly_score', comparison:'gt', threshold:0.5}` (no selector) — a state
`updateAlertRuleSchema` always rejects. That's exactly the class of bug this task exists to
eliminate, and I'd have shipped a new instance of it under the guise of "shared for DRYness."

Fixed by splitting into two distinct unions: `CreateAlertRuleCondition` (selector optional on the
non-`'value'` arms) and `UpdateAlertRuleCondition` (selector required — but may be `{}` — on
every arm). Each carries a comment citing the live-schema behavior that justifies the asymmetry.

### 4. `__v` stripping (runtime change, all 4 route files)

`__v` is Mongoose's default version key; neither schema sets `versionKey: false`, so every
response leaked it. Stripped at the response boundary, matching the brief's stated mechanism per
read style:

| File | Site | Before | After |
|---|---|---|---|
| `alerts/route.ts` | GET list, `.lean()` | `AlertV2.find(filter).sort(...)...lean()` | `.select('-__v')` inserted before `.sort()` |
| `alerts/[id]/route.ts` | GET single, `.lean()` | `AlertV2.findById(id).lean()` | `.select('-__v')` inserted |
| `alerts/[id]/route.ts` | PATCH, `.toObject()` | `updated.toObject()` | `updated.toObject({ versionKey: false })` |
| `alert-rules/route.ts` | GET list, `.lean()` | `AlertRuleV2.find(filter).sort(...)...lean()` | `.select('-__v')` inserted |
| `alert-rules/route.ts` | POST, `.toObject()` | `created.toObject()` | `created.toObject({ versionKey: false })` |
| `alert-rules/[id]/route.ts` | GET single, `.lean()` | `AlertRuleV2.findOne({...}).lean()` | `.select('-__v')` inserted |
| `alert-rules/[id]/route.ts` | PATCH, `findOneAndUpdate().lean()` | — | `.select('-__v')` inserted before `.lean()` |

`alert-rules/[id]/route.ts` DELETE was **not** touched: its response is hand-built
(`{ _id, deleted, deleted_at }`), never spreads the document, and never carried `__v`. Adding a
test there would have been vacuous (asserting something never broken).

### 5. False caching rationale

`alerts/route.ts:11-12` justified not caching by saying the list "is already pushed over
Pusher." I traced both `safeEvaluateReadings()` call sites (`app/api/v2/readings/ingest/route.ts:258`,
`app/api/v2/cron/simulate/route.ts:82`) and confirmed neither publishes anything — both only log
`evaluation.fired.length` / `evaluation.resolved.length` and discard the rest
(`lib/alerting/index.ts`'s own doc comment says as much: "Route response bodies report insert
results only. Alerting is not part of their contract."). The only `pusher.trigger()` call in
`cron/simulate/route.ts` is for `'new-readings'`, unrelated to alerts.

Rewrote the comment on a true premise: the set changes on every ingest (via the evaluator), no
cache-invalidation hook is wired to those writes (unlike alert-rules' explicit
`invalidateAlertRules()` on every mutation — confirmed there's no `ALERTS` entry in
`lib/cache/keys.ts`'s `CACHE_PREFIXES`, only `ALERT_RULES`), so caching would mean stale results
for an operator actively triaging what's firing. I kept the decision (don't cache) since the
brief said it may still be right — only the justification changed.

### 6. `actor` privacy trap

`app/api/v2/alerts/[id]/route.ts`'s `handleUpdateAlert` has `const { userId, user } =
await requireAdmin(); const auditUser = getAuditUser(userId, user);` in scope, and confirmed
`getAuditUser = (userId, user) => user?.email || userId` (`lib/auth/index.ts:262`) — the email
whenever Clerk has one on file. Rewrote the `ResolvedAlert` doc comment to name `userId` from
`requireAdmin()` explicitly as the value for `actor`, and to say plainly that `auditUser` /
`getAuditUser` must not be used for it — while noting those two remain correct for audit-trail
fields like `audit.resolved_by`, which are never broadcast. This is comment-only: no path
broadcasts `actor` today (confirmed — no `pusher.trigger` call exists anywhere near alert
acknowledge/resolve).

Per the brief, I left `ResolvedAlert.resolution: AlertResolution` (which includes `'manual'`)
unchanged even though no manual-resolve path broadcasts today — noting the gap here as
instructed, not fixing it. Task 13 will need to actually wire `userId` through when it builds the
Pusher publish path; today `handleUpdateAlert` has `userId` available but doesn't send anything
over Pusher.

## Verification

### Anti-vacuity: `__v` in both directions

Wrote 7 new tests (list/single-get/mutate × alerts and alert-rules; DELETE excluded, see item 4)
asserting `not.toHaveProperty('__v')`, using `Record<string, unknown>` — not typed against the
wire type — so the assertion is about the actual JSON, not a compile-time narrowing that could
hide the field.

**Revert direction** — ran the new tests against the *unmodified* routes first (before writing
any `.select('-__v')`/`versionKey` code) and confirmed all 7 fail, each showing the real
mechanism (`__v: 0` present, not just "some field missing"):

```
$ npx jest --selectProjects node ... -t "__v"
● ... should not expose the internal __v field
  Expected path: not "__v"
  Received value: 0
Tests: 7 failed, 2249 skipped, 2256 total
```

(All 7 failures showed `Received value: 0` — confirming `__v` was genuinely present, not that the
test was checking the wrong thing.)

**Restore direction** — after applying the `.select('-__v')` / `{ versionKey: false }` changes:

```
$ npx jest --selectProjects node ... -t "__v"
PASS __tests__/integration/api/alerts.integration.test.ts
PASS __tests__/integration/api/alert-rules.integration.test.ts
Tests: 7 passed, 2249 skipped, 2256 total
```

No existing test's assertions were changed or weakened — I grepped the whole tree for `__v`
before starting (`grep -rn "__v" __tests__/ app/api/v2/alerts app/api/v2/alert-rules types/v2`)
and found zero prior references, so there was nothing encoding the old (leaky) shape to disturb.
Every change to the two integration test files is a pure addition of new `it(...)` blocks.

### Anti-vacuity: type-level, `tsc` snippets

Type correctness is enforced by `tsc`, so I built two standalone snippets (not committed) —
verbatim copies of the pre-fix and post-fix type definitions — covering **four** previously
representable, always-schema-rejected states (the fourth is the create/update selector asymmetry
described above):

1. `metric: 'value'` with no `selector` key at all.
2. `metric: 'value'` with `selector: { types: [] }`.
3. `UpdateAlertRuleBody` with only `{ threshold: 5 }`.
4. `UpdateAlertRuleBody` with `{ metric: 'anomaly_score', comparison: 'gt', threshold: 0.5 }`,
   no `selector` key.

**Old types — all 4 compile clean** (`tsc --noEmit --strict --skipLibCheck`, exit 0, no output),
proving they were representable before:

```ts
const invalidCreate_noSelector: CreateAlertRuleBody = {
  name: 'High temp', metric: 'value', comparison: 'gt', threshold: 30, severity: 'critical',
};
const invalidCreate_emptyTypes: CreateAlertRuleBody = {
  name: 'High temp', metric: 'value', comparison: 'gt', threshold: 30, severity: 'critical',
  selector: { types: [] },
};
const invalidUpdate_partialCondition: UpdateAlertRuleBody = { threshold: 5 };
const invalidUpdate_missingSelectorNonValueMetric: UpdateAlertRuleBody = {
  metric: 'anomaly_score', comparison: 'gt', threshold: 0.5,
};
// $ tsc --noEmit --strict --skipLibCheck old-types-check.ts
// exit code: 0
```

**New types — each wrapped in `// @ts-expect-error`, whole file still exit 0.** `tsc` fails the
whole run if a `@ts-expect-error` line does *not* actually error ("Unused '@ts-expect-error'
directive"), so a clean exit here is proof — not assertion — that every one of the four states
now fails, while valid states (full 'value' condition, omitted selector on `anomaly_score`
create, explicit `selector: {}` on `anomaly_score` update, condition-free update, empty update)
still compile:

```
$ tsc --noEmit --strict --skipLibCheck new-types-check.ts   (with @ts-expect-error markers)
exit code: 0
```

Re-ran the same file with the `@ts-expect-error` markers stripped to capture the real
diagnostics:

```
new-types-check-noSuppress.ts(94,7): error TS2322: ... not assignable to type 'CreateAlertRuleBody'.
  Property 'selector' is missing in type '{ name: string; metric: "value"; ... }' but required
  in type '{ metric: "value"; ...; selector: ValueMetricSelector; }'.

new-types-check-noSuppress.ts(103,7): error TS2322: ... not assignable to type 'CreateAlertRuleBody'.
  The types of 'selector.types' are incompatible between these types.
    Type '[]' is not assignable to type '[ReadingTypeName, ...ReadingTypeName[]]'.
      Source has 0 element(s) but target requires 1.

new-types-check-noSuppress.ts(113,7): error TS2322: ... not assignable to type 'UpdateAlertRuleBody'.
  ... missing the following properties ...: metric, comparison, selector

new-types-check-noSuppress.ts(118,7): error TS2322: ... not assignable to type 'UpdateAlertRuleBody'.
  Property 'selector' is missing in type '{ metric: "anomaly_score"; comparison: "gt"; threshold: number; }'
  but required in type '{ metric: "anomaly_score"; ...; selector: AlertRuleSelector; }'.
```

Exactly one error per invalid statement, none on the valid ones — confirms the fix is neither
under- nor over-constrained. Snippets are in the scratchpad
(`/tmp/claude-1000/-home-yzel-github-infrasight/f4a9f31c-9ee3-4454-8794-1236ae4db1db/scratchpad/{old,new}-types-check.ts`),
not committed.

### Full suite / `tsc` / ESLint counts

| | Before | After | Delta |
|---|---|---|---|
| `npx jest --selectProjects node` | 2249 passed / 85 suites | **2256 passed / 85 suites** | +7 (new `__v` tests), 0 regressions |
| `npx tsc --noEmit` error count | 39 | **39** | 0 — `diff` of full output is byte-identical |
| ESLint total problems | 311 (308 err / 3 warn) | **311 (308 err / 3 warn)** | 0 — per-file diff shows zero files changed; all 7 touched files report 0/0 |

Ran the full suite and both linters twice — once right after the initial (buggy) implementation,
again after the self-review fix — to make sure the correction didn't regress anything either.
Both runs identical.

## Files changed

- `types/v2/alert.types.ts` — header comment (item 1), `ValueMetricSelector` +
  `CreateAlertRuleCondition` + `CreateAlertRuleBody` (item 3), `UpdateAlertRuleCondition` +
  `NoConditionUpdate` + `UpdateAlertRuleBody` (item 2), `ResolvedAlert` doc comment (item 6).
- `app/api/v2/alerts/route.ts` — caching comment (item 5), `.select('-__v')` on list (item 4).
- `app/api/v2/alerts/[id]/route.ts` — `.select('-__v')` on GET, `.toObject({versionKey:false})` on PATCH (item 4).
- `app/api/v2/alert-rules/route.ts` — `.select('-__v')` on list, `.toObject({versionKey:false})` on POST (item 4).
- `app/api/v2/alert-rules/[id]/route.ts` — `.select('-__v')` on GET and PATCH (item 4).
- `__tests__/integration/api/alerts.integration.test.ts` — 3 new `__v` tests (list, GET, PATCH).
- `__tests__/integration/api/alert-rules.integration.test.ts` — 4 new `__v` tests (list, POST, GET, PATCH).

No barrel changes: `types/v2/index.ts` still re-exports exactly the six names the brief named
(`AlertRuleV2Response`, `CreateAlertRuleBody`, `UpdateAlertRuleBody`, `ListAlertRulesQueryParams`,
`AlertV2Response`, `ListAlertsQueryParams`, `AlertEvent`, plus existing enums/nested types). The
new helper types (`ValueMetricSelector`, `CreateAlertRuleCondition`) are exported from
`alert.types.ts` itself (consistent with the file's existing convention of exporting every named
interface, even ones only used internally) but not added to the barrel, since nothing outside
this file needs to import them by name yet and the brief scoped this to items 1-6 only.
`UpdateAlertRuleCondition` and `NoConditionUpdate` are intentionally unexported — pure
implementation detail of `UpdateAlertRuleBody`, mirroring how `ConditionShape` is unexported in
`alert-rule.validation.ts`.

## Self-review findings

1. **Real bug found and fixed**: the shared `AlertRuleCondition` union (selector optional on
   `anomaly_score`/`battery_level`) was correct for create but wrong for update, per the
   `.default({})` vs `.optional()` asymmetry described above. Fixed by splitting into
   `CreateAlertRuleCondition` and `UpdateAlertRuleCondition`. This is the kind of drift the task
   exists to prevent, and I caught it only by re-checking against the live schema rather than
   trusting my first reading of it — worth calling out since it's exactly the failure mode this
   branch has had before (plausible-looking type that doesn't match the schema).
2. Checked every comment I wrote against something I could point to directly: the caching
   rationale cites the actual call sites and the actual `CACHE_PREFIXES` object; the `actor`
   comment cites the actual `getAuditUser` source line; the header comment was verified by
   grepping `pusher-context.tsx` for zero "alert" occurrences.
3. Confirmed my diff doesn't touch anything from the two commits called out as sensitive
   (`2879d08` touches `lib/alerting/index.ts`, `readings/ingest/route.ts`, `cron/simulate/route.ts`
   and their tests; `2480e01` touches `cron/simulate/route.ts` and its test) — zero file overlap
   with my 7 changed files.
4. Confirmed no existing consumer breaks: grepped `lib/api/v2-client.ts` and `lib/query/hooks/`
   for any alert-rule/alert-response consumer; the only `alerts` hit in `v2-client.ts` is
   `HealthMetrics.alerts`, an unrelated field on the health-analytics response shape. No UI, hook,
   or client wrapper references any of the six named types yet, matching the brief's premise.

## Known, deliberate gaps (not fixed — out of scope per the brief)

- `UpdateAlertRuleBody` still type-checks `{}` (empty object) even though
  `updateAlertRuleSchema`'s "at least one field must be provided" refine rejects it at runtime.
  The brief's item 2 only asked to fix the atomic-condition-group problem, not "at least one
  field overall" — the latter would require encoding "at least one of N independently-optional
  keys" in TypeScript, which is disproportionate for a wire-type file styled around explicit,
  readable arms rather than mapped-type gymnastics. Flagging in case a future task wants it.
- `ResolvedAlert.resolution` includes `'manual'`, which no current code path can produce (no
  manual-resolve broadcasts today) — left as-is per explicit brief instruction; Task 13 needs to
  actually use `userId` (not `auditUser`) when it wires that path.
- Threshold bounds (`anomaly_score` ∈ [0,1], `battery_level` ∈ [0,100]) are documented on the
  union arms but not enforced by TypeScript, per the brief ("TypeScript has no refinement
  types").

## Concerns

None blocking. The one substantive risk — the create/update `selector` asymmetry — was caught
during self-review and fixed before this report, with the fix itself verified against the live
Zod schema (not just re-reading the source) and against `tsc`.
