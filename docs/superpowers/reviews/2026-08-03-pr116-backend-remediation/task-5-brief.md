## Task 5: Make alerting failures observable

**Files:** `lib/alerting/index.ts`, `app/api/v2/readings/ingest/route.ts`,
`app/api/v2/cron/simulate/route.ts`

`lib/monitoring/metrics.ts:185` states the error counter is "the only signal that alerting has
silently stopped working." That signal is unreachable in production:

- `logger.error` is `console.error` only (`lib/monitoring/logger.ts:124`).
- `captureException` is exported from `@/lib/monitoring` — the same barrel these wrappers
  already import from — and is never called by any alerting code. Repo-wide it is used only in
  `instrumentation.ts` and `app/global-error.tsx`, neither of which sees a swallowed error.
- The counter is a module-level object, so it resets on every serverless cold start.
- `/api/v2/metrics` requires a Clerk admin session (which no Prometheus scraper can present)
  **and** `ENABLE_METRICS=true`, which `example.env:57` ships as `false`.

Net: the evaluator can throw on every batch, ingest keeps returning 201, `alerts_v2` stops
growing, and the only trace is a console line.

Required:

1. Both `safeEvaluateReadings` and `safeSweepStaleAlerts` call
   `captureException(error, { tags: { subsystem: 'alerting' } })` alongside the existing log and
   counter. Keep the wrappers non-throwing — if `captureException` itself can throw, guard it.
2. Both call sites capture the returned result instead of discarding it, and log at `info` when
   `fired.length || resolved.length`, including the affected rule ids and device ids. An alert
   firing is currently the only domain event in the subsystem that is never logged; the rule
   mutation routes already log properly.
3. Do not change either route's response body or status — alerting is not part of their
   contract, and Global Constraint on failure isolation still holds.

### Tests

- `captureException` is called when the evaluator throws, and when the sweep throws.
- The `evaluation_error` counter increments, asserted via `getMetricsSnapshot()`.
- Both write paths still succeed when the evaluator throws (this is the existing isolation
  guarantee — do not regress it).

---

