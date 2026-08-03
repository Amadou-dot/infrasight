/**
 * Alert rule evaluation.
 *
 * Called by both write paths AFTER their insert has committed, so it can never
 * roll back an insert. Owns no scheduler, no queue, and no second state store.
 *
 * COST: two `find`s and one bulk write, plus one reconciliation `find` when any
 * update op carries a notification, plus one rule-load query on a cache miss.
 * None of those scale with batch size: whether the request carried 1 reading or
 * 10,000, the number of round trips is identical. That is a structural property
 * of the reduction below, not a benchmark.
 *
 * It is NOT constant in fleet size: work is linear in candidate (rule, device)
 * pairs, which is the $in cardinality and the bulk operation count.
 */

import { Types, type AnyBulkWriteOperation } from 'mongoose';
import AlertV2, { type IAlertV2 } from '@/models/v2/AlertV2';
import {
  logger,
  recordAlert,
  recordAlertEvaluationDuration,
  recordAlertRuleSkipped,
  type AlertRuleSkipReason,
} from '@/lib/monitoring';
import { getRuleBuckets } from './rule-cache';
import { METRIC_ACCESSORS, compare, matchesSelector } from './selector';
import {
  emptyEvaluationResult,
  type CachedAlertRule,
  type EvaluableDevice,
  type EvaluableReading,
  type EvaluationResult,
} from './types';
import type { FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

const DUPLICATE_KEY_CODE = 11000;

/** One (rule, device) pair's reduced state for this batch. */
interface PairState {
  rule: CachedAlertRule;
  device: EvaluableDevice;
  /** `rule._id` pre-parsed at pair-creation time, once the rule has passed validation. */
  ruleObjectId: Types.ObjectId;
  breaching: boolean;
  /** Metric value of the EARLIEST breaching reading. */
  triggerValue?: number;
  /** Timestamp of the EARLIEST breaching reading. */
  breachedSince?: Date;
  /** Metric value of the LATEST reading overall, breaching or not. */
  lastValue: number;
  /** Timestamp of the LATEST reading overall. */
  lastObservedAt: Date;
}

/** What a rule needs to resolve to before it can be matched or written. */
interface RuleValidation {
  accessor: (r: EvaluableReading) => number | undefined;
  ruleObjectId: Types.ObjectId;
}

/**
 * A notification queued against a bulk-write op index — a candidate, not a
 * confirmed outcome. Nothing here is emitted or counted until the write says so.
 *
 * How it is confirmed depends on the op. An `insertOne` either inserts or
 * reports a write error, so its notification stands unless its index is in
 * `failedIndices`. A guarded `updateOne` can match ZERO documents and still be
 * a driver success, so it carries `confirmId` and is emitted only if the
 * reconciliation query after the write proves it actually matched.
 */
type PendingNotification =
  | { kind: 'fired'; alert: FiredAlert; confirmId?: Types.ObjectId }
  | { kind: 'resolved'; alert: ResolvedAlert; confirmId: Types.ObjectId }
  | null;

/**
 * Normalize the driver's write errors.
 *
 * MongoBulkWriteError.writeErrors is typed OneOrMore<WriteError> — a single
 * failure can arrive as a bare object rather than an array.
 */
export function extractWriteErrors(err: unknown): Array<{ index: number; code: number }> {
  const raw = (err as { writeErrors?: unknown })?.writeErrors;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(e => ({
    index: Number((e as { index?: number }).index ?? -1),
    code: Number((e as { code?: number }).code ?? 0),
  }));
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function toFiredAlert(
  id: Types.ObjectId,
  rule: CachedAlertRule,
  device: EvaluableDevice,
  state: PairState,
  firedAt: Date
): FiredAlert {
  return {
    _id: String(id),
    rule_id: rule._id,
    rule_name: rule.name,
    device_id: String(device._id),
    severity: rule.severity,
    metric: rule.metric,
    comparison: rule.comparison,
    threshold: rule.threshold,
    trigger_value: state.triggerValue ?? state.lastValue,
    fired_at: firedAt.toISOString(),
  };
}

export async function evaluateReadings(
  readings: EvaluableReading[],
  devices: EvaluableDevice[]
): Promise<EvaluationResult> {
  const started = Date.now();

  try {
    if (readings.length === 0 || devices.length === 0) return emptyEvaluationResult();

    const deviceById = new Map(devices.map(d => [String(d._id), d]));
    const { byType } = await getRuleBuckets();

    // ---- Steps 1-3: match and reduce to one decision per (rule, device) pair ----
    //
    // The reduction is BREACH-AWARE, not newest-wins. Alerting evaluates the
    // aggregate state of each device per request; it is not a backfill engine and
    // does not replay a batch as a timeline.
    const pairs = new Map<string, PairState>();
    let maxCooldownSeconds = 0;

    // A rule reaches this call from a `.lean()` read or a Redis JSON round trip,
    // neither of which re-validates: `rule.metric` can be any string, and
    // `rule._id` can be anything a seed script, migration, or stale cache entry
    // wrote. Two per-call caches, both keyed by rule id, keep a bad rule from
    // costing every other rule its share of the batch without flooding the log:
    //   - `ruleValidationCache` memoizes the metric-accessor and rule-id checks,
    //     so a rule bucketed under several reading types is validated once, not
    //     once per type.
    //   - `reportedSkips` gates `skipRule` itself. This is the one that actually
    //     caps logging/counting at once per call — it also covers a rule that
    //     PASSES validateRule but whose matching throws on every reading (e.g. a
    //     malformed selector), which `ruleValidationCache` has no opinion on.
    const ruleValidationCache = new Map<string, RuleValidation | null>();
    const reportedSkips = new Set<string>();

    const skipRule = (rule: CachedAlertRule, error: unknown, reason: AlertRuleSkipReason) => {
      if (reportedSkips.has(rule._id)) return; // already logged and counted this call
      reportedSkips.add(rule._id);
      recordAlertRuleSkipped(reason);
      logger.error('Alert rule skipped during evaluation', {
        ruleId: rule._id,
        ruleName: rule.name,
        metric: rule.metric,
        error: error instanceof Error ? error.message : String(error),
      });
    };

    const validateRule = (rule: CachedAlertRule): RuleValidation | null => {
      const cached = ruleValidationCache.get(rule._id);
      if (cached !== undefined) return cached;

      const accessor = METRIC_ACCESSORS[rule.metric];
      if (typeof accessor !== 'function') {
        skipRule(rule, new Error(`Unknown alert metric "${rule.metric}"`), 'unknown_metric');
        ruleValidationCache.set(rule._id, null);
        return null;
      }

      if (!Types.ObjectId.isValid(rule._id)) {
        skipRule(rule, new Error(`Invalid alert rule id "${rule._id}"`), 'invalid_rule_id');
        ruleValidationCache.set(rule._id, null);
        return null;
      }

      const result: RuleValidation = { accessor, ruleObjectId: new Types.ObjectId(rule._id) };
      ruleValidationCache.set(rule._id, result);
      return result;
    };

    for (const reading of readings) {
      const deviceId = reading.metadata?.device_id;
      const type = reading.metadata?.type;
      if (!deviceId || !type) continue;

      const device = deviceById.get(deviceId);
      if (!device) continue;

      const ts = toDate(reading.timestamp ?? new Date());
      const rules = byType.get(type) ?? [];

      for (const rule of rules) {
        const validation = validateRule(rule);
        if (!validation) continue;

        // Matching or metric extraction on a validated rule can still throw —
        // e.g. a malformed `selector.tags` written outside the Zod layer. One
        // bad rule must not cost every other rule its share of this batch.
        let metricValue: number | undefined;
        try {
          if (!matchesSelector(device, rule.selector)) continue;
          metricValue = validation.accessor(reading);
        } catch (error) {
          skipRule(rule, error, 'unexpected_error');
          continue;
        }

        if (metricValue === undefined || metricValue === null || Number.isNaN(metricValue))
          continue;

        maxCooldownSeconds = Math.max(maxCooldownSeconds, rule.cooldown_seconds ?? 0);

        const key = `${rule._id}::${deviceId}`;
        const breaches = compare(metricValue, rule.comparison, rule.threshold);
        const existing = pairs.get(key);

        if (!existing) {
          pairs.set(key, {
            rule,
            device,
            ruleObjectId: validation.ruleObjectId,
            breaching: breaches,
            triggerValue: breaches ? metricValue : undefined,
            breachedSince: breaches ? ts : undefined,
            lastValue: metricValue,
            lastObservedAt: ts,
          });
          continue;
        }

        if (breaches) {
          existing.breaching = true;
          if (!existing.breachedSince || ts < existing.breachedSince) {
            existing.breachedSince = ts;
            existing.triggerValue = metricValue;
          }
        }

        if (ts >= existing.lastObservedAt) {
          existing.lastValue = metricValue;
          existing.lastObservedAt = ts;
        }
      }
    }

    if (pairs.size === 0) return emptyEvaluationResult();

    // ---- Steps 4-5: two queries ----
    //
    // Every pair's rule already passed validateRule, so its ruleObjectId is
    // known-good — reuse it here (and at the insertOne below) rather than
    // re-parsing rule._id, which is where a malformed rule id used to throw and
    // take the whole batch down with it.
    const ruleObjectIds = [
      ...new Map([...pairs.values()].map(p => [p.rule._id, p.ruleObjectId])).values(),
    ];
    const deviceIds = [...new Set([...pairs.values()].map(p => String(p.device._id)))];

    const openEpisodes = await AlertV2.find({
      is_open: true,
      rule_id: { $in: ruleObjectIds },
      device_id: { $in: deviceIds },
    }).lean<IAlertV2[]>();

    const cooldownSince = new Date(Date.now() - maxCooldownSeconds * 1000);
    const recentlyResolved =
      maxCooldownSeconds > 0
        ? await AlertV2.find({
            rule_id: { $in: ruleObjectIds },
            device_id: { $in: deviceIds },
            'audit.resolved_at': { $gte: cooldownSince },
          })
            .select({ rule_id: 1, device_id: 1, 'audit.resolved_at': 1 })
            .lean<IAlertV2[]>()
        : [];

    const openByPair = new Map(openEpisodes.map(a => [`${a.rule_id}::${a.device_id}`, a]));

    const lastResolvedByPair = new Map<string, Date>();
    for (const episode of recentlyResolved) {
      const at = episode.audit?.resolved_at;
      if (!at) continue;
      const key = `${episode.rule_id}::${episode.device_id}`;
      const prev = lastResolvedByPair.get(key);
      if (!prev || toDate(at) > prev) lastResolvedByPair.set(key, toDate(at));
    }

    // ---- Step 6: decide every pair in memory ----
    const now = new Date();
    const ops: AnyBulkWriteOperation<IAlertV2>[] = [];
    const notificationCandidates: PendingNotification[] = [];
    let pendingOpened = 0;
    let suppressed = 0;

    const push = (
      op: AnyBulkWriteOperation<IAlertV2>,
      notification: PendingNotification = null
    ) => {
      ops.push(op);
      notificationCandidates.push(notification);
    };

    for (const [key, state] of pairs) {
      const existing = openByPair.get(key);
      const { rule, device } = state;

      // An out-of-order batch must never rewind state into the sweep's path.
      if (existing && state.lastObservedAt <= toDate(existing.last_observed_at)) continue;

      if (state.breaching) {
        if (!existing) {
          const lastResolved = lastResolvedByPair.get(key);
          if (
            lastResolved &&
            (rule.cooldown_seconds ?? 0) > 0 &&
            now.getTime() - lastResolved.getTime() < rule.cooldown_seconds * 1000
          ) {
            suppressed++;
            continue;
          }

          // Symmetric with the promotion branch below: a breach that already spans
          // the required duration WITHIN this batch must fire immediately, not wait
          // for a second request just because no pending episode exists yet.
          // `state.breaching` is true here, so `state.breachedSince` is always set —
          // same cast as `breached_since: state.breachedSince as Date` in the
          // insertOne document just below.
          const elapsedMs =
            state.lastObservedAt.getTime() - (state.breachedSince as Date).getTime();
          const firesImmediately = elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000;
          const _id = new Types.ObjectId();

          push(
            {
              insertOne: {
                document: {
                  _id,
                  rule_id: state.ruleObjectId,
                  rule_name: rule.name,
                  device_id: String(device._id),
                  status: firesImmediately ? 'firing' : 'pending',
                  is_open: true,
                  severity: rule.severity,
                  metric: rule.metric,
                  comparison: rule.comparison,
                  threshold: rule.threshold,
                  trigger_value: state.triggerValue as number,
                  last_value: state.lastValue,
                  breached_since: state.breachedSince as Date,
                  last_observed_at: state.lastObservedAt,
                  ...(firesImmediately ? { fired_at: now } : {}),
                  audit: {
                    created_at: now,
                    created_by: 'system',
                    updated_at: now,
                    updated_by: 'system',
                  },
                } as unknown as IAlertV2,
              },
            },
            firesImmediately
              ? { kind: 'fired', alert: toFiredAlert(_id, rule, device, state, now) }
              : null
          );

          if (!firesImmediately) pendingOpened++;
          continue;
        }

        if (existing.status === 'pending') {
          const elapsedMs =
            state.lastObservedAt.getTime() - toDate(existing.breached_since).getTime();

          if (elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000)
            push(
              {
                updateOne: {
                  filter: {
                    _id: existing._id,
                    status: 'pending',
                    last_observed_at: { $lt: state.lastObservedAt },
                  },
                  update: {
                    $set: {
                      status: 'firing',
                      fired_at: now,
                      last_value: state.lastValue,
                      'audit.updated_at': now,
                      'audit.updated_by': 'system',
                    },
                    $max: { last_observed_at: state.lastObservedAt },
                  },
                },
              },
              {
                kind: 'fired',
                alert: toFiredAlert(existing._id, rule, device, state, now),
                confirmId: existing._id,
              }
            );
          else
            push({
              updateOne: {
                filter: { _id: existing._id, last_observed_at: { $lt: state.lastObservedAt } },
                update: {
                  $set: { last_value: state.lastValue, 'audit.updated_at': now },
                  $max: { last_observed_at: state.lastObservedAt },
                },
              },
            });
          continue;
        }

        // firing or acknowledged: refresh the observation, do not re-fire.
        push({
          updateOne: {
            filter: { _id: existing._id, last_observed_at: { $lt: state.lastObservedAt } },
            update: {
              $set: { last_value: state.lastValue, 'audit.updated_at': now },
              $max: { last_observed_at: state.lastObservedAt },
            },
          },
        });
        continue;
      }

      // ---- not breaching ----
      if (!existing) continue;

      if (existing.status === 'pending') {
        // An episode that never fired is not history, and keeping them would let a
        // flapping sensor fill the collection.
        push({ deleteOne: { filter: { _id: existing._id, status: 'pending' } } });
        continue;
      }

      push(
        {
          updateOne: {
            filter: {
              _id: existing._id,
              is_open: true,
              last_observed_at: { $lt: state.lastObservedAt },
            },
            update: {
              $set: {
                status: 'resolved',
                is_open: false,
                last_value: state.lastValue,
                resolved_value: state.lastValue,
                'audit.updated_at': now,
                'audit.updated_by': 'system',
                'audit.resolved_at': now,
                'audit.resolved_by': 'system',
                'audit.resolution': 'auto',
              },
              $max: { last_observed_at: state.lastObservedAt },
            },
          },
        },
        {
          kind: 'resolved',
          alert: {
            _id: String(existing._id),
            rule_id: String(existing.rule_id),
            device_id: existing.device_id,
            severity: existing.severity,
            resolution: 'auto',
            resolved_at: now.toISOString(),
            actor: 'system',
          },
          confirmId: existing._id,
        }
      );
    }

    // ---- Step 7: one bulk write ----
    const failedIndices = new Set<number>();
    // The only deleteOne ops are pending clears, and each is guarded on
    // `status: 'pending'` — fewer can delete than were queued, so the count comes
    // from the driver rather than from the loop above.
    let deletedCount = 0;

    if (ops.length > 0)
      try {
        deletedCount = (await AlertV2.bulkWrite(ops, { ordered: false })).deletedCount;
      } catch (err) {
        const writeErrors = extractWriteErrors(err);
        const unexpected = writeErrors.filter(e => e.code !== DUPLICATE_KEY_CODE);

        // Only E11000 is absorbed. Without this filter a genuine write failure
        // would vanish into the same silent path as a benign race, and
        // alert_evaluation_errors_total would stop being a trustworthy signal.
        if (unexpected.length > 0 || writeErrors.length === 0) throw err;

        // Every error was a duplicate open episode: another request won the race,
        // which is the desired end state either way.
        for (const e of writeErrors) failedIndices.add(e.index);

        // `ordered: false` still ran every other op, so deletes queued alongside
        // the duplicate landed; the driver carries their count on the error.
        deletedCount = (err as { deletedCount?: number }).deletedCount ?? 0;
      }

    // ---- Step 8: confirm the guarded updates against what actually matched ----
    //
    // A guarded updateOne matching ZERO documents is a driver success, and
    // BulkWriteResult reports aggregate counts, not per-op match status. Every op
    // in THIS run stamps `audit.updated_at` with the same `now`, so one follow-up
    // query returns exactly the ops that matched. Silent refresh ops carry no
    // notification and are left out of it — one extra query per evaluation, never
    // one per pair.
    const notifiedUpdateIds: Types.ObjectId[] = [];
    for (const candidate of notificationCandidates)
      if (candidate?.confirmId) notifiedUpdateIds.push(candidate.confirmId);

    const confirmedUpdateIds = new Set<string>();
    if (notifiedUpdateIds.length > 0) {
      const confirmed = await AlertV2.find({
        _id: { $in: notifiedUpdateIds },
        'audit.updated_at': now,
      })
        .select({ _id: 1 })
        .lean<{ _id: Types.ObjectId }[]>();
      for (const doc of confirmed) confirmedUpdateIds.add(String(doc._id));
    }

    const result = emptyEvaluationResult();
    result.pendingOpened = pendingOpened;
    result.pendingCleared = deletedCount;
    result.suppressed = suppressed;
    result.evaluatedPairs = pairs.size;

    // Notifications and their counters are emitted here, from confirmed outcomes
    // only — an episode that did not transition must not page anyone.
    for (let i = 0; i < notificationCandidates.length; i++) {
      const candidate = notificationCandidates[i];
      if (!candidate) continue;

      const landed = candidate.confirmId
        ? confirmedUpdateIds.has(String(candidate.confirmId))
        : !failedIndices.has(i);
      if (!landed) continue;

      if (candidate.kind === 'fired') {
        result.fired.push(candidate.alert);
        recordAlert('fired', { severity: candidate.alert.severity });
      } else {
        result.resolved.push(candidate.alert);
        recordAlert('resolved', { resolution: candidate.alert.resolution });
      }
    }

    return result;
  } finally {
    // Every exit path: the early returns above, a normal return, and a rethrown
    // bulk write error. An evaluation that threw still spent the time.
    recordAlertEvaluationDuration(Date.now() - started);
  }
}
