/**
 * Bounded Pusher Alert Delivery Tests
 */

import {
  buildFiredEnvelope,
  buildResolvedEnvelope,
  publishAlertEvents,
  ALERT_CHANNEL,
  ALERT_EVENT_NAME,
  ALERT_EVENT_MAX,
} from '@/lib/alerting/notify';
import { pusherServer } from '@/lib/pusher';
import type { FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

jest.mock('@/lib/pusher', () => ({
  pusherServer: { trigger: jest.fn().mockResolvedValue(undefined) },
}));

function fired(i: number, severity: FiredAlert['severity'] = 'warning'): FiredAlert {
  return {
    _id: `alert_${i}`,
    rule_id: 'rule_1',
    rule_name: 'High temp',
    device_id: `device_${i}`,
    severity,
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    trigger_value: 35,
    fired_at: `2026-08-01T12:0${i % 10}:00.000Z`,
  };
}

function resolved(i: number): ResolvedAlert {
  return {
    _id: `alert_${i}`,
    rule_id: 'rule_1',
    device_id: `device_${i}`,
    severity: 'warning',
    resolution: 'auto',
    resolved_at: '2026-08-01T12:30:00.000Z',
    actor: 'system',
  };
}

beforeEach(() => {
  (pusherServer.trigger as jest.Mock).mockClear();
});

describe('buildFiredEnvelope', () => {
  it('should return null for an empty list', () => {
    expect(buildFiredEnvelope([])).toBeNull();
  });

  it('should tag a small batch as fired', () => {
    const envelope = buildFiredEnvelope([fired(1), fired(2)]);

    expect(envelope).toEqual({ kind: 'fired', alerts: [fired(1), fired(2)] });
  });

  it('should carry exactly ALERT_EVENT_MAX alerts without degrading', () => {
    const alerts = Array.from({ length: ALERT_EVENT_MAX }, (_, i) => fired(i));

    expect(buildFiredEnvelope(alerts)!.kind).toBe('fired');
  });

  it('should degrade to a storm above ALERT_EVENT_MAX', () => {
    const alerts = [
      ...Array.from({ length: 15 }, (_, i) => fired(i, 'critical')),
      ...Array.from({ length: 10 }, (_, i) => fired(i + 15, 'info')),
    ];

    const envelope = buildFiredEnvelope(alerts);

    expect(envelope).toMatchObject({
      kind: 'storm',
      of: 'fired',
      count: 25,
      by_severity: { critical: 15, warning: 0, info: 10 },
    });
  });

  it('should set storm.since to the earliest fired_at', () => {
    const alerts = Array.from({ length: 25 }, (_, i) => fired(i));
    const envelope = buildFiredEnvelope(alerts) as { since: string };

    expect(envelope.since).toBe('2026-08-01T12:00:00.000Z');
  });

  it('should degrade to a storm when the measured body exceeds the byte cap', () => {
    // Under the count cap but over the byte cap: a long rule_name inflates each row.
    const alerts = Array.from({ length: 10 }, (_, i) => ({
      ...fired(i),
      rule_name: 'x'.repeat(2000),
    }));

    expect(buildFiredEnvelope(alerts)).toMatchObject({ kind: 'storm', of: 'fired' });
  });
});

describe('buildResolvedEnvelope', () => {
  it('should apply the same bounds', () => {
    expect(buildResolvedEnvelope([])).toBeNull();
    expect(buildResolvedEnvelope([resolved(1)])!.kind).toBe('resolved');
    expect(
      buildResolvedEnvelope(Array.from({ length: 25 }, (_, i) => resolved(i)))
    ).toMatchObject({ kind: 'storm', of: 'resolved' });
  });
});

describe('publishAlertEvents', () => {
  it('should send both envelopes on the single alert-event name', async () => {
    await publishAlertEvents([fired(1)], [resolved(2)]);

    expect(pusherServer.trigger).toHaveBeenCalledTimes(2);
    for (const call of (pusherServer.trigger as jest.Mock).mock.calls) {
      expect(call[0]).toBe(ALERT_CHANNEL);
      expect(call[1]).toBe(ALERT_EVENT_NAME);
    }
  });

  // Alerts do not share the public readings channel. The `private-` prefix is
  // what makes pusher-js authorize through /api/pusher/auth before it will
  // deliver anything; publishing to a public name would put rule names, device
  // ids and trigger values in reach of anyone holding NEXT_PUBLIC_PUSHER_KEY.
  it('should publish alerts on a private channel', () => {
    expect(ALERT_CHANNEL.startsWith('private-')).toBe(true);
    expect(ALERT_CHANNEL).not.toBe('InfraSight');
  });

  it('should send nothing when both lists are empty', async () => {
    await publishAlertEvents([], []);

    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });

  it('should swallow a Pusher failure', async () => {
    (pusherServer.trigger as jest.Mock).mockRejectedValueOnce(new Error('pusher down'));

    await expect(publishAlertEvents([fired(1)], [])).resolves.toBeUndefined();
  });
});
