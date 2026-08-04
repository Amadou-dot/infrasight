# PR #116 backend remediation — working record

Records from the multi-agent review of [PR #116](https://github.com/Amadou-dot/infrasight/pull/116) (the Phase 4 alerting backend) and the ten-task effort that fixed what it found. Kept because the *reasoning* behind several decisions is not recoverable from the diff.

**Outcome:** all 4 Critical and 7 Important findings fixed across 15 commits (`c5395ff..fe875d7`), plus a merge of `main` (`35a247a`).

| | Before | After |
|---|---|---|
| Tests (node) | 2173 | 2272 |
| Tests (node + jsdom) | — | 2433 / 98 suites |
| `npx tsc --noEmit` | 39 errors | 0 |
| `pnpm lint` | 311 problems | 0 |

The tsc/lint numbers went to zero because `main`'s `b43468d` cleanup was merged in, not because this work fixed them — it was held to "add nothing to the baseline" throughout.

## Where to start

**[`progress.md`](progress.md)** — the ledger, and the most useful file here. One entry per task with the mutations that were run, every deferred item, and every adjudicated ruling with its reasoning. Read this if you read nothing else. It also records one ruling whose stated reason was later proven wrong (see below).

**[`plan.md`](plan.md)** — the ten-task plan the work was driven from, including its Global Constraints and an explicit *Out of scope* section listing what was deliberately not touched.

**Per task:** `task-N-brief.md` is the requirements handed to a fresh implementer; `task-N-report.md` is what came back, including mutation evidence in both directions.

| Task | Subject |
|---|---|
| 1 | Sweep bulk-write reconciliation + stale-resolve race |
| 2 | Evaluator bulk-write reconciliation |
| 3 | Per-rule error boundary |
| 4 | `for_duration_seconds` symmetry |
| 5 | Sentry reporting + call-site logging |
| 6 | Cron path evaluates only persisted readings |
| 7 | Index shape verification (2 fix rounds) |
| 8 | Wire contract accuracy |
| 9 | Write-path integration test gaps |
| 10 | Evaluator and model test gaps |

## The parts worth re-reading

Each task was implemented by a fresh agent, reviewed by an independent one, and separately mutation-tested by the controller. The reports where that process caught something are the interesting ones:

- **Task 2** — a fix round was needed because both `recordAlert` calls could be deleted with the entire suite staying green. The counters were tested in isolation but never through their callers.
- **Task 7** — the first attempt's tests were named `[the fix, verified]` and passed with the fix deleted, because they exercised the mechanism via their own connections instead of the shipped code path. Replaced with a real subprocess run of the CLI. This task's reviewer also found, by testing against a live `mongod`, that `verify-indexes` was *creating the index it was checking for*.
- **Task 8** — the implementer caught a bug in its own first draft: a shared create/update discriminated union, which is the obvious design and is wrong, because `createAlertRuleSchema` defaults `selector` and `updateAlertRuleSchema` does not.
- **Task 10** — reported that an assertion the brief asked for *cannot fail* (Mongoose casts a string `rule_id` to an ObjectId regardless), rather than banking a test that looks like protection and provides none.

Three separate times, a test specified in a brief turned out to prove less than its name claimed. That pattern is the main lesson in here.

## Not included

The 15 `review-*.diff` files are omitted — they are plain `git diff` output between commits that are all on `origin`. Regenerate any of them with:

```
git diff -U10 <base>..<head>
```

The commit range for the whole effort is `c5395ff..fe875d7`; per-task ranges are in `progress.md`.

## Known follow-ups

None blocking; a final whole-branch review over all 15 commits found no must-fix items. The full triage is at the end of `progress.md`. The ones most worth acting on:

1. A malformed non-metric rule field (`name`, `severity`) can still abort the whole evaluation batch — the same fleet-wide failure the per-rule boundary closed, through a different door.
2. `sortBy=severity` sorts lexically, so descending returns `warning → info → critical`. Pinned by a test rather than silently changed; resolve before any UI exposes the sort control.
3. Pusher still broadcasts unpersisted readings on the cron path. Bounded and self-correcting, but it leaves the route's own comment false.
4. Mongoose's `autoIndex` aborts its batch on the first failure, so in a correctly-provisioned deployment it builds **none** of `AlertV2`'s six indexes. It is not a safety net — which argues for putting `verify-indexes` in CI.

## One correction

`progress.md` records a ruling deferring an explicit `name` on `AlertV2`'s dedup index, justified on the grounds that existing deployments already carry a duplicate auto-named index. **That reason is wrong** — MongoDB refuses to create a second index with the same key and options under a different name, so a duplicate cannot exist. The final review established this by testing both deployment orderings against a real `mongod`. The deferral still stands on other grounds; the stated reason does not. Left in place rather than edited, because a ledger that gets quietly corrected after the fact is worth less than one that records what was actually believed at the time.
