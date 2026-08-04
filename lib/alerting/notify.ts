/**
 * Real-time alert delivery.
 *
 * All alert traffic arrives on ONE Pusher event name carrying a tagged envelope.
 * PusherContext holds one callback set bound to one event name, so a subscriber
 * receiving a bare array could not tell which event produced it — the tag lives
 * in the payload rather than in a second event name.
 *
 * The payload is bounded twice, both required: Pusher caps a single event at
 * 10 KB, and this module swallows Pusher failures, so an unbounded payload would
 * mean the UI silently misses the single most dramatic event it exists to display.
 */

import { pusherServer } from '@/lib/pusher';
import { logger } from '@/lib/monitoring';
import type { AlertEvent, AlertSeverity, FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

export const ALERT_CHANNEL = 'InfraSight';
export const ALERT_EVENT_NAME = 'alert-event';

/** Above this many alerts in one evaluation, degrade to an aggregate summary. */
export const ALERT_EVENT_MAX = 20;

/**
 * Measured fallback. 20 alerts at roughly 200 bytes each is ~4 KB, inside
 * Pusher's 10 KB limit with margin — but a long rule name can blow that, so the
 * serialized body is measured before sending. Anything still over falls back to
 * the storm event rather than being split, so ordering never matters.
 */
export const ALERT_EVENT_MAX_BYTES = 8 * 1024;

type TimestampedAlert = { severity: AlertSeverity } & (
  | { fired_at: string }
  | { resolved_at: string }
);

function timestampOf(alert: TimestampedAlert): string {
  return 'fired_at' in alert ? alert.fired_at : alert.resolved_at;
}

function stormEnvelope(alerts: TimestampedAlert[], of: 'fired' | 'resolved'): AlertEvent {
  const by_severity: Record<AlertSeverity, number> = { info: 0, warning: 0, critical: 0 };
  for (const alert of alerts) by_severity[alert.severity]++;

  const since = alerts
    .map(timestampOf)
    .reduce((earliest, ts) => (ts < earliest ? ts : earliest), timestampOf(alerts[0]));

  return { kind: 'storm', of, count: alerts.length, by_severity, since };
}

function bound(
  envelope: AlertEvent,
  alerts: TimestampedAlert[],
  of: 'fired' | 'resolved'
): AlertEvent {
  if (alerts.length > ALERT_EVENT_MAX) return stormEnvelope(alerts, of);
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > ALERT_EVENT_MAX_BYTES)
    return stormEnvelope(alerts, of);
  return envelope;
}

export function buildFiredEnvelope(alerts: FiredAlert[]): AlertEvent | null {
  if (alerts.length === 0) return null;
  return bound({ kind: 'fired', alerts }, alerts as unknown as TimestampedAlert[], 'fired');
}

export function buildResolvedEnvelope(alerts: ResolvedAlert[]): AlertEvent | null {
  if (alerts.length === 0) return null;
  return bound({ kind: 'resolved', alerts }, alerts as unknown as TimestampedAlert[], 'resolved');
}

async function trigger(envelope: AlertEvent | null): Promise<void> {
  if (!envelope) return;

  try {
    await pusherServer.trigger(ALERT_CHANNEL, ALERT_EVENT_NAME, envelope);
  } catch (error) {
    // Never fail a committed write on a broadcast failure. Mirrors the existing
    // treatment of the Pusher trigger in the simulate route.
    logger.error('Pusher alert-event trigger failed', {
      kind: envelope.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishAlertEvents(
  fired: FiredAlert[],
  resolved: ResolvedAlert[]
): Promise<void> {
  await trigger(buildFiredEnvelope(fired));
  await trigger(buildResolvedEnvelope(resolved));
}
