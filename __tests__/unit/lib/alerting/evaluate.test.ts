/**
 * Alert Evaluation Tests
 */

import { Types } from 'mongoose';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import AlertV2 from '@/models/v2/AlertV2';
import { evaluateReadings, extractWriteErrors } from '@/lib/alerting/evaluate';
import { getMetricsSnapshot, getPrometheusMetrics, logger, resetMetrics } from '@/lib/monitoring';
import { createAlertInput, createAlertRuleInput, resetCounters } from '../../../setup/factories';
import type { EvaluableDevice, EvaluableReading } from '@/lib/alerting/types';

const DEVICE: EvaluableDevice = {
  _id: 'device_001',
  type: 'temperature',
  location: { building_id: 'HQ', floor: 3, room_name: 'Lab A', zone: 'north' },
  metadata: { tags: ['critical'], department: 'Facilities' },
} as EvaluableDevice;

function reading(value: number, at: Date, overrides: Partial<EvaluableReading> = {}): EvaluableReading {
  return {
    metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' },
    timestamp: at,
    value,
    quality: { is_valid: true, is_anomaly: false, anomaly_score: 0 },
    ...overrides,
  } as EvaluableReading;
}

/** A reading attributed to a device other than DEVICE. */
function readingFor(deviceId: string, value: number, at: Date): EvaluableReading {
  const r = reading(value, at);
  (r.metadata as { device_id: string }).device_id = deviceId;
  return r;
}

async function seedRule(overrides = {}) {
  return AlertRuleV2.create(
    createAlertRuleInput({
      name: 'High temp',
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      severity: 'critical',
      selector: { types: ['temperature'] },
      cooldown_seconds: 0,
      ...overrides,
    })
  );
}

/**
 * Insert a rule document straight through the driver, bypassing Mongoose
 * schema validation. This is how a malformed rule actually reaches the
 * evaluator: a seed or migration script writing directly, or a Redis cache
 * entry written before a schema change — a `.lean()` read or a cache hit
 * hands the evaluator whatever is stored, with no re-validation.
 */
async function seedRawRule(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  const doc = {
    name: 'Raw rule',
    enabled: true,
    selector: { types: ['temperature'] },
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    for_duration_seconds: 0,
    severity: 'critical',
    cooldown_seconds: 0,
    audit: { created_at: now, created_by: 'test', updated_at: now, updated_by: 'test' },
    ...overrides,
  };
  const { insertedId } = await AlertRuleV2.collection.insertOne(doc as never);
  return { ...doc, _id: insertedId };
}

describe('extractWriteErrors', () => {
  it('should normalize an array of write errors', () => {
    const err = { writeErrors: [{ index: 0, code: 11000 }, { index: 2, code: 121 }] };
    expect(extractWriteErrors(err)).toEqual([{ index: 0, code: 11000 }, { index: 2, code: 121 }]);
  });

  it('should normalize a single non-array write error', () => {
    const err = { writeErrors: { index: 1, code: 11000 } };
    expect(extractWriteErrors(err)).toEqual([{ index: 1, code: 11000 }]);
  });

  it('should return an empty array for an unrelated error', () => {
    expect(extractWriteErrors(new Error('boom'))).toEqual([]);
  });
});

describe('evaluateReadings', () => {
  beforeEach(() => {
    resetCounters();
    resetMetrics();
  });

  it('should return an empty result for empty inputs', async () => {
    const result = await evaluateReadings([], []);

    expect(result.fired).toEqual([]);
    expect(result.evaluatedPairs).toBe(0);
  });

  it('should open a firing alert immediately when for_duration_seconds is 0', async () => {
    const rule = await seedRule();

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].trigger_value).toBe(35);
    expect(result.fired[0].rule_name).toBe('High temp');
    // The counter moves with the notification, not just against it: the race
    // tests below prove it does not overcount, this proves it still counts.
    expect(getPrometheusMetrics()).toContain('alerts_fired_total{severity="critical"} 1');

    const stored = await AlertV2.findOne({ device_id: 'device_001' }).lean();
    expect(stored!.status).toBe('firing');
    expect(stored!.is_open).toBe(true);
    expect(String(stored!.rule_id)).toBe(String(rule._id));
    expect(stored!.fired_at).toBeInstanceOf(Date);
  });

  it('should not fire when the reading is within bounds', async () => {
    await seedRule();

    const result = await evaluateReadings([reading(20, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(await AlertV2.countDocuments({})).toBe(0);
  });

  it('should open a pending alert when for_duration_seconds is set', async () => {
    await seedRule({ for_duration_seconds: 300 });

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(result.pendingOpened).toBe(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('pending');
    expect(stored!.fired_at).toBeUndefined();
  });

  // `for_duration_seconds` symmetry: a NEW episode (no pending episode already
  // open) must fire immediately when the batch's OWN breach span already
  // satisfies the rule's duration, not only when a pending episode already
  // exists from a prior batch. See the promotion branch below for the mirror
  // case (a pending episode promoted across two batches).
  it('should fire immediately when a single batch already spans the full for_duration_seconds', async () => {
    await seedRule({ for_duration_seconds: 60 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:02:00.000Z'); // 120s later: twice the required duration

    const before = new Date();
    const result = await evaluateReadings([reading(35, t0), reading(36, t1)], [DEVICE]);
    const after = new Date();

    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].trigger_value).toBe(35); // earliest breaching reading

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('firing');
    expect(stored!.is_open).toBe(true);
    expect(new Date(stored!.breached_since).toISOString()).toBe(t0.toISOString());

    // fired_at must be the evaluation's wall-clock `now`, not the in-batch t1 —
    // matching the promotion branch, which also stamps `now`.
    const firedAtMs = new Date(stored!.fired_at!).getTime();
    expect(firedAtMs).toBeGreaterThanOrEqual(before.getTime());
    expect(firedAtMs).toBeLessThanOrEqual(after.getTime());
  });

  it("should stay pending when a single batch's breach span is shorter than for_duration_seconds", async () => {
    await seedRule({ for_duration_seconds: 60 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:00:30.000Z'); // 30s later: half the required duration

    const result = await evaluateReadings([reading(35, t0), reading(36, t1)], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(result.pendingOpened).toBe(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('pending');
    expect(stored!.fired_at).toBeUndefined();
    expect(new Date(stored!.breached_since).toISOString()).toBe(t0.toISOString());
  });

  it('should fire when a single batch spans exactly for_duration_seconds (inclusive boundary)', async () => {
    await seedRule({ for_duration_seconds: 60 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z'); // exactly 60s later: elapsedMs === duration * 1000

    const result = await evaluateReadings([reading(35, t0), reading(36, t1)], [DEVICE]);

    expect(result.fired).toHaveLength(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('firing');
    expect(stored!.fired_at).toBeInstanceOf(Date);
  });

  it('should promote pending to firing once the duration elapses', async () => {
    await seedRule({ for_duration_seconds: 60 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:02:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const result = await evaluateReadings([reading(36, t1)], [DEVICE]);

    expect(result.fired).toHaveLength(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('firing');
    expect(stored!.last_value).toBe(36);
    expect(new Date(stored!.breached_since).toISOString()).toBe(t0.toISOString());
  });

  it('should delete a pending alert when the condition clears first', async () => {
    await seedRule({ for_duration_seconds: 600 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const result = await evaluateReadings([reading(20, t1)], [DEVICE]);

    expect(result.pendingCleared).toBe(1);
    expect(await AlertV2.countDocuments({})).toBe(0);
  });

  // The deleteOne for a cleared pending episode (unlike every update op around
  // it) carries no last_observed_at guard of its own — the ONLY protection on
  // that path is the out-of-order check earlier in the loop that skips a pair
  // whose incoming observation is not newer than what is already stored. A
  // reading that arrives late (e.g. retried, replayed, or reordered in
  // transit) must not be able to destroy a live pending episode just because
  // it happens to be non-breaching.
  it('should not delete a live pending episode when a stale non-breaching reading arrives out of order', async () => {
    await seedRule({ for_duration_seconds: 600 });
    const late = new Date('2026-08-01T12:10:00.000Z');
    const stale = new Date('2026-08-01T12:00:00.000Z'); // earlier than `late`

    await evaluateReadings([reading(35, late)], [DEVICE]); // opens pending, last_observed_at = 12:10
    const result = await evaluateReadings([reading(20, stale)], [DEVICE]); // stale non-breach, arrives late

    expect(result.pendingCleared).toBe(0);
    expect(await AlertV2.countDocuments({ status: 'pending' })).toBe(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(new Date(stored!.last_observed_at).toISOString()).toBe(late.toISOString());
  });

  it('should auto-resolve a firing alert when the condition clears', async () => {
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:05:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const result = await evaluateReadings([reading(20, t1)], [DEVICE]);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('auto');
    expect(result.resolved[0].actor).toBe('system');
    expect(getPrometheusMetrics()).toContain('alerts_resolved_total{resolution="auto"} 1');

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('resolved');
    expect(stored!.is_open).toBe(false);
    expect(stored!.resolved_value).toBe(20);
  });

  it('should not open a second episode while one is already open', async () => {
    await seedRule();

    await evaluateReadings([reading(35, new Date('2026-08-01T12:00:00.000Z'))], [DEVICE]);
    const result = await evaluateReadings([reading(40, new Date('2026-08-01T12:01:00.000Z'))], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(await AlertV2.countDocuments({})).toBe(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.last_value).toBe(40);
    expect(stored!.trigger_value).toBe(35);
  });

  it('should not re-fire an acknowledged episode, but should keep tracking observations', async () => {
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:05:00.000Z'); // later than the acknowledged episode's last_observed_at

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const opened = await AlertV2.findOne({}).lean();
    await AlertV2.acknowledge(String(opened!._id), 'user_test');

    const result = await evaluateReadings([reading(40, t1)], [DEVICE]);

    expect(result.fired).toHaveLength(0);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('acknowledged');
    expect(stored!.is_open).toBe(true);
    expect(stored!.fired_at!.toISOString()).toBe(opened!.fired_at!.toISOString());
    expect(stored!.last_value).toBe(40);
  });

  it('should reduce by breach, not by recency', async () => {
    // breach -> clear -> breach inside ONE batch yields ONE episode whose
    // breached_since is the EARLIEST breaching reading.
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z');
    const t2 = new Date('2026-08-01T12:02:00.000Z');

    const result = await evaluateReadings(
      [reading(35, t0), reading(20, t1), reading(33, t2)],
      [DEVICE]
    );

    expect(result.fired).toHaveLength(1);
    expect(await AlertV2.countDocuments({})).toBe(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(new Date(stored!.breached_since).toISOString()).toBe(t0.toISOString());
    expect(stored!.trigger_value).toBe(35);
    expect(stored!.last_value).toBe(33);
    expect(new Date(stored!.last_observed_at).toISOString()).toBe(t2.toISOString());
  });

  it('should take last_value from the latest reading even when it does not breach', async () => {
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:05:00.000Z');

    await evaluateReadings([reading(35, t0), reading(28, t1)], [DEVICE]);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.last_value).toBe(28);
    expect(stored!.trigger_value).toBe(35);
  });

  it('should not rewind last_observed_at for an out-of-order batch', async () => {
    await seedRule();
    const late = new Date('2026-08-01T12:10:00.000Z');
    const early = new Date('2026-08-01T12:00:00.000Z');

    await evaluateReadings([reading(35, late)], [DEVICE]);
    await evaluateReadings([reading(99, early)], [DEVICE]);

    const stored = await AlertV2.findOne({}).lean();
    expect(new Date(stored!.last_observed_at).toISOString()).toBe(late.toISOString());
    expect(stored!.last_value).toBe(35);
  });

  it('should suppress a new episode inside the cooldown window', async () => {
    await seedRule({ cooldown_seconds: 3600 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z');
    const t2 = new Date('2026-08-01T12:02:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    await evaluateReadings([reading(20, t1)], [DEVICE]); // auto-resolves
    const result = await evaluateReadings([reading(35, t2)], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(result.suppressed).toBe(1);
    expect(await AlertV2.countDocuments({ is_open: true })).toBe(0);
  });

  it('should skip readings whose metric field is absent', async () => {
    await seedRule({ metric: 'battery_level', comparison: 'lt', threshold: 20, selector: {} });

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(result.evaluatedPairs).toBe(0);
  });

  it('should fire on anomaly_score', async () => {
    await seedRule({ metric: 'anomaly_score', comparison: 'gte', threshold: 0.8, selector: {} });

    const result = await evaluateReadings(
      [reading(22, new Date(), { quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.9 } } as Partial<EvaluableReading>)],
      [DEVICE]
    );

    expect(result.fired).toHaveLength(1);
  });

  it('should skip a reading whose device was not supplied', async () => {
    await seedRule();

    const orphan = reading(35, new Date());
    (orphan.metadata as { device_id: string }).device_id = 'device_999';

    const result = await evaluateReadings([orphan], [DEVICE]);

    expect(result.evaluatedPairs).toBe(0);
  });

  it('should not match a device outside the selector', async () => {
    await seedRule({ selector: { types: ['temperature'], building_id: 'Warehouse' } });

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0);
  });

  it('should rethrow a non-11000 bulk write error', async () => {
    await seedRule();
    const spy = jest.spyOn(AlertV2, 'bulkWrite').mockRejectedValueOnce(
      Object.assign(new Error('validation failed'), {
        writeErrors: [{ index: 0, code: 121 }],
      })
    );

    await expect(evaluateReadings([reading(35, new Date())], [DEVICE])).rejects.toThrow(
      'validation failed'
    );

    spy.mockRestore();
  });

  it('should absorb an 11000 duplicate and drop its notification', async () => {
    await seedRule();
    const spy = jest.spyOn(AlertV2, 'bulkWrite').mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key'), {
        writeErrors: [{ index: 0, code: 11000 }],
      })
    );

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0); // the other request won the race

    spy.mockRestore();
  });

  it('should not report a promotion whose guarded update matched nothing', async () => {
    await seedRule({ for_duration_seconds: 60 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:02:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const pending = await AlertV2.findOne({}).lean();

    // A concurrent evaluation promotes the SAME episode between this run's read
    // and its write, so this run's guarded updateOne (status: 'pending') matches
    // zero documents — a driver success that must not fire a notification.
    // Spying on bulkWrite is the only hook with the right timing; promoting
    // before the call would make this run's own `find` see 'firing' and never
    // construct the guarded op at all.
    //
    // The racing stamps are fixed values, deliberately NOT `new Date()`: the
    // reconciliation query keys on `audit.updated_at === now`, and a racing
    // write landing in the same millisecond as this run's `now` would confirm
    // the notification for the wrong reason.
    const raceStamp = new Date('2026-08-01T12:01:30.000Z');
    const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
    const bulkWriteSpy = jest
      .spyOn(AlertV2, 'bulkWrite')
      .mockImplementationOnce(async (writes, options) => {
        await AlertV2.updateOne(
          { _id: pending!._id },
          { $set: { status: 'firing', fired_at: raceStamp, 'audit.updated_at': raceStamp } }
        );
        return realBulkWrite(writes, options);
      });

    const result = await evaluateReadings([reading(36, t1)], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(getPrometheusMetrics()).not.toContain('alerts_fired_total{severity="critical"}');

    // Nothing this run intended reached the document: the other writer's
    // fired_at stands, and last_value/last_observed_at are still the t0 batch's.
    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.fired_at!.toISOString()).toBe(raceStamp.toISOString());
    expect(stored!.last_value).toBe(35);
    expect(new Date(stored!.last_observed_at).toISOString()).toBe(t0.toISOString());

    bulkWriteSpy.mockRestore();
  });

  it('should not report an auto-resolve whose guarded update matched nothing', async () => {
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:05:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const firing = await AlertV2.findOne({}).lean();

    // A human resolves the same episode through PATCH /alerts/[id] between this
    // run's read and its write, so this run's resolve op (is_open: true) matches
    // zero documents. Fixed stamps for the same reason as the test above.
    const raceStamp = new Date('2026-08-01T12:03:00.000Z');
    const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
    const bulkWriteSpy = jest
      .spyOn(AlertV2, 'bulkWrite')
      .mockImplementationOnce(async (writes, options) => {
        await AlertV2.updateOne(
          { _id: firing!._id },
          {
            $set: {
              status: 'resolved',
              is_open: false,
              'audit.updated_at': raceStamp,
              'audit.resolved_at': raceStamp,
              'audit.resolved_by': 'human@example.com',
              'audit.resolution': 'manual',
            },
          }
        );
        return realBulkWrite(writes, options);
      });

    const result = await evaluateReadings([reading(20, t1)], [DEVICE]);

    expect(result.resolved).toHaveLength(0);
    expect(getPrometheusMetrics()).not.toContain('alerts_resolved_total{resolution="auto"}');

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.audit.resolution).toBe('manual'); // untouched by the evaluator
    expect(stored!.resolved_value).toBeUndefined();

    bulkWriteSpy.mockRestore();
  });

  it('should not confirm a promotion via audit.updated_at alone when a concurrent write shares only that stamp', async () => {
    await seedRule({ for_duration_seconds: 60 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:02:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const pending = await AlertV2.findOne({}).lean();

    // Freeze the clock so THIS run's internal `now` (used for both its own
    // $set write and the Step 8 reconciliation query) is a value the test
    // knows in advance — without that, a same-millisecond collision cannot
    // be expressed deterministically, since `new Date()` would otherwise
    // return real wall-clock time that the test cannot predict. Only `Date`
    // is faked (see doNotFake) so the real mongodb-memory-server connection's
    // own timers are untouched.
    const now = new Date('2026-08-01T12:02:00.500Z');
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'setImmediate', 'clearImmediate', 'nextTick', 'hrtime', 'performance',
        'queueMicrotask',
      ],
    });
    jest.setSystemTime(now);

    try {
      // A concurrent writer promotes the SAME episode with ITS OWN fired_at
      // timestamp (raceStamp, deliberately different from `now`), but its
      // write also happens to stamp audit.updated_at to exactly `now` — as a
      // genuinely concurrent evaluator's own `now` landing in the same
      // millisecond would. Under the OLD predicate (`audit.updated_at: now`
      // alone), that alone was enough to confirm THIS run's promotion
      // notification, even though this run's own guarded updateOne (below,
      // via the real bulkWrite) never matches anything — status is no
      // longer 'pending' by the time it runs.
      const raceStamp = new Date('2026-08-01T12:01:45.000Z');
      const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
      const bulkWriteSpy = jest
        .spyOn(AlertV2, 'bulkWrite')
        .mockImplementationOnce(async (writes, options) => {
          await AlertV2.updateOne(
            { _id: pending!._id },
            { $set: { status: 'firing', fired_at: raceStamp, 'audit.updated_at': now } }
          );
          return realBulkWrite(writes, options);
        });

      const result = await evaluateReadings([reading(36, t1)], [DEVICE]);

      // This run's own guarded update matched nothing — the document's
      // audit.updated_at equals this run's `now` only because the RACER set
      // it, not because this run's promotion landed. fired_at was never
      // touched by this run, so the fixed predicate must not confirm it.
      expect(result.fired).toHaveLength(0);
      expect(getPrometheusMetrics()).not.toContain('alerts_fired_total{severity="critical"}');

      const stored = await AlertV2.findOne({}).lean();
      expect(stored!.fired_at!.toISOString()).toBe(raceStamp.toISOString());

      bulkWriteSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should count pending clears from the deletes that actually landed', async () => {
    await seedRule({ for_duration_seconds: 600 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z');
    const otherDevice = { ...DEVICE, _id: 'device_002' } as EvaluableDevice;

    await evaluateReadings(
      [readingFor('device_001', 35, t0), readingFor('device_002', 35, t0)],
      [DEVICE, otherDevice]
    );
    expect(await AlertV2.countDocuments({ status: 'pending' })).toBe(2);

    // Both episodes clear in the next batch, so both are delete candidates. Only
    // one of them races to 'firing' before the write, and its deleteOne is
    // guarded on status: 'pending', so only one delete can land.
    const promoted = await AlertV2.findOne({ device_id: 'device_002' }).lean();
    const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
    const bulkWriteSpy = jest
      .spyOn(AlertV2, 'bulkWrite')
      .mockImplementationOnce(async (writes, options) => {
        await AlertV2.updateOne({ _id: promoted!._id }, { $set: { status: 'firing' } });
        return realBulkWrite(writes, options);
      });

    const result = await evaluateReadings(
      [readingFor('device_001', 20, t1), readingFor('device_002', 20, t1)],
      [DEVICE, otherDevice]
    );

    expect(result.pendingCleared).toBe(1);
    expect(await AlertV2.countDocuments({})).toBe(1);
    expect((await AlertV2.findOne({}).lean())!.device_id).toBe('device_002');

    bulkWriteSpy.mockRestore();
  });

  it('should absorb a real duplicate key error and still count the delete that landed', async () => {
    await AlertV2.init(); // the partial unique index must exist to produce E11000
    const rule = await seedRule({ for_duration_seconds: 600 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z');
    const otherDevice = { ...DEVICE, _id: 'device_002' } as EvaluableDevice;

    await evaluateReadings([readingFor('device_001', 35, t0)], [DEVICE]);

    // Another request opens the episode this batch is about to insert for
    // device_002, so the partial unique index turns the evaluator's insertOne
    // into a genuine E11000 — while `ordered: false` still lets the deleteOne
    // for device_001's cleared episode through.
    const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
    const bulkWriteSpy = jest
      .spyOn(AlertV2, 'bulkWrite')
      .mockImplementationOnce(async (writes, options) => {
        await AlertV2.create(
          createAlertInput({ rule_id: rule._id, device_id: 'device_002', status: 'pending' })
        );
        return realBulkWrite(writes, options);
      });

    const result = await evaluateReadings(
      [readingFor('device_001', 20, t1), readingFor('device_002', 35, t1)],
      [DEVICE, otherDevice]
    );

    // The duplicate is absorbed, and the delete that ran alongside it is still
    // counted — the driver reports it on the error rather than on a result.
    expect(result.pendingCleared).toBe(1);
    expect(await AlertV2.countDocuments({ device_id: 'device_001' })).toBe(0);
    expect(await AlertV2.countDocuments({ device_id: 'device_002' })).toBe(1);

    bulkWriteSpy.mockRestore();
  });

  it('should record evaluation duration when the bulk write throws', async () => {
    await seedRule();
    const spy = jest.spyOn(AlertV2, 'bulkWrite').mockRejectedValueOnce(
      Object.assign(new Error('validation failed'), {
        writeErrors: [{ index: 0, code: 121 }],
      })
    );

    await expect(evaluateReadings([reading(35, new Date())], [DEVICE])).rejects.toThrow(
      'validation failed'
    );

    expect(getPrometheusMetrics()).toContain('alert_evaluation_duration_ms_count 1');

    spy.mockRestore();
  });

  it('should record evaluation duration on the empty-input early return', async () => {
    await evaluateReadings([], []);

    expect(getPrometheusMetrics()).toContain('alert_evaluation_duration_ms_count 1');
  });

  it('should handle a fleet-wide rule across many devices in one write', async () => {
    await seedRule({ selector: { types: ['temperature'] } });
    const devices = Array.from({ length: 20 }, (_, i) => ({
      ...DEVICE,
      _id: `device_${String(i).padStart(3, '0')}`,
    })) as EvaluableDevice[];
    const now = new Date();
    const readings = devices.map(d => {
      const r = reading(35, now);
      (r.metadata as { device_id: string }).device_id = String(d._id);
      return r;
    });

    const bulkSpy = jest.spyOn(AlertV2, 'bulkWrite');
    const result = await evaluateReadings(readings, devices);

    expect(result.fired).toHaveLength(20);
    expect(bulkSpy).toHaveBeenCalledTimes(1);

    bulkSpy.mockRestore();
  });

  // The module's central cost claim (evaluate.ts:6-13): the number of AlertV2
  // round trips does not scale with batch size. Both phases below are FRESH
  // inserts against disjoint device ids — no existing episode, and
  // cooldown_seconds: 0 from seedRule()'s defaults — so both take the exact
  // same query shape: one `find` for openEpisodes, no cooldown lookback (
  // maxCooldownSeconds stays 0), and no write-confirmation reconciliation
  // query (insertOne notifications are confirmed via failedIndices, which
  // costs nothing extra — only a guarded updateOne needs the follow-up
  // `find`). What is asserted is that the two counts are EQUAL to each
  // other, not that either equals some specific number: the post-Task-2
  // reconciliation query changed the absolute count without breaking the
  // constant-per-batch-size invariant this test is about.
  it('should keep the AlertV2.find call count constant regardless of batch size', async () => {
    await seedRule({ selector: { types: ['temperature'] } });

    const findSpy = jest.spyOn(AlertV2, 'find');

    await evaluateReadings([reading(35, new Date())], [DEVICE]);
    const smallBatchCalls = findSpy.mock.calls.length;
    findSpy.mockClear();

    const devices = Array.from({ length: 50 }, (_, i) => ({
      ...DEVICE,
      _id: `device_bulk_${String(i).padStart(3, '0')}`,
    })) as EvaluableDevice[];
    const now = new Date();
    const readings: EvaluableReading[] = [];
    // 10 readings per device (500 total), all breaching, at distinct
    // timestamps within the batch — exercises the same per-pair reduction as
    // a real high-volume ingest, not just "50 pairs of 1 reading each".
    for (const d of devices)
      for (let j = 0; j < 10; j++) {
        const r = reading(35 + (j % 5), new Date(now.getTime() + j * 1000));
        (r.metadata as { device_id: string }).device_id = String(d._id);
        readings.push(r);
      }
    expect(readings).toHaveLength(500);

    const result = await evaluateReadings(readings, devices);
    const largeBatchCalls = findSpy.mock.calls.length;

    expect(result.fired).toHaveLength(50); // sanity: the batch actually reduced to 50 pairs
    expect(smallBatchCalls).toBeGreaterThan(0); // sanity: the spy actually observed calls
    expect(largeBatchCalls).toBe(smallBatchCalls);

    findSpy.mockRestore();
  });

  describe('per-rule error boundary', () => {
    it('should skip a rule with an unknown metric and still fire the valid rule', async () => {
      await seedRawRule({ name: 'Bad metric rule', metric: 'not_a_real_metric' });
      await seedRule(); // 'High temp': metric 'value', threshold 30

      const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

      expect(result.fired).toHaveLength(1);
      expect(result.fired[0].rule_name).toBe('High temp');
      expect(getPrometheusMetrics()).toContain(
        'alert_rules_skipped_total{reason="unknown_metric"} 1'
      );
    });

    it('should skip a rule with a non-hex _id and still fire the valid rule', async () => {
      await seedRawRule({ name: 'Bad id rule', _id: 'not-a-valid-object-id' });
      await seedRule();

      const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

      expect(result.fired).toHaveLength(1);
      expect(result.fired[0].rule_name).toBe('High temp');
      expect(getPrometheusMetrics()).toContain(
        'alert_rules_skipped_total{reason="invalid_rule_id"} 1'
      );
    });

    it('should count a skipped rule via getMetricsSnapshot()', async () => {
      await seedRawRule({ name: 'Bad metric rule', metric: 'not_a_real_metric' });

      const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

      expect(result.evaluatedPairs).toBe(0); // the only rule in play was unusable
      const snapshot = getMetricsSnapshot();
      const alerts = snapshot.alerts as Record<string, unknown>;
      const rulesSkipped = alerts.rulesSkipped as Record<string, number>;
      expect(rulesSkipped.unknown_metric).toBe(1);
    });

    it('should log the skipped rule with ruleId, ruleName, metric, and error', async () => {
      const bad = await seedRawRule({ name: 'Bad metric rule', metric: 'not_a_real_metric' });
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      await evaluateReadings([reading(35, new Date())], [DEVICE]);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          ruleId: String(bad._id),
          ruleName: 'Bad metric rule',
          metric: 'not_a_real_metric',
          error: expect.any(String),
        })
      );

      errorSpy.mockRestore();
    });

    it('should log and count a fleet-wide bad rule at most once per call, not once per reading', async () => {
      // A valid metric and a valid (auto-generated) _id, so this rule clears
      // validateRule and is cached there as GOOD — proving this test exercises
      // the dedup around the general matching try/catch, not validateRule's own
      // per-rule cache, which a rule rejected for an unknown metric or a bad id
      // would never get past in the first place.
      //
      // `selector.tags` is a string, not an array: `.every` is not a function on
      // a string, so matchesSelector throws on every reading, not just the first.
      await seedRawRule({
        name: 'Bad selector rule',
        selector: { types: ['temperature'], tags: 'not-an-array' },
      });
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      await evaluateReadings(
        [
          reading(35, new Date('2026-08-01T12:00:00.000Z')),
          reading(36, new Date('2026-08-01T12:01:00.000Z')),
          reading(37, new Date('2026-08-01T12:02:00.000Z')),
        ],
        [DEVICE]
      );

      // Three readings against the bad rule, one bad rule: without the per-call
      // dedup this would log and count three times, not one.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(getPrometheusMetrics()).toContain(
        'alert_rules_skipped_total{reason="unexpected_error"} 1'
      );

      errorSpy.mockRestore();
    });
  });

  describe('index-enforced dedup', () => {
    // evaluate.test.ts's other "should not open a second episode" coverage
    // (see above) only proves the in-memory `openByPair` map works WITHIN one
    // call — it is rebuilt fresh on every invocation and cannot see a write a
    // different, concurrent call has not committed yet. What actually keeps
    // two INDEPENDENT calls from opening two open episodes for the same
    // (rule, device) pair is MongoDB's partial unique index
    // (models/v2/AlertV2.ts) — see rule-cache.ts:24-32 for the failure mode
    // this guards: a rule_id written as a string rather than an ObjectId
    // would silently stop colliding with itself under that index.
    it("should let the partial unique index — not the in-memory map — dedupe two concurrent evaluateReadings calls", async () => {
      await AlertV2.init(); // the partial unique index must exist to be exercised
      await seedRule();
      const t0 = new Date('2026-08-01T12:00:00.000Z');

      // Force the two calls to genuinely race: the "concurrent" call is run
      // to completion strictly between this run's own `find` (which sees no
      // existing episode, since neither call has written yet) and its
      // `bulkWrite` (which is about to insert one). Spying on bulkWrite is
      // the only hook with that timing — the same technique used throughout
      // this file for the other read/write races. The nested call's OWN
      // bulkWrite is NOT intercepted: mockImplementationOnce's queue is
      // already consumed by THIS invocation, so it falls through to the real
      // implementation automatically.
      const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
      const bulkWriteSpy = jest
        .spyOn(AlertV2, 'bulkWrite')
        .mockImplementationOnce(async (writes, options) => {
          const nested = await evaluateReadings([reading(35, t0)], [DEVICE]);
          expect(nested.fired).toHaveLength(1); // the "other request" that wins the race
          return realBulkWrite(writes, options);
        });

      const result = await evaluateReadings([reading(35, t0)], [DEVICE]);

      // The two assertions the brief calls for, checked first so a mutation
      // that breaks either one is never masked by the supporting checks below.
      expect(await AlertV2.countDocuments({ is_open: true })).toBe(1);
      const stored = await AlertV2.findOne({ is_open: true }).lean();
      expect(stored!.rule_id).toBeInstanceOf(Types.ObjectId);

      // Supporting detail: this run's own insert lost the race (E11000,
      // absorbed) — its notification must not have landed either.
      expect(result.fired).toHaveLength(0);

      bulkWriteSpy.mockRestore();
    });
  });
});
