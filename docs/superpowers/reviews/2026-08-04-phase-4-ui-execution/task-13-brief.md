### Task 13: Bounded Pusher delivery

**One trigger per evaluation is constant in call count, not in body size, and Pusher caps an event at 10 KB.** A floor-wide condition firing across hundreds of devices in one cron run would overflow that cap, the trigger would throw, and this design swallows Pusher failures — so the UI would silently miss the single most dramatic event it exists to display. The failure mode is exactly inverted from what alerting is for.

**Files:**
- Create: `lib/alerting/notify.ts`
- Modify: `lib/alerting/index.ts` (publish from `safeEvaluateReadings` and `safeSweepStaleAlerts`)
- Modify: `app/api/v2/alerts/[id]/route.ts` (broadcast manual resolutions, Step 5)
- Modify: `app/api/v2/cron/simulate/route.ts` (broadcast only persisted readings, Step 6)
- Test: `__tests__/unit/lib/alerting/notify.test.ts`
- Test: `__tests__/integration/api/alerts.integration.test.ts` (Step 5) and the cron route's integration test (Step 6)

**Interfaces:**
- Consumes: `FiredAlert`, `ResolvedAlert`, `AlertEvent` from `@/types/v2/alert.types` (Task 3); `pusherServer` from `@/lib/pusher`.
- Produces:
  - `export const ALERT_EVENT_NAME = 'alert-event'`, `ALERT_EVENT_MAX = 20`, `ALERT_EVENT_MAX_BYTES = 8192`
  - `export function buildFiredEnvelope(alerts: FiredAlert[]): AlertEvent | null`
  - `export function buildResolvedEnvelope(alerts: ResolvedAlert[]): AlertEvent | null`
  - `export async function publishAlertEvents(fired: FiredAlert[], resolved: ResolvedAlert[]): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/alerting/notify.test.ts`:

```typescript
/**
 * Bounded Pusher Alert Delivery Tests
 */

import {
  buildFiredEnvelope,
  buildResolvedEnvelope,
  publishAlertEvents,
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

    expect(buildFiredEnvelope(alerts)!.kind).toBe('storm');
  });
});

describe('buildResolvedEnvelope', () => {
  it('should apply the same bounds', () => {
    expect(buildResolvedEnvelope([])).toBeNull();
    expect(buildResolvedEnvelope([resolved(1)])!.kind).toBe('resolved');
    expect(
      buildResolvedEnvelope(Array.from({ length: 25 }, (_, i) => resolved(i)))!.kind
    ).toBe('storm');
  });
});

describe('publishAlertEvents', () => {
  it('should send both envelopes on the single alert-event name', async () => {
    await publishAlertEvents([fired(1)], [resolved(2)]);

    expect(pusherServer.trigger).toHaveBeenCalledTimes(2);
    for (const call of (pusherServer.trigger as jest.Mock).mock.calls) {
      expect(call[0]).toBe('InfraSight');
      expect(call[1]).toBe(ALERT_EVENT_NAME);
    }
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/alerting/notify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the notifier**

Create `lib/alerting/notify.ts`:

```typescript
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

function stormEnvelope(alerts: TimestampedAlert[]): AlertEvent {
  const by_severity: Record<AlertSeverity, number> = { info: 0, warning: 0, critical: 0 };
  for (const alert of alerts) by_severity[alert.severity]++;

  const since = alerts
    .map(timestampOf)
    .reduce((earliest, ts) => (ts < earliest ? ts : earliest), timestampOf(alerts[0]));

  return { kind: 'storm', count: alerts.length, by_severity, since };
}

function bound(envelope: AlertEvent, alerts: TimestampedAlert[]): AlertEvent {
  if (alerts.length > ALERT_EVENT_MAX) return stormEnvelope(alerts);
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > ALERT_EVENT_MAX_BYTES)
    return stormEnvelope(alerts);
  return envelope;
}

export function buildFiredEnvelope(alerts: FiredAlert[]): AlertEvent | null {
  if (alerts.length === 0) return null;
  return bound({ kind: 'fired', alerts }, alerts as unknown as TimestampedAlert[]);
}

export function buildResolvedEnvelope(alerts: ResolvedAlert[]): AlertEvent | null {
  if (alerts.length === 0) return null;
  return bound({ kind: 'resolved', alerts }, alerts as unknown as TimestampedAlert[]);
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
```

- [ ] **Step 4: Publish from the safe wrappers**

In `lib/alerting/index.ts`, import `publishAlertEvents` and call it from both wrappers, inside the `try` so a broadcast problem is also isolated:

```typescript
import { publishAlertEvents } from './notify';

// inside safeEvaluateReadings, after `const result = await evaluateReadings(...)`:
    await publishAlertEvents(result.fired, result.resolved);
    return result;

// inside safeSweepStaleAlerts, after `const result = await sweepStaleAlerts(...)`:
    await publishAlertEvents([], result.resolved);
    return result;
```

Add `export { publishAlertEvents, ALERT_EVENT_NAME, ALERT_EVENT_MAX, ALERT_EVENT_MAX_BYTES } from './notify';` to the re-export block.

- [ ] **Step 5: Broadcast manual resolutions too**

A manual resolve through `PATCH /api/v2/alerts/[id]` must also reach open lists, or one admin's action leaves every other viewer's list stale until it refetches. In `app/api/v2/alerts/[id]/route.ts` (Task 10), after a successful `resolved` transition:

```typescript
import { publishAlertEvents } from '@/lib/alerting';

// ...inside handleUpdateAlert, after `if (status === 'resolved') recordAlert(...)`:
    if (status === 'resolved')
      await publishAlertEvents(
        [],
        [
          {
            _id: String(updated._id),
            rule_id: String(updated.rule_id),
            device_id: updated.device_id,
            severity: updated.severity,
            resolution: 'manual',
            resolved_at: new Date().toISOString(),
            // The Clerk USER ID, never getAuditUser's email — this payload
            // reaches every connected client, including anonymous demo visitors.
            actor: userId,
          },
        ]
      );
```

Acknowledgement is deliberately **not** broadcast: it changes no list membership (`is_open` stays true), and the acting admin already gets feedback from their own mutation's cache invalidation.

Add this assertion to `__tests__/integration/api/alerts.integration.test.ts`:

```typescript
  it('should broadcast a manual resolution with the user id, never an email', async () => {
    const spy = jest.spyOn(alerting, 'publishAlertEvents').mockResolvedValue(undefined);
    const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

    await PATCH(
      createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'resolved' }),
      { params: params(String(alert._id)) }
    );

    const [, resolvedArg] = spy.mock.calls[0];
    expect(resolvedArg[0].actor).toBe('user_test_admin');
    expect(resolvedArg[0].actor).not.toContain('@');

    spy.mockRestore();
  });
```

with `import * as alerting from '@/lib/alerting';` added to that file.

- [ ] **Step 6: Stop broadcasting readings that never persisted**

While this task owns Pusher payload correctness, close the one remaining case on the cron path. `app/api/v2/cron/simulate/route.ts` already captures the persisted subset — `const insertedReadings = await ReadingV2.bulkInsertReadings(newReadings)` — because `bulkInsertReadings` runs `insertMany({ ordered: false })` and silently skips documents that fail validation. Alert evaluation correctly uses `insertedReadings`. **The Pusher trigger still sends `newReadings`**, so a rejected reading is broadcast to every connected client as though it were stored, and the surrounding comment claiming otherwise is false.

```typescript
    // 3. Trigger Real-time Update (The "Hot" Path). Broadcast only what was
    //    actually written — a rejected reading must never appear on a client
    //    tile as though it were stored. toObject() strips the Mongoose
    //    document wrapper; versionKey: false keeps `__v` out of a payload
    //    that is already sized against Pusher's 10 KB cap.
    try {
      await pusherServer.trigger(
        'InfraSight',
        'new-readings',
        insertedReadings.map(r => r.toObject({ versionKey: false }))
      );
    } catch (pusherError) {
      logger.error('Pusher trigger failed after successful DB write', {
        error: pusherError instanceof Error ? pusherError.message : String(pusherError),
        readingsCount: insertedReadings.length,
      });
    }
```

Note `readingsCount` moves to `insertedReadings.length` too — the old value overstated what the failed broadcast would have carried.

Add a case to the cron route's existing integration test asserting that a batch with one rejected reading broadcasts `insertedReadings.length` rows, not `newReadings.length`. Drive the rejection through `bulkInsertReadings` rather than mocking the trigger's argument, or the test proves nothing about the wiring.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test __tests__/unit/lib/alerting __tests__/integration/api`
Expected: PASS. The existing evaluate and sweep suites must stay green — `publishAlertEvents` is only called from the wrappers, not from `evaluateReadings` itself.

Then: `npx tsc --noEmit && pnpm lint` — 0 errors, 0 problems.

- [ ] **Step 8: Commit**

Two commits; the cron payload fix is unrelated to alert delivery and should not be buried in it:

```bash
git add lib/alerting/notify.ts lib/alerting/index.ts app/api/v2/alerts/[id]/route.ts __tests__/unit/lib/alerting/notify.test.ts __tests__/integration/api/alerts.integration.test.ts
git commit -m "feat(alerting): broadcast bounded alert events over Pusher"

git add app/api/v2/cron/simulate/route.ts __tests__/integration/api
git commit -m "fix(cron): broadcast only the readings that persisted"
```

---

