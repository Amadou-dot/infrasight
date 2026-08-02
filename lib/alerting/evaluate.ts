/**
 * Alert rule evaluation.
 *
 * Called by both write paths AFTER their insert has committed, so it can never
 * roll back an insert. Owns no scheduler, no queue, and no second state store.
 *
 * COST: two queries, one bulk write, constant in batch size (plus a third query
 * on a rule-cache miss). Whether the request carried 1 reading or 10,000, the
 * number of round trips is identical. That is a structural property of the
 * reduction below, not a benchmark.
 *
 * It is NOT constant in fleet size: work is linear in candidate (rule, device)
 * pairs, which is the $in cardinality and the bulk operation count.
 */

import { Types, type AnyBulkWriteOperation } from 'mongoose';
import AlertV2, { type IAlertV2 } from '@/models/v2/AlertV2';
import { recordAlert, recordAlertEvaluationDuration } from '@/lib/monitoring';
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

/** A notification queued against a bulk-write op index, dropped if that op failed. */
type PendingNotification =
  | { kind: 'fired'; alert: FiredAlert }
  | { kind: 'resolved'; alert: ResolvedAlert }
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

  for (const reading of readings) {
    const deviceId = reading.metadata?.device_id;
    const type = reading.metadata?.type;
    if (!deviceId || !type) continue;

    const device = deviceById.get(deviceId);
    if (!device) continue;

    const ts = toDate(reading.timestamp ?? new Date());
    const rules = byType.get(type) ?? [];

    for (const rule of rules) {
      if (!matchesSelector(device, rule.selector)) continue;

      const metricValue = METRIC_ACCESSORS[rule.metric](reading);
      if (metricValue === undefined || metricValue === null || Number.isNaN(metricValue)) continue;

      maxCooldownSeconds = Math.max(maxCooldownSeconds, rule.cooldown_seconds ?? 0);

      const key = `${rule._id}::${deviceId}`;
      const breaches = compare(metricValue, rule.comparison, rule.threshold);
      const existing = pairs.get(key);

      if (!existing) {
        pairs.set(key, {
          rule,
          device,
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

  if (pairs.size === 0) {
    recordAlertEvaluationDuration(Date.now() - started);
    return emptyEvaluationResult();
  }

  // ---- Steps 4-5: two queries ----
  const ruleObjectIds = [...new Set([...pairs.values()].map(p => p.rule._id))].map(
    id => new Types.ObjectId(id)
  );
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
  const notifications: PendingNotification[] = [];
  let pendingOpened = 0;
  let pendingCleared = 0;
  let suppressed = 0;

  const push = (op: AnyBulkWriteOperation<IAlertV2>, notification: PendingNotification = null) => {
    ops.push(op);
    notifications.push(notification);
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

        const firesImmediately = (rule.for_duration_seconds ?? 0) === 0;
        const _id = new Types.ObjectId();

        push(
          {
            insertOne: {
              document: {
                _id,
                rule_id: new Types.ObjectId(rule._id),
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
          firesImmediately ? { kind: 'fired', alert: toFiredAlert(_id, rule, device, state, now) } : null
        );

        if (firesImmediately) recordAlert('fired', { severity: rule.severity });
        else pendingOpened++;
        continue;
      }

      if (existing.status === 'pending') {
        const elapsedMs = state.lastObservedAt.getTime() - toDate(existing.breached_since).getTime();

        if (elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000) {
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
            { kind: 'fired', alert: toFiredAlert(existing._id, rule, device, state, now) }
          );
          recordAlert('fired', { severity: rule.severity });
        } else
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
      pendingCleared++;
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
      }
    );
    recordAlert('resolved', { resolution: 'auto' });
  }

  // ---- Step 7: one bulk write ----
  const failedIndices = new Set<number>();

  if (ops.length > 0)
    try {
      await AlertV2.bulkWrite(ops, { ordered: false });
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
    }

  const result = emptyEvaluationResult();
  result.pendingOpened = pendingOpened;
  result.pendingCleared = pendingCleared;
  result.suppressed = suppressed;
  result.evaluatedPairs = pairs.size;

  for (let i = 0; i < notifications.length; i++) {
    const notification = notifications[i];
    if (!notification || failedIndices.has(i)) continue;
    if (notification.kind === 'fired') result.fired.push(notification.alert);
    else result.resolved.push(notification.alert);
  }

  recordAlertEvaluationDuration(Date.now() - started);
  return result;
}
