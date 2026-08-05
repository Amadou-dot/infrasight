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
    // alert that is actively breaching again.
    //
    // Mirrors the `last_observed_at: { $lt: … }` predicate on the auto-resolve
    // updateOne in evaluateReadings() (lib/alerting/evaluate.ts) — the one in
    // its "not breaching / existing episode has fired" branch, alongside
    // `is_open: true`. Named by function and predicate rather than by line
    // number on purpose: the previous version of this comment cited a line that
    // had since drifted onto an unrelated field of the insertOne document.
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
  // resolveCandidates — one extra query per sweep, not a per-alert
  // findOneAndUpdate loop.
  //
  // House rule (shared with evaluateReadings' Step 8): a write-confirmation
  // predicate must match a value-set that ONLY the confirming operation could
  // have produced. `audit.resolved_at: now` alone does NOT satisfy it. Three
  // other code paths write that field, and each is genuinely concurrent with a
  // cron sweep:
  //
  //   - evaluateReadings' auto-resolve on the ingest path, which writes
  //     `audit.resolution: 'auto'`;
  //   - AlertV2.resolve(), which PATCH /api/v2/alerts/[id] calls with 'manual'
  //     when a human clicks Resolve;
  //   - PATCH /api/v2/alert-rules/[id], which closes episodes orphaned by a
  //     condition change, also with 'manual'.
  //
  // A collision to the millisecond with any of them would make this sweep
  // confirm — and broadcast, and count — a resolution it did not cause, labelled
  // 'stale' or 'device_inactive' while the stored document says 'auto' or
  // 'manual'. So the predicate additionally matches the resolution THIS
  // candidate's own op wrote. That value is carried on the candidate rather than
  // re-derived, so the predicate cannot drift from the write it is confirming.
  //
  // Why that is exclusive: 'stale' and 'device_inactive' are written by this
  // function and nowhere else in the codebase (verified by grep) — the evaluator
  // only ever writes 'auto', and both manual paths only ever write 'manual'.
  // The two predicates are mutually exclusive by construction, so neither the
  // sweep nor the evaluator can confirm the other's write.
  //
  // One residual, stated rather than papered over: two OVERLAPPING sweeps whose
  // `now` collides would both confirm the same document, since a sweep is not
  // distinguishable from another sweep by the values it writes. The `is_open:
  // true` guard means only one write lands, so the outcome is a duplicate
  // notification carrying the CORRECT label — not the mislabelling fixed above.
  // evaluateReadings carries the identical residual for two concurrent
  // evaluators. Closing it would need a per-run token in the document.
  //
  // Grouped by resolution so this stays ONE query regardless of how many
  // candidates each branch produced.
  let resolved: ResolvedAlert[] = [];
  if (resolveCandidates.length > 0) {
    const idsByResolution = new Map<ResolvedAlert['resolution'], Types.ObjectId[]>();
    for (const candidate of resolveCandidates) {
      const ids = idsByResolution.get(candidate.alert.resolution);
      if (ids) ids.push(candidate.id);
      else idsByResolution.set(candidate.alert.resolution, [candidate.id]);
    }

    const confirmed = await AlertV2.find({
      $or: [...idsByResolution].map(([resolution, ids]) => ({
        _id: { $in: ids },
        'audit.resolved_at': now,
        'audit.resolution': resolution,
      })),
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
