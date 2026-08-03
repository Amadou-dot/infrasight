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
 * The caller passes the device ids it just emitted readings for, so this stays at
 * one query plus one bulk write and needs no device lookup of its own.
 */

import type { AnyBulkWriteOperation, Types } from 'mongoose';
import AlertV2, { type IAlertV2 } from '@/models/v2/AlertV2';
import { recordAlert } from '@/lib/monitoring';
import type { ResolvedAlert } from '@/types/v2/alert.types';

export const STALE_AFTER_SECONDS = parseInt(
  process.env.ALERT_STALE_AFTER_SECONDS || '1800',
  10
);

export interface SweepResult {
  /** Pending episodes deleted — an episode that never fired is not history. */
  deleted: number;
  /** Firing/acknowledged episodes resolved — they did fire, so the history is real. */
  resolved: ResolvedAlert[];
}

export async function sweepStaleAlerts(reportingDeviceIds: Set<string>): Promise<SweepResult> {
  const openAlerts = await AlertV2.find({ is_open: true }).lean<IAlertV2[]>();
  if (openAlerts.length === 0) return { deleted: 0, resolved: [] };

  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_AFTER_SECONDS * 1000);

  const toDelete: Types.ObjectId[] = [];
  const ops: AnyBulkWriteOperation<IAlertV2>[] = [];
  const resolved: ResolvedAlert[] = [];

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

    ops.push({
      updateOne: {
        filter: { _id: alert._id, is_open: true },
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

    resolved.push({
      _id: String(alert._id),
      rule_id: String(alert.rule_id),
      device_id: alert.device_id,
      severity: alert.severity,
      resolution,
      resolved_at: now.toISOString(),
      actor: 'system',
    });

    recordAlert('resolved', { resolution });
  }

  if (toDelete.length > 0) ops.push({ deleteMany: { filter: { _id: { $in: toDelete } } } });

  if (ops.length > 0) await AlertV2.bulkWrite(ops, { ordered: false });

  return { deleted: toDelete.length, resolved };
}
