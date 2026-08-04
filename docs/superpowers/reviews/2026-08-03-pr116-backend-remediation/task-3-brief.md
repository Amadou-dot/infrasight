## Task 3: Per-rule error boundary in the evaluator

**File:** `lib/alerting/evaluate.ts` (plus a metric if one is needed)

`METRIC_ACCESSORS[rule.metric](reading)` at `:127` is typed as a total
`Record<AlertMetric, fn>`, but `rule.metric` reaches it from a `.lean()` read or a Redis JSON
round trip — neither re-validates. Any value outside `value | anomaly_score | battery_level`
makes this `undefined(reading)` → `TypeError`. `new Types.ObjectId(rule._id)` at `:171` and
`:244` throws `BSONError` on a non-hex string the same way.

The only catch is the outermost wrapper in `lib/alerting/index.ts`, so **one malformed rule
aborts evaluation for every rule, every device, and every reading in the batch** — and since
rules change almost never, for every subsequent batch too. Not transient: permanent, silent,
fleet-wide. Reachable from a seed or migration script writing directly, or a stale cache entry
written before a schema change.

Required:

1. A rule that throws during matching or metric extraction must be skipped, with evaluation
   continuing to the next rule. Scope the boundary so one bad rule cannot take out the batch.
2. Guard the accessor lookup explicitly rather than relying on the catch: if
   `METRIC_ACCESSORS[rule.metric]` is not a function, skip that rule.
3. Guard the two `new Types.ObjectId(rule._id)` conversions so an invalid rule id skips the
   rule instead of aborting the batch.
4. Log each skipped rule with `{ ruleId, ruleName, metric, error }` at `error` level, and count
   it. Add a counter to `lib/monitoring/metrics.ts` if no suitable one exists — follow the
   existing `recordAlert` shape and export it through `lib/monitoring/index.ts`.
5. Do not log once per reading — a fleet-wide bad rule would flood the log. Log at most once per
   rule per evaluation call.

### Tests

- A batch containing one rule with an unknown `metric` and one valid rule: the valid rule still
  fires, and the batch is not aborted.
- A rule with a non-hex `_id`: same expectation.
- The failure counter increments, asserted via `getMetricsSnapshot()`.

Verify each fails without the boundary.

---

