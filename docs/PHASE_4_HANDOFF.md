# Phase 4 Alerting — Handoff & Retrospective

**Status: complete.** All 20 planned tasks are done. This document is a
completion summary plus the retrospective notes accumulated during
implementation — the retrospective is the part worth reading even after the
phase itself is history, and is the main reason to keep this file at all.

**Branch:** `feat/phase-4-alerting`, cut from `main` at `539181d`.
**Design:** `docs/superpowers/specs/2026-08-01-alerting-subsystem-design.md` (on `docs/phase-4-alerting-design`)
**Plan:** `docs/superpowers/plans/2026-08-01-alerting-subsystem.md` (same branch)

---

## What shipped

The alerting subsystem is live end-to-end: server-side evaluation, real-time
delivery, and a full UI, all backed by real ingest and cron traffic.

| Area | State |
| --- | --- |
| `AlertRuleV2` + `AlertV2` models, 8 indexes across the two collections | done |
| Zod validation + client-safe wire types | done |
| Rule cache (60s, global key) + Prometheus series | done |
| Selector matching, metric accessors | done |
| Evaluator (breach-aware, index-enforced dedup) | done |
| Staleness sweep + failure-isolating wrappers | done |
| Wired into both write paths (ingest, cron/simulate) | done |
| `GET /api/v2/alerts` + `GET`/`PATCH /api/v2/alerts/[id]` | done |
| `GET`/`POST /api/v2/alert-rules` + `GET`/`PATCH`/`DELETE /api/v2/alert-rules/[id]` | done |
| Pusher real-time delivery (`lib/alerting/notify.ts`, `usePusherAlerts`, `AlertToaster`) | done |
| `/alerts`, `/alerts/[id]`, `/alerts/rules` pages + nav badge | done |
| Seeded alert rules (`scripts/v2/alert-rule-seeds.ts`) | done |

v2 API is now **33 endpoints** (was 25 at the branch point — the alerting
subsystem added 8: `alerts` list/get/patch, `alert-rules` list/create/get/
patch/delete).

Test suite: **2598 passing / 115 suites**.

Gates are strict and clean: `npx tsc --noEmit` 0 errors, `pnpm lint` 0
problems, `pnpm build` clean.

---

## Environment notes

Tests need no external database — `__tests__/setup/globalSetup.ts` starts
`mongodb-memory-server` and injects mock Pusher credentials, so `pnpm test`
runs standalone.

For manual verification against a real database (`pnpm seed`, Playwright), a
local MongoDB container works well:

```bash
docker run -d --name infrasight-mongo -p 27018:27017 mongo:7 --replSet rs0
```

Point `.env.local`'s `MONGODB_URI` at it. `scripts/v2/seed-v2.ts` refuses to
wipe a non-local target without `--force`, which is why a local container
matters for iterating on seed data.

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

> **Update from the final whole-branch review (2026-08-04):** the same failure mode kept
> showing up at cross-cutting scale, not just per-task — nine tests across the phase shipped
> green while asserting nothing real, adding a fifth pattern to the four above: assertions
> reading stdout when the code under test wrote to stderr, and a test mocking the very hook it
> claimed to exercise. The check that catches all five is the same one: delete the line the test
> names, confirm the test goes red, then restore. If it doesn't go red, the test was never
> testing that line.

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

---

## Known deferred items

A final whole-branch cross-cutting review (2026-08-04) covered every task in this phase together
rather than in isolation, and fixed one Critical, six Important, and four Minor issues it found
in the process — see that review's own report (in the same directory as this file) for detail,
including which of the fixes needed a database migration or a seed-script change. It also
explicitly triaged the following as fine to carry rather than fix:

- The dead `forDurationSeconds` prop on `AlertDetailView`.
- `clearAllCaches()` not clearing the alert-rules cache key.
- The severity aggregation's lack of a supporting index.
- The `rows.length < PAGE_SIZE` pagination heuristic.
- 33 same-named wire/Zod type pairs with no conformance test — a separate, mechanical PR; a
  conformance test would also surface pre-existing drift in `ListDevicesQuery`, expanding scope
  unpredictably.
- A known pre-existing intermittent flake in
  `__tests__/integration/api/device-history.integration.test.ts` under heavy parallel load,
  unrelated to this branch.

Earlier per-task deferral notes written during individual task reviews are superseded by this
list — several had already been fixed, reprioritized, or found to be inaccurate by the time the
final review ran, so they are not reproduced here. Carrying a stale "known issues" list forward
is the exact failure mode that made this file need rewriting in the first place.
