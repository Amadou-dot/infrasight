# Infrasight — Alerting Subsystem Design

**Date:** 2026-08-01
**Status:** Approved (revised after review)
**Milestone:** Phase 4 — Alerting (issues #95–#100)
**Parent:** [`2026-07-30-portfolio-completeness-design.md`](2026-07-30-portfolio-completeness-design.md)

## Goal

Give Infrasight the thing that separates an operations tool from a dashboard: a way to say
"tell me when this happens", and a workflow for the human who gets told.

Phase 4 introduces two collections, an evaluation path on every write, four lifecycle
states, eight API endpoints, and a real-time notification surface. This document resolves
the design; #96 through #100 implement it.

## Current state

Three findings shape everything below. All were verified against the code, not assumed.

**C1 — There is no anomaly detector.** `quality.is_anomaly` is a label the *simulator*
assigns at generation time (`lib/simulation/readings.ts:132`, `:282`): it rolls a die,
decides the reading is anomalous, and *then* generates a value from the anomalous range.
`GET /api/v2/analytics/anomalies` queries `quality.is_anomaly: true`, so it is reporting
the simulator's own coin flips back to us. Nothing derives anomaly from observed data.

**C2 — The real ingest path can never produce an anomaly.**
`app/api/v2/readings/ingest/route.ts:85` hardcodes `is_anomaly: false` and
`anomaly_score: 0` for every ingested reading. A genuine sensor feed through the public
ingest API would show zero anomalies forever.

**C3 — Production data does not flow through the ingest path.** Every reading in the live
deployment arrives via `GET /api/v2/cron/simulate`, which calls
`ReadingV2.bulkInsertReadings()` directly (`app/api/v2/cron/simulate/route.ts:59`) and
never touches `/api/v2/readings/ingest`. Issue #97 as originally written — "evaluate on
the ingestion path" — would have produced code that never executes in the deployed demo.

C3 is the reason evaluation is specified at *both* write paths below. C1 and C2 are the
reason alerting is threshold-based and owns its own signal rather than building on
`is_anomaly`.

## Architecture

```
POST /api/v2/readings/ingest ─┐
                              ├─→ insertMany (committed) ─→ evaluateReadings() ─→ AlertV2 bulkWrite ─→ Pusher
GET  /api/v2/cron/simulate ───┘                                    ↑
                                                            AlertRuleV2 (cached)
```

Evaluation is a pure-ish function in `lib/alerting/` called by both write paths after
their insert has committed. It owns no scheduler, no queue, and no second state store.

### Why inline at both write paths

A scheduled sweep would decouple alerting from the write path and make duration
thresholds trivial, but it adds a second external scheduler dependency to a project whose
only scheduler is an n8n webhook, and it delays every alert by up to one sweep interval.
Inline evaluation fires on the same request that produced the reading, and because it runs
*after* the insert commits, it cannot affect data durability.

The cost is that a device which stops reporting stops being evaluated. That gap is closed
by a narrow sweep on the cron path, specified in "Resolution and staleness" below.

## The AlertRule model

`models/v2/AlertRuleV2.ts`, collection `alert_rules_v2`. `_id` is an ObjectId — rules are
created through the API and have no external identity, so the `DeviceV2` custom-string
convention does not apply. `ScheduleV2` is the right precedent here.

```typescript
{
  _id: ObjectId,
  name: string,                    // required, max 200
  description?: string,            // max 1000
  enabled: boolean,                // default true

  selector: {
    types?: ReadingType[],         // absent or empty = all types
    building_id?: string,
    floor?: number,
    zone?: string,
    tags?: string[],               // device matches if it has ALL listed tags
  },

  metric: 'value' | 'anomaly_score' | 'battery_level',
  comparison: 'gt' | 'gte' | 'lt' | 'lte',
  threshold: number,
  for_duration_seconds: number,    // default 0, max 86400
  severity: 'info' | 'warning' | 'critical',
  cooldown_seconds: number,        // default 300, max 86400

  audit: {
    created_at, created_by, updated_at, updated_by,
    deleted_at?, deleted_by?,      // soft delete, DeviceV2 convention
  }
}
```

### Declarative selector, not a device list

`ScheduleV2` takes an explicit `device_ids[]` array, and mirroring it would have been the
smaller change. It is the wrong shape here. With 500 seeded devices, a fleet-wide
temperature rule would mean enumerating 500 ids, and every device created afterwards would
be silently uncovered — the failure mode where an alerting system quietly stops covering
the thing you added it for.

A selector resolves to a device set at evaluation time, so coverage is a property of the
rule rather than a snapshot taken when it was written.

### `selector.types` is a plural optional array

An earlier draft made a single `selector.type` mandatory, on the theory that it was also
the grouping key that keeps matching cheap. That was wrong for two of the three metrics.
`battery_level` is a *device* property and `anomaly_score` is unit-free; both are
meaningful across the whole fleet. Forcing such a rule to name one of fifteen types would
silently cover a fifteenth of the devices it was written for — precisely the
silent-uncoverage failure the previous section argues against, and the seed set includes
exactly such a rule.

`types` is therefore an optional array, absent meaning "all types". The grouping property
is preserved by building the `Map<ReadingType, AlertRuleV2[]>` once per cache refresh
rather than per reading: a type-less rule is appended to every bucket at build time, so
matching remains O(readings × rules-for-that-type) at evaluation.

Validation requires a non-empty `types` when `metric === 'value'`, because a bare value
threshold across mixed units is meaningless — `30` is a reasonable temperature ceiling and
an absurd power one. `anomaly_score` and `battery_level` may omit it.

### Metrics

Three metrics, each a direct field read off the reading being evaluated — no derived
quantities, no lookback windows:

| Metric | Source | Range | `types` required |
| --- | --- | --- | --- |
| `value` | `reading.value` | unit-dependent | yes |
| `anomaly_score` | `reading.quality.anomaly_score` | 0–1 | no |
| `battery_level` | `reading.context.battery_level` | 0–100 | no |

Implemented as a `METRIC_ACCESSORS` lookup so adding a fourth is one line. Validation
bounds thresholds per metric: `anomaly_score` to 0–1, `battery_level` to 0–100, `value`
unconstrained. A reading whose metric field is absent is skipped, not treated as zero.

Exposing `anomaly_score` as a rule metric is the entire coupling between alerting and the
existing anomaly endpoint. The endpoint is not modified, not deprecated, and not read by
the alerting path.

### Soft delete

Alerts reference their rule. Hard-deleting a rule would orphan the history that justifies
every alert it ever raised, so `DELETE /api/v2/alert-rules/[id]` sets `audit.deleted_at`
and `findActive()` excludes deleted rules, exactly as `DeviceV2` does. `enabled: false` is
the reversible off switch; deletion is the permanent one.

### Indexes

```typescript
{ enabled: 1, 'audit.deleted_at': 1 }   // the actual load predicate
{ 'audit.created_at': -1 }              // list default sort
```

The load query is `{ enabled: true, 'audit.deleted_at': { $exists: false } }`, matching
`DeviceV2.findActive` (`models/v2/DeviceV2.ts:381`) — `$exists: false`, not `null`. An
earlier draft indexed `{ enabled, 'selector.type' }` and called it "the evaluation hot
path", which was wrong: rules are loaded wholesale and grouped in memory, so
`selector.types` is never a query predicate.

## The Alert model

`models/v2/AlertV2.ts`, collection `alerts_v2`. One document per *episode*: a continuous
stretch during which one rule is breached on one device.

```typescript
{
  _id: ObjectId,
  rule_id: ObjectId,
  rule_name: string,               // denormalized — history survives a rename or delete
  device_id: string,

  status: 'pending' | 'firing' | 'acknowledged' | 'resolved',
  is_open: boolean,                // === (status !== 'resolved'); see below
  severity: 'info' | 'warning' | 'critical',

  // Condition snapshot — an alert is self-describing even if the rule later changes
  metric: string,
  comparison: string,
  threshold: number,

  trigger_value: number,           // the value that crossed
  last_value: number,              // most recent observed
  resolved_value?: number,

  breached_since: Date,            // first breach of this episode — drives for_duration
  last_observed_at: Date,          // most recent evaluated reading — drives staleness
  fired_at?: Date,

  audit: {
    created_at, created_by, updated_at, updated_by,
    acknowledged_at?, acknowledged_by?,
    resolved_at?, resolved_by?,
    resolution?: 'manual' | 'auto' | 'stale' | 'device_inactive',
  }
}
```

The condition fields are snapshotted rather than joined. Editing a rule's threshold from 30
to 35 must not silently rewrite the history of alerts raised at 30.

### Lifecycle

```
                 for_duration = 0
   (none) ─────────────────────────────→ firing
      │                                     │
      │ for_duration > 0                    │ ack (admin)
      ↓                                     ↓
   pending ──── breach persists ────→ acknowledged
      │           ≥ duration               │
      │                                    │
      │ condition clears                   │ resolve (admin) │ auto
      ↓                                    ↓                 ↓
   (deleted)                            resolved ← ─ ─ ─ ─ ─ ┘
                                       (terminal)
```

| From | To | Trigger |
| --- | --- | --- |
| — | `pending` | first breach, `for_duration_seconds > 0` |
| — | `firing` | first breach, `for_duration_seconds == 0` |
| `pending` | `firing` | breach sustained for `for_duration_seconds` |
| `pending` | *deleted* | condition clears before the duration elapses |
| `firing` | `acknowledged` | admin action |
| `firing` | `resolved` | condition clears (auto), or admin action |
| `acknowledged` | `resolved` | condition clears (auto), or admin action |
| `resolved` | — | terminal |

**`pending` is an internal state.** It is what makes `for_duration_seconds` work without a
second state store: the pending document *is* the "condition first seen at T" record.
Pending alerts are excluded from every default API view, raise no notification, and are
deleted rather than resolved if the condition clears — an episode that never fired is not
history, and keeping them would let a flapping sensor fill the collection.

**Acknowledged alerts never return to firing.** Acknowledgement means "I know, I'm on it";
re-firing under a human who is already working the problem is noise. If an alert resolves
and the condition returns, that is a new episode with a new document — which is also what
makes duration-of-outage reporting meaningful.

### Deduplication is enforced by the database

```typescript
AlertV2Schema.index(
  { rule_id: 1, device_id: 1 },
  { unique: true, partialFilterExpression: { is_open: true } }
);
```

At most one open episode per (rule, device) pair, guaranteed by MongoDB rather than by
application logic. Two concurrent ingests racing to open the same episode cannot both
succeed. The loser receives `E11000`, which the evaluator treats as benign — someone else
opened the episode, which is the desired end state either way. The partial filter is what
allows unlimited *resolved* episodes for the same pair.

This is the deduplication mechanism in full. There is no separate dedup key, fingerprint,
or grouping pass.

#### Why `is_open` rather than a status `$in`

The natural predicate is `{ status: { $in: ['pending','firing','acknowledged'] } }`, but
`$in` inside a `partialFilterExpression` requires **MongoDB 6.0 or later**. That would make
`pnpm create-indexes-v2` fail at index-creation time against an older server, with a
failure mode that only appears on deploy.

A denormalized `is_open` boolean uses a plain equality predicate, supported since 3.2, and
is a simpler thing to index. The cost is one field that must stay in sync with `status`.
That invariant — `is_open === (status !== 'resolved')` — is maintained in exactly four
places: the evaluator's bulk write, `AlertV2.acknowledge` (leaves it true),
`AlertV2.resolve` (sets it false), and the staleness sweep. A unit test asserts it holds
after every transition.

### Flapping suppression

A sensor oscillating across a threshold would otherwise produce an episode per crossing.
Two independent controls:

- `for_duration_seconds` suppresses *before* firing — the condition must hold. This is the
  primary control and handles transient spikes.
- `cooldown_seconds` suppresses *after* resolving — a new episode for the same
  (rule, device) pair cannot open until the cooldown has elapsed since `audit.resolved_at`.
  This handles a condition that genuinely keeps recurring.

### Indexes

```typescript
{ rule_id: 1, device_id: 1 }                        // partial unique on is_open, above
{ rule_id: 1, device_id: 1, 'audit.resolved_at': -1 }  // cooldown lookback
{ status: 1, 'audit.created_at': -1 }               // active list, the default view
{ device_id: 1, 'audit.created_at': -1 }            // device detail page
{ severity: 1, status: 1 }                          // severity filter
{ is_open: 1, last_observed_at: 1 }                 // staleness sweep
```

The cooldown index is not optional. The partial unique index is only usable by queries that
match its filter, so a lookback over *resolved* episodes cannot use it, and there is no
other `{ rule_id, device_id }` index to fall back on. Without this entry the cooldown query
is a collection scan.

## Evaluation

`lib/alerting/evaluate.ts`, one exported entry point:

```typescript
evaluateReadings(
  readings: Partial<IReadingV2>[],
  devices: Pick<IDeviceV2, '_id' | 'type' | 'location' | 'metadata'>[],
): Promise<EvaluationResult>
```

Callers pass the device documents they already loaded, so evaluation adds no device query
to either path. Both callers need their projections corrected:

| Path | Current projection | Required |
| --- | --- | --- |
| `readings/ingest/route.ts:145-148` | `{ _id: 1 }` | add `type`, `location`, `metadata.tags` |
| `cron/simulate/route.ts:43` | `{ _id, type, location }` | add `metadata.tags` |

The ingest route currently projects the id alone, because its only use for the query is an
existence check. It needs the selector-relevant fields added, not merely widened by one.

### The algorithm

1. **Load active rules** — one cached query, grouped into `Map<ReadingType, rules[]>` at
   cache-build time.
2. **Match** each reading against the rules for its own type, testing the device's
   `location.building_id`, `location.floor`, `location.zone`, and `metadata.tags` against
   the selector predicates.
3. **Reduce to one decision per (rule, device) pair** — see below.
4. **Load open episodes** for the candidate pairs — one query on the partial unique index.
5. **Load recently-resolved episodes** for the same pairs, back to the longest active
   cooldown — one query on the cooldown index.
6. **Decide** every pair in memory: open, promote pending to firing, update `last_value`,
   auto-resolve, delete a cleared pending, or suppress under cooldown.
7. **Write** — one `bulkWrite(ops, { ordered: false })`.
8. **Notify** — see "Notification delivery".

### Step 3 is a semantic decision, not only a performance bound

The obvious reduction — keep the newest reading per pair — is cheap but quietly changes
what alerting means: a breach that occurs *and clears* inside a single batch would never be
seen, and a 10,000-reading backfill would be evaluated only at its tip. That is harmless at
the cron's one-reading-per-device cadence and not harmless at the batch size the ingest API
advertises.

The reduction is therefore **breach-aware**:

- if *any* reading for the pair breaches, the pair is breaching;
- `breached_since` comes from the **earliest** breaching reading in the batch;
- `last_value` and `last_observed_at` come from the **latest** reading overall.

Stated plainly, so no one has to infer it: **alerting evaluates the aggregate state of each
device per request. It is not a backfill engine and does not replay a batch as a
timeline.** A batch containing breach → clear → breach yields one episode, not two.
Reconstructing episode history from a bulk historical import is out of scope.

### Out-of-order batches must not rewind state

`last_observed_at` and `last_value` are written from the batch's latest reading, which may
still be *older* than what the episode already holds — a retried or delayed request. Left
unguarded, that rewinds `last_observed_at` directly into the staleness sweep's path and can
resolve a live alert as stale.

Updates therefore use `$max` on `last_observed_at` and carry a
`last_observed_at: { $lt: ts }` predicate for the fields that must move together with it.
An update whose reading is older than the episode's high-water mark is a no-op.

### Cost

Per request: **two queries, one bulk write, and one or two Pusher calls — constant in batch
size** (plus a third query on a rule-cache miss). Whether the request carried 1 reading or
10,000, the number of round trips is the same. That is a structural property of step 3, not
a benchmark to be measured afterwards.

**It is not constant in fleet size.** Work is linear in *candidate pairs*: a fleet-wide
temperature rule across 500 seeded devices produces 500 pairs, which is the `$in` cardinality
into steps 4–5 and the operation count into the bulk write. Constant round trips, linear
payloads. At the current scale — hundreds of devices, tens of rules — this is comfortable;
at tens of thousands of devices the pair set is what would need chunking first.

The matching in steps 1–2 is O(readings × rules-for-that-type), single-digit microseconds
against the tens of milliseconds `insertMany` already costs.

### Failure isolation

Issue #97 requires that evaluation failures never drop readings. Three properties
guarantee it:

1. Evaluation runs strictly **after** `insertMany` has committed. There is no path by
   which it can roll back an insert.
2. The call is wrapped in its own `try`/`catch`. Errors are logged through
   `logger.error` and counted as a metric; they never propagate to `withErrorHandler` and
   never change the response status.
3. The ingest response body reports insert results only. Alerting is not part of its
   contract.

This mirrors the existing treatment of the Pusher trigger in the simulate route
(`route.ts:62-70`), which already logs and swallows rather than failing a committed write.

### Bulk write error handling

`bulkWrite(..., { ordered: false })` throws `MongoBulkWriteError` carrying `writeErrors[]`,
and "treat `E11000` as benign" has to be precise or it becomes "swallow everything":

```typescript
catch (err) {
  const writeErrors = (err as MongoBulkWriteError)?.writeErrors ?? [];
  const unexpected = writeErrors.filter(e => e.code !== 11000);
  if (unexpected.length > 0) throw err;   // genuine failure — surface it
  // every error was a duplicate open episode: another request won the race
}
```

Only code `11000` is absorbed; anything else rethrows into the outer handler, which logs
with detail and increments `alert_evaluation_errors_total`. Without this filter a genuine
write failure would vanish into the same silent path as a benign race, and §Observability's
claim that the error counter is the only signal of a broken evaluator would stop being
true.

### Resolution and staleness

An episode auto-resolves when a *new* reading shows the metric back within bounds. A device
that stops reporting therefore stays firing indefinitely.

In the demo this is largely theoretical — the simulate cron emits a reading for every
active device on every run, so any alert on an active device is re-evaluated every cycle.
The real gap is a device that leaves the active set: decommissioned, soft-deleted, or
silent because it broke.

A sweep on the cron path only — one query per cron invocation, not per ingest — closes it.
It selects open episodes (`is_open: true`) whose device is no longer active, or whose
`last_observed_at` predates `STALE_AFTER_SECONDS` (default 1800), and then **branches on
status**:

| Swept episode status | Action | Rationale |
| --- | --- | --- |
| `pending` | **deleted** | consistent with "an episode that never fired is not history" |
| `firing`, `acknowledged` | resolved, `resolution: 'device_inactive'` or `'stale'` | it did fire; the history is real |

Both resolutions are recorded distinctly from `'auto'` so history never claims a problem
was fixed when the sensor merely went quiet.

## API surface

Eight endpoints, taking the v2 surface from 25 to 33.

| Endpoint | Method | Auth |
| --- | --- | --- |
| `/api/v2/alerts` | GET | `requireOrgMembership()` |
| `/api/v2/alerts/[id]` | GET | `requireOrgMembership()` |
| `/api/v2/alerts/[id]` | PATCH | `requireAdmin()` |
| `/api/v2/alert-rules` | GET | `requireOrgMembership()` |
| `/api/v2/alert-rules` | POST | `requireAdmin()` |
| `/api/v2/alert-rules/[id]` | GET | `requireOrgMembership()` |
| `/api/v2/alert-rules/[id]` | PATCH | `requireAdmin()` |
| `/api/v2/alert-rules/[id]` | DELETE | `requireAdmin()` |

Rules live at `/api/v2/alert-rules` rather than `/api/v2/alerts/rules` so that no static
segment competes with the `[id]` dynamic segment. Hyphenated resource names are already
established (`temperature-correlation`, `maintenance-forecast`).

### Transitions go through PATCH

Issue #98 calls for the `ScheduleV2` precedent, and that precedent is
`PATCH /:id { status }` dispatching to atomic statics — not action sub-routes. Alerting
follows it:

```
PATCH /api/v2/alerts/[id]  { status: 'acknowledged' | 'resolved', note?: string }
```

There is no `DELETE` on alerts. An alert is resolved, never cancelled, and never removed —
the history is the point.

`GET /api/v2/alerts` defaults to open alerts (`firing` + `acknowledged`) and never returns
`pending`. Filters: `status`, `severity`, `device_id`, `rule_id`, date range, plus standard
pagination and sorting.

### Atomic transitions

Two statics, structurally identical to `ScheduleV2.complete()` and `.cancel()` — a guarded
`findOneAndUpdate` that can only match from a legal predecessor state, then a follow-up
read to classify the failure:

```typescript
AlertV2.acknowledge(id, by)               // { _id, status: 'firing' } → acknowledged
AlertV2.resolve(id, by, resolution)       // { _id, status: { $in: ['firing','acknowledged'] } } → resolved, is_open: false
```

Illegal transitions throw `AlertTransitionError` carrying a code, mirroring
`ScheduleTransitionError`. `ScheduleV2` needs four codes because its two terminal targets
are symmetric — either can block the other. Alerts are not symmetric: `acknowledged` sits
*between* `firing` and `resolved`, so three codes cover every illegal case.

| Transition code | Raised when | Maps to `ErrorCodes` |
| --- | --- | --- |
| `ALREADY_ACKNOWLEDGED` | acknowledging an acknowledged alert | `ALERT_ALREADY_ACKNOWLEDGED` |
| `ALREADY_RESOLVED` | acknowledging or resolving a resolved alert | `ALERT_ALREADY_RESOLVED` |
| `NOT_YET_FIRING` | acting on a pending alert | `INVALID_ALERT_STATUS_TRANSITION` |

Routes map these to `ApiError` at **422** through a `TRANSITION_CODE_MAP`, the same shape
as `app/api/v2/schedules/[id]/route.ts:123`.

New entries in `lib/errors/errorCodes.ts`: `ALERT_NOT_FOUND`, `ALERT_RULE_NOT_FOUND`,
`ALERT_ALREADY_ACKNOWLEDGED`, `ALERT_ALREADY_RESOLVED`,
`INVALID_ALERT_STATUS_TRANSITION`.

### Validation

`lib/validations/v2/alert.validation.ts` and `alert-rule.validation.ts`, composed from the
existing helpers in `common.validation.ts` (`deviceIdSchema`, `paginationSchema`,
`dateRangeSchema`, `createSortSchema`, `userIdentifierSchema`):

- `createAlertRuleSchema`, `updateAlertRuleSchema` (at-least-one-field refinement),
  `listAlertRulesQuerySchema`, `alertRuleIdParamSchema`
- `updateAlertSchema` (status + optional note), `listAlertsQuerySchema`,
  `getAlertQuerySchema` (`include_device`), `alertIdParamSchema`

Two cross-field refinements on the rule schema, both rejecting at the edge rather than
producing a rule that can never fire or can never be interpreted:

- threshold bounds per metric — `{ metric: 'anomaly_score', threshold: 30 }` is rejected;
- `selector.types` non-empty when `metric === 'value'`.

### Caching

**The alerts list is not cached.** It changes on every ingest and is already pushed over
Pusher; a cache-aside layer would add staleness in exchange for nothing. This is a
deliberate departure from the reflex established by the other v2 read endpoints.

The active rule set *is* cached, TTL 60s, invalidated on every rule create, update, and
delete — it is read on every write path and changes almost never.

**The rule cache key is global, not org-scoped**, departing from every other generator in
`lib/cache/keys.ts`. Three facts force this:

1. No v2 model carries an org dimension. `orgId` is a Clerk session property used for cache
   partitioning, never a stored field, so rules have nothing to be keyed by.
2. `/api/v2/cron/simulate` authenticates with `SEED_SECRET` and establishes **no Clerk
   context at all**. On the path that carries every reading in the deployment, there is no
   `orgId` to compute.
3. Multi-tenancy is explicitly out of scope in the parent design, and
   `CLERK_ALLOWED_ORG_SLUGS` defaults to a single org.

`lib/cache/keys.ts` gains an `ALERT_RULES` prefix and `alertRulesKey()` taking no
arguments, with a comment recording why it skips `orgPrefix`. Giving `AlertRuleV2` an org
field instead would mean inventing the multi-tenancy the parent doc rules out, to serve a
cache key.

## Notification delivery

### Transport

The existing `InfraSight` channel gains one event rather than a second channel being
created. `PusherProvider` already owns exactly one subscription and multiplexes callbacks
to subscribers (`lib/pusher-context.tsx:52-70`); adding events keeps subscription teardown
in the one place that already handles it correctly, which satisfies #100's "subscriptions
clean up on unmount" by construction.

### One event, tagged envelope

An earlier draft used two event names behind a single `subscribeAlerts` registration. That
does not work: `PusherContext` holds one callback set bound to one event name, so a
subscriber receiving a bare array cannot tell which event produced it. Rather than
duplicate the provider's multiplexing machinery per event, the payload carries the tag:

```typescript
type AlertEvent =
  | { kind: 'fired';    alerts: FiredAlert[] }
  | { kind: 'resolved'; alerts: ResolvedAlert[] }
  | { kind: 'storm';    count: number; by_severity: Record<Severity, number>; since: string };
```

All three arrive on the single `alert-event` name. `PusherContext` gains
`subscribeAlerts` / `unsubscribeAlerts` and a `usePusherAlerts(cb)` hook following the
exact shape of `usePusherReadings`.

### The payload must be bounded

One trigger per evaluation is constant in *call count*, not in *body size*, and **Pusher
caps an event at 10 KB**. A floor-wide condition firing across hundreds of devices in one
cron run overflows that cap, the trigger throws, and this design swallows Pusher failures —
so the UI would silently miss the single most dramatic event it exists to display. The
failure mode is exactly inverted from what alerting is for.

Two bounds, both required:

- **Batch cap.** Above `ALERT_EVENT_MAX` (20) alerts in one evaluation, the individual
  payload is discarded and a single `storm` event is sent instead: counts by severity and a
  timestamp. The client raises one aggregate toast — "312 alerts firing" — and invalidates
  the list query rather than rendering 312 toasts, which is also the better interface.
- **Chunking below the cap.** Twenty alerts at roughly 200 bytes each is ~4 KB, inside the
  limit with margin. The serialized body is measured before sending; anything still over
  8 KB falls back to the storm event rather than being split, so ordering never matters.

The same rule applies to `resolved`.

### Only firing raises a toast

`fired` produces a `react-toastify` toast styled by severity, linking to `/alerts/[id]`.
`resolved` is broadcast so open lists reconcile without a refetch, but raises no toast —
nobody wants a popup per device when a floor-wide condition clears.

This structurally satisfies #100's "notifications do not fire for a viewer's own
acknowledge and resolve actions": firing is always system-generated, so no viewer can ever
cause a toast. The acting admin gets immediate feedback from their own mutation's
optimistic update instead. `actor` is still carried on resolved payloads — set to
`'system'` for automatic resolution and to the Clerk **user id** (never the email, since
the payload reaches every connected client) for manual — so list reconciliation can
distinguish the two.

Demo visitors receive these events. The Pusher client key is public and `PusherProvider`
sits above the auth boundary, so an anonymous visitor watching `/alerts` sees alerts arrive
live. That is the most convincing thirty seconds available to the demo and is intended, not
incidental.

## User interface

### Routes

| Route | Contents |
| --- | --- |
| `/alerts` | Active alerts; filters synced to the URL |
| `/alerts?status=resolved` | History, same page and filter mechanism |
| `/alerts/[id]` | Deep-linkable single alert |
| `/alerts/rules` | Rule management |

History is a filter value rather than a separate route, following the Phase 3 URL-sync
precedent in `app/devices/_components/useDeviceFilterParams.ts`. `/alerts/[id]` follows
`app/devices/[id]/page.tsx`: a canonical URL that survives refresh and can be pasted into a
chat mid-incident, calling `notFound()` for ids that do not resolve.

The detail page shows the condition in plain language ("temperature above 30 °C for 5
minutes"), a timeline across `breached_since → fired_at → acknowledged_at → resolved_at`,
and a link to the device.

It also shows the readings that bracketed the trigger. **No new endpoint is added for
this**: the page issues a second call to the existing
`GET /api/v2/readings?device_id=<id>&startDate=<fired_at − 15m>&endDate=<fired_at + 15m>`,
which already satisfies that endpoint's required-time-range constraint. `getAlertQuerySchema`
therefore stays at `include_device` only.

### Components

`components/alerts/` — `AlertList.tsx` (modelled on `ScheduleList.tsx`),
`AlertDetailView.tsx` (modelled on `DeviceDetailView.tsx`, shared between page and any
future drawer), `AlertSeverityBadge.tsx` and `AlertStatusBadge.tsx` (mirroring
`ScheduleStatusBadge.tsx` / `ServiceTypeBadge.tsx`), `AlertRuleList.tsx`, and
`CreateAlertRuleModal.tsx` (modelled on `CreateDeviceModal.tsx`).

### AlertsPanel is not orphaned — rename it, don't delete it

Issue #99 and parent §3.3 both describe `components/AlertsPanel.tsx` as orphaned. **That is
stale.** It is imported at `app/analytics/page.tsx:5` and rendered at `:84`; commit
`9c80aa9` *"refactor(ui): give AlertsPanel a home, drop CriticalDevicesList"* already
discharged parent §3.3. An earlier draft of this document inherited the stale premise and
proposed deleting the component, which would break the build.

The diagnosis survives the correction: a component named `AlertsPanel` rendering anomaly
data is exactly the confusion this phase exists to remove. The resolution changes:

- **Rename it `AnomalyPanel`** and leave it on `/analytics`, which is where anomaly data
  belongs under this design's own separation of the two surfaces. Update the import and the
  heading text; no behaviour change.
- **Build `components/dashboard/ActiveAlertsWidget.tsx` fresh** against
  `GET /api/v2/alerts`, rather than lifting a layout out of a live component. It is a
  different data shape — status, acknowledgement, duration — and copying a panel built for
  anomaly rows would import assumptions that no longer hold.

### Navigation

`TopNav` gains `{ href: '/alerts', label: 'Alerts', icon: Bell }` between Devices and
Maintenance, carrying a count badge of open alerts fed by the list query and updated live
from `usePusherAlerts`. The badge is the single clearest signal that this is an operations
tool rather than a set of charts.

### Demo mode

`/alerts` is fully readable by anonymous demo visitors — every read endpoint above uses
`requireOrgMembership()`, which the synthetic demo context satisfies (`lib/auth/index.ts:105`).
Acknowledge, Resolve, and Create Rule render **disabled with a tooltip** per parent §1.5
rather than being hidden, so a visitor learns the workflow exists. Write blocking is
enforced by `requireAdmin()` server-side, not by the disabled attribute.

### React Query hooks

`lib/query/hooks/useAlerts.ts` — `useAlertsList(filters)`, `useAlertDetail(id)`,
`useAcknowledgeAlert()`, `useResolveAlert()`.
`lib/query/hooks/useAlertRules.ts` — `useAlertRulesList()`, `useCreateAlertRule()`,
`useUpdateAlertRule()`, `useDeleteAlertRule()`.

Mutations invalidate the alert list on success. `usePusherAlerts` patches the cached list
directly for `fired` and `resolved` envelopes; a `storm` envelope invalidates instead,
since its payload deliberately carries no rows.

`lib/api/v2-client.ts` gains `v2Api.alerts` and `v2Api.alertRules` namespaces; types go in
`types/v2/alert.types.ts`.

## Observability

`lib/monitoring/` gains `recordAlert()` feeding the existing `/api/v2/metrics` export:

- `alerts_fired_total{severity}` — counter
- `alerts_resolved_total{resolution}` — counter
- `alert_evaluation_duration_ms` — histogram
- `alert_evaluation_errors_total` — counter

The error counter matters most: because evaluation failures are swallowed by design, that
counter is the only signal that alerting has silently stopped working. This is why the bulk
write must rethrow non-`11000` errors rather than absorbing them.

## Testing

Matching the depth of the existing suites.

**Unit** — `__tests__/unit/models/AlertRuleV2.test.ts`, `AlertV2.test.ts` (every legal
transition, every illegal transition throwing the correct typed code, the
`is_open === (status !== 'resolved')` invariant after each, statics, soft delete);
`__tests__/unit/validations/alert.validation.test.ts` and `alert-rule.validation.test.ts`
(per-metric threshold bounds, `types` required for `metric: 'value'`);
`__tests__/unit/lib/alerting/evaluate.test.ts` — selector matching across each dimension,
type-less rules matching all types, breach-aware reduction (breach → clear → breach in one
batch yields one episode), `for_duration` promotion and pending deletion, dedup under a
duplicate-key collision, non-`11000` bulk errors rethrowing, cooldown suppression,
out-of-order batches not rewinding `last_observed_at`, auto-resolution, missing metric
fields, and empty inputs.

**Integration** — `__tests__/integration/api/alerts.integration.test.ts` and
`alert-rules.integration.test.ts`: RBAC per the table above (member `GET` 200, member
`PATCH` 403, demo `POST` 403), illegal transitions returning 422, pagination and filters,
and an ingest request whose evaluation throws still returning 201 with readings persisted.

**E2E** — `e2e/alerts.spec.ts`: the active list renders, `/alerts/[id]` survives a refresh,
acknowledge and resolve are gated, and an unknown alert id renders the styled 404.

## Seeding

`scripts/v2/seed-v2.ts` seeds a small rule set — a high-temperature rule with a five-minute
duration, a power-spike rule, a fleet-wide low-battery rule (no `selector.types`), and a
high-anomaly-score rule — so that `/alerts` is populated on first load. Without seeded rules
the entire phase is invisible to a visitor, which would defeat its purpose.

The low-battery rule is the one that motivates optional `selector.types`: battery is a
device property, and a rule that only watched temperature sensors' batteries would be
close to useless.

## Migration and risk

Additive only. Two new collections; no change to `readings_v2`, `devices_v2`, or
`schedules_v2`. This matters specifically because `readings_v2` is a timeseries collection
whose `timeField` and `metaField` cannot be altered after creation — nothing in this design
touches either.

The two write-path routes are modified, but only after their existing insert logic, and
their device queries only change projection. `app/analytics/page.tsx` changes by one import
and one JSX tag for the `AnomalyPanel` rename. `pnpm create-indexes-v2` and
`pnpm verify-indexes` gain the new indexes; every one uses an equality or range predicate
supported since MongoDB 3.2, so index creation carries no server-version dependency.

## Sequencing

| Issue | Depends on |
| --- | --- |
| #96 Models and validation | this doc |
| #97 Evaluation | #96 |
| #98 Lifecycle and API | #96 |
| #99 UI | #98 |
| #100 Pusher delivery | #97, #98 |

#97 and #98 can proceed in parallel once #96 lands. #99 needs #98's endpoints; #100 needs
#97 to have something to broadcast and #98 for the routes its toasts link to.

## Decisions made

- Evaluation runs inline at **both** write paths — `/readings/ingest` and `/cron/simulate`
  — because only the latter carries data in the deployed demo.
- Rules target devices by declarative selector, not by an explicit device id list.
  `selector.types` is an optional array, required only when `metric === 'value'`.
- Anomaly detection and alerting stay separate surfaces. `anomaly_score` is exposed as a
  rule metric; `GET /api/v2/analytics/anomalies` is unchanged.
- `pending` is a fourth, internal lifecycle state — the mechanism that makes duration
  thresholds work without a second state store.
- Deduplication is a partial unique index, enforced by MongoDB rather than by application
  logic, keyed on an `is_open` boolean to avoid a MongoDB 6.0 dependency.
- Evaluation reduces **by breach, not by recency**, and is explicitly not a backfill engine.
- Transitions go through `PATCH /api/v2/alerts/[id]`, following `ScheduleV2`, not through
  action sub-routes. Three transition codes, not four — alerts' terminal states are not
  symmetric.
- The alerts list is deliberately **not** cached, departing from the other v2 read
  endpoints. The rule cache key is deliberately **not** org-scoped, because the cron path
  has no Clerk context to derive one from.
- One tagged Pusher event, bounded by a batch cap that degrades to a storm summary rather
  than overflowing Pusher's 10 KB limit.
- `AlertsPanel.tsx` is **renamed** to `AnomalyPanel` and stays on `/analytics`; the
  dashboard widget is built fresh against the alerts API.

## Out of scope

Notification channels beyond Pusher (email, SMS, webhook, PagerDuty); alert grouping or
correlation across devices; maintenance windows and scheduled suppression; escalation
policies and on-call rotation; per-user notification preferences; rule preview or
backtesting against historical readings; replaying a bulk historical import as an episode
timeline; and any statistical anomaly detector to replace the simulator's synthetic
`is_anomaly` label — that is a project of its own and finding C1 merely documents it.
