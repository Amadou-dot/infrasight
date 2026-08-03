# Phase 4 Alerting — Handoff (INCOMPLETE)

> **This branch is not finished and must not be merged.** 11 of 20 planned tasks are done.
> The backend is complete and tested; **there is no user interface at all**, so the feature
> is invisible to anyone using the app. See "What is left" below.

**Branch:** `feat/phase-4-alerting`, cut from `main` at `539181d`.
**Design:** `docs/superpowers/specs/2026-08-01-alerting-subsystem-design.md` (on `docs/phase-4-alerting-design`)
**Plan:** `docs/superpowers/plans/2026-08-01-alerting-subsystem.md` (same branch — **read this before continuing**; it has the complete code for every remaining task)

---

## What works right now

The alerting subsystem is live end-to-end on the server. Alerts are being created by real
ingest and cron traffic, and all eight new endpoints respond.

| Area | State |
| --- | --- |
| `AlertRuleV2` + `AlertV2` models, 8 indexes | done |
| Zod validation + client-safe wire types | done |
| Rule cache (60s, global key) + 4 Prometheus series | done |
| Selector matching, metric accessors | done |
| Evaluator (breach-aware, index-enforced dedup) | done |
| Staleness sweep + failure-isolating wrappers | done |
| Wired into **both** write paths | done |
| `/api/v2/alerts` + `/api/v2/alerts/[id]` | done |
| `/api/v2/alert-rules` + `/api/v2/alert-rules/[id]` | done |
| **Any UI** | **not started** |
| **Pusher delivery** | **not started** |
| **Seeded rules** | **not started** |

v2 API is now 33 endpoints (was 25). Test suite: **2362 passing** (was 2173 at branch point).

## What is left — Tasks 12–20

Work them in order; each has complete code in the plan. Dependencies:

```
Task 12 (API client + React Query hooks)  ─┐
Task 13 (Pusher notify, bounded payload)  ─┴─→ Task 14 (usePusherAlerts + toasts)
                                                      │
                        Task 15 (badges, AlertList, /alerts) ←┘
                                │
                                ├── Task 16 (/alerts/[id] detail page)
                                ├── Task 17 (/alerts/rules management UI)
                                └── Task 18 (AnomalyPanel rename, dashboard widget, TopNav)
                                             │
                                 Task 19 (seed rules) → Task 20 (E2E)
```

Task 20 must be last — it needs a seeded database and every route in place.

### Two things in the remaining work that are easy to get wrong

- **Task 18 renames `components/AlertsPanel.tsx`, it does not delete it.** Issue #99 and the
  parent design both call it orphaned. **That is stale.** It is imported at
  `app/analytics/page.tsx:5` and rendered at `:84`. Deleting it breaks the build. Re-grep
  before touching it.
- **Task 14 deviates from the plan's "copy the existing hook shape verbatim" instruction, by
  human ruling.** Both `usePusherAlerts` *and* the existing `usePusherReadings` must move their
  ref assignment into a commit-phase effect. The existing shape is one of the baseline lint
  errors (`lib/pusher-context.tsx | react-hooks/refs`); copying it would add a second instance.
  Expect `lintcheck` to report **310** after Task 14, not 311.

---

## Environment notes for whoever picks this up

### The two verification gates are NOT the raw commands

`npx tsc --noEmit` and `pnpm lint` have **never** been clean on this repo. The branch starts
with **39 pre-existing type errors** (all inside `__tests__/`, invisible to ts-jest because it
runs `isolatedModules` and does not typecheck) and **311 pre-existing lint problems**.

Use these instead — they diff against a recorded baseline and fail only on *additions*:

```bash
./.superpowers/sdd/2026-08-01-alerting-subsystem/tscheck
./.superpowers/sdd/2026-08-01-alerting-subsystem/lintcheck
```

`tscheck` normalizes away line:column so the baseline does not drift when you shift lines in a
file that already carries baseline errors. **Never edit the baseline files** — that is how a
real regression gets hidden.

If the `.superpowers/` directory is gone (it is git-ignored scratch, and `git clean -fdx`
destroys it), regenerate:

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | sed -E 's/\(([0-9]+),([0-9]+)\)//' | sort > tsc-baseline-sorted.txt
```

`pnpm build` and `pnpm test` **are** clean at baseline and stay strict — a failure there is
genuinely yours.

### Local database for Tasks 19–20

Tasks 19 and 20 need a real database (`pnpm seed`, Playwright). A Docker container is running:

```
docker start infrasight-phase4-mongo     # mongo:7, replica set rs0, port 27018
```

The worktree's `.env.local` already points at it. `scripts/v2/seed-v2.ts` refuses to wipe a
non-local target without `--force`, which is why the local container matters.

Jest itself needs **no** external database — `__tests__/setup/globalSetup.ts` starts
mongodb-memory-server and injects mock Pusher credentials.

---

## Open decision for a human

**Ingest path evaluates readings that may not have persisted.** *(Task 9, Important,
plan-mandated — parked, not fixed.)*

`app/api/v2/readings/ingest/route.ts` builds `validReadings` **before** the batch-insert loop
and never prunes it to the successfully-inserted subset. Evaluation is gated on
`results.inserted > 0` — "at least one insert succeeded" — not "these specific readings
succeeded". So on a partial batch failure, a reading that was never written can still fire an
alert, and an operator investigating it would find no corresponding row in `readings_v2`.

The plan's Task 9 code mandates exactly this, which is why it was parked rather than fixed.

*Assessment:* real, but low severity. Zod validates upstream so partial `insertMany` failure is
rare; timeseries collections have no unique constraints to collide on; and the consequence is a
spurious alert that auto-resolves on the next in-bounds reading. The fix means zipping
`validReadings` against `insertMany`'s acknowledged docs and `bulkError.insertedIds` across two
existing failure branches — real complexity in a loop that already has two failure paths.

**Recommendation: leave it.** But it is a judgment call, and it is recorded here so it is not
silently lost.

---

## Deferred minor findings

None block merge; the final whole-branch review should triage them.

- `AlertRuleV2`: `pre('save')` branch untested; no negative test for an invalid `selector.types`.
- `AlertV2`: `acknowledge()` redundantly `$set`s `is_open: true`; no `pre('findOneAndUpdate')`
  hook, so a future direct update bypassing the statics would not bump `audit.updated_at`.
- Validation: selector tag rules hand-duplicated rather than sharing an un-defaulted helper;
  `typesRequiredForValueMetric` untested via the update path; atomic-group error always anchors
  to `path: ['metric']`.
- Cache/metrics: `clearAllCaches()` does not `del(alertRulesKey())` despite its docstring;
  redundant `beforeEach`; the nested `alerts` metrics group lacks a JSDoc.
- Selector: `compare()` uses `default: return false` rather than a `never` exhaustiveness guard.
- Rule cache: no test asserts `ruleCount === rules.length` for a non-empty set.
- Evaluator: `recordAlert('fired'/'resolved')` is incremented **before** `bulkWrite`, so it is
  not reconciled against `failedIndices` — under a concurrent E11000 race both callers count a
  fire though only one document is created. Persisted state and Pusher notifications *are*
  correctly guarded; only counter precision is affected. Also, the readings/devices-empty early
  return skips `recordAlertEvaluationDuration`.
- Sweep: `STALE_AFTER_SECONDS` `parseInt` has no `NaN` guard — a malformed
  `ALERT_STALE_AFTER_SECONDS` silently disables the staleness check (device-inactive detection
  still works).
- Task 9: `CronDevice` declares `metadata.department` required though the projection returns
  only `tags`; ingest uses a double-`unknown` cast; no failure-injection test on the cron path.
- Task 10: `if (note)` discards an explicit `note: ''` so a caller cannot clear a note;
  `audit.updated_at` bumped twice when a note is supplied.
- Task 11: PATCH sets `audit.updated_at` explicitly though the model hook already does;
  atomic-group 400 test only covers `{ threshold }` alone.

---

## Notes to my future self

**The plan had more defects than the implementations did.** Eleven tasks produced nine
corrections to the plan, all committed to `docs/phase-4-alerting-design` as they were found, so
the plan and the code have not drifted:

| Commit | Defect |
| --- | --- |
| `65821fb` | Gates assumed a clean `tsc`/`lint` baseline; neither has ever been clean |
| `b7dacde` | Mongoose gives array paths an implicit `[]` default — broke the fleet-wide rule |
| `b7dacde` | `Types` imported as a value in two model files though only used as a type |
| `77ca206` | `AlertInput.rule_id: unknown` collapses to `never` against Mongoose overloads |
| `394efbc` | Generic `multiValue<T>` loses literal types under Zod 4 |
| `8b7d21d` | An unanchored `sed` of mine corrupted a second task's test count |
| `e3ac047` | **Sweep `deleteMany` race that could destroy a fired alert** |
| `e3ac047` | Vacuous swallow test — short-circuited before reaching the mocked throw |
| `5b519a6` | Vacuous isolation test — spied a re-export binding that never intercepted |
| `5b48342` | Date range filtered `audit.created_at`, not the `fired_at` domain event |
| `b61a265` | `readingTypeSchema` cast erased the literal union, breaking route compilation |

**The recurring failure mode is tests that pass for the wrong reason.** Four shipped in this
phase. Every one looked green forever:

1. A short-circuit returned before the code under test was reached.
2. A spy on a barrel re-export never intercepted a direct import binding.
3. A payload omitted a required field, so validation rejected it before the feature ran.
4. A filter shipped with no test at all.

I started writing *"does this test fail for its stated reason?"* directly into every review
prompt, with those four examples. The last three reviewers went and traced it independently —
one dropped to compiled JS to prove a `jest.spyOn` on a re-exported symbol was genuinely live.
**Keep doing this.** When adding a negative test, assert on the specific error `code`, not the
status; a 403 that is really a 400 is indistinguishable otherwise.

**Model tiering that worked.** Tasks whose plan text carries complete code are transcription:
haiku did Tasks 5, 6 and 8 at roughly 50k tokens each versus sonnet's ~120k, and reviewers
specifically asked to look for sloppiness found none. Anything with integration surface,
prose-described steps, or subtle interacting logic (the evaluator, the route wiring) went to
sonnet. Scoped re-reviews are cheap — haiku closes them in about three tool calls.

**Carry observations across task boundaries in writing.** Task 7's reviewer noticed that an
`updateOne` matching zero documents escapes the `writeErrors` filter and flagged it as a Task 8
concern. I put it in the ledger and pasted it into Task 8's review prompt. That reviewer used
it to confirm the resolve paths were tolerable *and* to find that the delete path was not — the
data-loss bug in `e3ac047`. That chain only worked because the note survived two task
boundaries on disk.

**Two session limits hit mid-implementation** (Tasks 1 and 8), both during the implementer's
run. The ledger made each recoverable as a precise resume — "these files landed, this one is
missing, nothing is committed" — rather than a restart. Keep writing state down before it is
needed.

**Full detail** lives in `.superpowers/sdd/2026-08-01-alerting-subsystem/progress.md` (git-ignored,
present in the worktree at `/home/yzel/github/infrasight-phase4`), including per-task commit
ranges, every controller ruling, and the reasoning behind each parked finding.
