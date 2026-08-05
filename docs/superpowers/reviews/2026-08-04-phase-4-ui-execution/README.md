# Phase 4 alerting — UI execution record (Tasks 12–20 + final review)

Working record for the second half of the Phase 4 alerting plan, executed with
`superpowers:subagent-driven-development`. The backend half (Tasks 1–11) and its
remediation are recorded in `../2026-08-03-pr116-backend-remediation/`.

**Outcome:** 20/20 tasks. PR #116. 62 commits, 2616 tests / 115 suites, all four
gates strict and clean.

## Contents

- `progress.md` — the controller ledger. Every task's commit range, every human
  ruling, every deferred minor, and the reasoning behind each parked finding.
- `task-*-brief.md` / `task-*-report.md` — per-task requirements and implementer reports.
- `deferred-minors.md` — the triage list handed to the final whole-branch review.
- `final-review-fixes-report.md` — the single fix wave that closed the final review.

Review packages (`review-*.diff`) are omitted; `git log` is the record.

## What this phase is worth reading for

**Nine tests shipped green while asserting nothing real**, and each was caught by a
different mechanism. The taxonomy:

1. A short-circuit returned before the code under test was reached.
2. A `jest.spyOn` on a barrel re-export never intercepted the direct import binding.
3. A payload omitted a required field, so validation rejected it before the feature ran.
4. A claimed behaviour had no test at all.
5. A test mocked the very hook it claimed to exercise.
6. Assertions read stdout while the script wrote to stderr.

Writing *"would this fail if the behaviour it names were deleted?"* into every review
prompt, with concrete examples, is what turned these up. Later reviewers began
verifying independently rather than accepting reports — one compiled a module through
the TypeScript API to prove a spy was live, another reproduced MongoDB's index-conflict
rules against a throwaway instance, a third read Mongoose's `applyDefaults` source.

**The plan had more defects than the implementations did.** Roughly twenty corrections
landed on the plan during execution, against seven task fix rounds. Two plan defects
were self-contradictions — Task 15 mandated one admin-gating pattern while Task 17
mandated another; Task 14's Step 0 made a field required that Step 1's own sample code
omitted.

**The most valuable findings were the ones no individual task could see.** The final
whole-branch review found a Critical the twenty task reviews structurally could not:
the Pusher payload had been hardened against leaking an operator's email, but the REST
endpoint returning the same field to the same anonymous demo visitor had not.
