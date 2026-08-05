/**
 * Staleness sweep.
 *
 * An episode auto-resolves when a NEW reading shows the metric back within
 * bounds, so a device that stops reporting would otherwise stay firing forever.
 * The simulate cron emits a reading for every active device on every run, so the
 * real gap is a device that leaves the active set: decommissioned, soft-deleted,
 * or silent because it broke.
 *
 * Runs on the cron path only — one query per cron invocation, not per ingest.
 * The caller passes the device ids it just emitted readings for, so this needs no
 * device lookup of its own: one snapshot read, one bulk write, and — only when
 * there is at least one resolution to confirm — one reconciliation query (see
 * below for why the reconciliation query is required).
 */

import type { AnyBulkWriteOperation, Types } from 'mongoose';
import AlertV2, { type IAlertV2 } from '@/models/v2/AlertV2';
import { logger, recordAlert } from '@/lib/monitoring';
import type { ResolvedAlert } from '@/types/v2/alert.types';

const DEFAULT_STALE_AFTER_SECONDS = 1800;

/**
 * A malformed `ALERT_STALE_AFTER_SECONDS` (non-numeric, or parseInt's
 * partial-parse leaving a NaN) used to silently disable staleness detection
 * entirely: `new Date(NaN)` is an Invalid Date, so `last_observed_at <
 * cutoff` is always false and the branch below stops firing — permanently
 * and silently, with `device_inactive` still working to mask it. Guard with
 * Number.isFinite (parseInt itself never throws) and fall back to the
 * documented default, logging so the misconfiguration is visible instead of
 * merely inert. A non-positive value is equally nonsensical for "seconds
 * after which to consider stale" and is rejected the same way.
 */
function parseStaleAfterSeconds(): number {
  const raw = process.env.ALERT_STALE_AFTER_SECONDS;
  if (!raw) return DEFAULT_STALE_AFTER_SECONDS;

  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      `Malformed ALERT_STALE_AFTER_SECONDS "${raw}"; falling back to ${DEFAULT_STALE_AFTER_SECONDS}s. Staleness detection would otherwise be silently disabled.`,
      { value: raw }
    );
    return DEFAULT_STALE_AFTER_SECONDS;
  }

  return parsed;
}

export const STALE_AFTER_SECONDS = parseStaleAfterSeconds();

export interface SweepResult {
  /** Pending episodes deleted — an episode that never fired is not history. */
  deleted: number;
  /** Firing/acknowledged episodes resolved — they did fire, so the history is real. */
  resolved: ResolvedAlert[];
}

export async function sweepStaleAlerts(reportingDeviceIds: Set<string>): Promise<SweepResult> {
  const openAlerts = await AlertV2.find({ is_open: true })
    .select({ _id: 1, rule_id: 1, device_id: 1, status: 1, severity: 1, last_observed_at: 1 })
    .lean<IAlertV2[]>();
  if (openAlerts.length === 0) return { deleted: 0, resolved: [] };

  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_AFTER_SECONDS * 1000);

  const toDelete: Types.ObjectId[] = [];
  const ops: AnyBulkWriteOperation<IAlertV2>[] = [];
  // Candidates, not confirmed outcomes: every op below carries a guard that can
  // legitimately match zero documents (see the reconciliation step after the
  // bulk write). `resolved[]` and the `recordAlert('resolved', …)` calls are
  // derived from these AFTER the write confirms which ones actually landed.
  const resolveCandidates: { id: Types.ObjectId; alert: ResolvedAlert }[] = [];

  for (const alert of openAlerts) {
    const deviceInactive = !reportingDeviceIds.has(alert.device_id);
    const observationStale = new Date(alert.last_observed_at) < cutoff;
    if (!deviceInactive && !observationStale) continue;

    if (alert.status === 'pending') {
      toDelete.push(alert._id);
      continue;
    }

    // Recorded distinctly from 'auto' so history never claims a problem was fixed
    // when the sensor merely went quiet.
    const resolution = deviceInactive ? 'device_inactive' : 'stale';

    // A device absent from reportingDeviceIds has no fresh observation by
    // definition, so 'device_inactive' keeps the unguarded { is_open: true }
    // filter. 'stale' additionally guards on last_observed_at: between this
    // function's snapshot read and its bulk write, a concurrent
    // evaluateReadings() on the ingest path can record a fresh breaching
    // observation, and without the cutoff predicate this op would close an
    // alert that is actively breaching again. Mirrors evaluate.ts's
    // `last_observed_at: { $lt: … }` guard on its own resolve op (evaluate.ts:345).
    ops.push({
      updateOne: {
        filter:
          resolution === 'stale'
            ? { _id: alert._id, is_open: true, last_observed_at: { $lt: cutoff } }
            : { _id: alert._id, is_open: true },
        update: {
          $set: {
            status: 'resolved',
            is_open: false,
            'audit.updated_at': now,
            'audit.updated_by': 'system',
            'audit.resolved_at': now,
            'audit.resolved_by': 'system',
            'audit.resolution': resolution,
          },
        },
      },
    });

    resolveCandidates.push({
      id: alert._id,
      alert: {
        _id: String(alert._id),
        rule_id: String(alert.rule_id),
        device_id: alert.device_id,
        severity: alert.severity,
        resolution,
        resolved_at: now.toISOString(),
        actor: 'system',
      },
    });
  }

  // The `status: 'pending'` guard is NOT optional. Between this function's
  // snapshot read and its bulk write, a concurrent evaluateReadings() on the
  // ingest path can promote one of these episodes to `firing` via its own
  // status-guarded updateOne. Deleting by _id alone would then destroy a
  // legitimately-fired alert's history instead of leaving it to resolve
  // normally. Mirrors the `is_open: true` guard on the resolve op above.
  if (toDelete.length > 0)
    ops.push({ deleteMany: { filter: { _id: { $in: toDelete }, status: 'pending' } } });

  if (ops.length === 0) return { deleted: 0, resolved: [] };

  const bulkResult = await AlertV2.bulkWrite(ops, { ordered: false });

  // BulkWriteResult exposes aggregate counts, not per-op match status, so the
  // resolve set is confirmed with one follow-up query rather than assumed from
  // resolveCandidates. Every resolve op in THIS run stamps audit.resolved_at
  // with the same `now`, which makes the query's result exactly the confirmed
  // set — one extra query per sweep, not a per-alert findOneAndUpdate loop.
  let resolved: ResolvedAlert[] = [];
  if (resolveCandidates.length > 0) {
    const confirmed = await AlertV2.find({
      _id: { $in: resolveCandidates.map(c => c.id) },
      'audit.resolved_at': now,
    })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();
    const confirmedIds = new Set(confirmed.map(doc => String(doc._id)));

    resolved = resolveCandidates.filter(c => confirmedIds.has(String(c.id))).map(c => c.alert);
    for (const alert of resolved) recordAlert('resolved', { resolution: alert.resolution });
  }

  // deletedCount is the driver's actual count, not toDelete.length — the
  // status-guarded deleteMany below can match fewer documents than candidates.
  return { deleted: bulkResult.deletedCount, resolved };
}
