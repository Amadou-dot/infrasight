/**
 * Staleness Sweep Tests
 */

import AlertV2 from '@/models/v2/AlertV2';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import { sweepStaleAlerts, STALE_AFTER_SECONDS } from '@/lib/alerting/sweep';
import { safeEvaluateReadings, safeSweepStaleAlerts } from '@/lib/alerting';
import * as monitoring from '@/lib/monitoring';
import { createAlertInput, resetCounters, createAlertRuleInput } from '../../../setup/factories';

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

describe('STALE_AFTER_SECONDS', () => {
  it('should default to 30 minutes', () => {
    expect(STALE_AFTER_SECONDS).toBe(1800);
  });
});

describe('sweepStaleAlerts', () => {
  beforeEach(() => {
    resetCounters();
  });

  it('should do nothing when there are no open alerts', async () => {
    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.deleted).toBe(0);
    expect(result.resolved).toEqual([]);
  });

  it('should leave a fresh alert on a reporting device alone', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_001', status: 'firing', last_observed_at: minutesAgo(1) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(0);
    expect((await AlertV2.findOne({}).lean())!.status).toBe('firing');
  });

  it('should resolve a firing alert whose device stopped reporting', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_gone', status: 'firing', last_observed_at: minutesAgo(1) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('device_inactive');

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('resolved');
    expect(stored!.is_open).toBe(false);
    expect(stored!.audit.resolution).toBe('device_inactive');
  });

  // sweep.ts has its own recordAlert('resolved', ...) call site, independent
  // of evaluate.ts's — evaluate.test.ts asserting alerts_resolved_total on an
  // auto-resolve does not exercise this one. Nothing elsewhere in the suite
  // checks that a SWEEP resolve moves the counter, so deleting this call site
  // alone would break zero tests.
  it('should increment alerts_resolved_total on a real sweep resolve', async () => {
    monitoring.resetMetrics();
    await AlertV2.create(
      createAlertInput({ device_id: 'device_gone', status: 'firing', last_observed_at: minutesAgo(1) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(1);
    const snapshot = monitoring.getMetricsSnapshot();
    const alerts = snapshot.alerts as Record<string, unknown>;
    const resolvedCounts = alerts.resolved as Record<string, number>;
    expect(resolvedCounts.device_inactive).toBe(1);
  });

  it('should resolve a firing alert that has gone stale', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_001', status: 'firing', last_observed_at: minutesAgo(60) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('stale');
  });

  it('should resolve an acknowledged alert the same way', async () => {
    await AlertV2.create(
      createAlertInput({
        device_id: 'device_001',
        status: 'acknowledged',
        last_observed_at: minutesAgo(60),
      })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(1);
    expect((await AlertV2.findOne({}).lean())!.status).toBe('resolved');
  });

  it('should DELETE a swept pending alert rather than resolving it', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_001', status: 'pending', last_observed_at: minutesAgo(60) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.deleted).toBe(1);
    expect(result.resolved).toHaveLength(0);
    expect(await AlertV2.countDocuments({})).toBe(0);
  });

  it('should never touch an already-resolved alert', async () => {
    await AlertV2.create(
      createAlertInput({
        device_id: 'device_gone',
        status: 'resolved',
        is_open: false,
        last_observed_at: minutesAgo(600),
      })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.deleted).toBe(0);
    expect(result.resolved).toHaveLength(0);
  });

  it('should prefer device_inactive over stale when both apply', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_gone', status: 'firing', last_observed_at: minutesAgo(600) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved[0].resolution).toBe('device_inactive');
  });

  it('should not delete a pending alert promoted to firing between the sweep read and its write', async () => {
    // Seed a pending alert whose device is absent from the reporting set, so
    // the sweep's OWN snapshot read sees it as 'pending' and queues it for
    // deletion (toDelete), not resolution.
    const alert = await AlertV2.create(
      createAlertInput({ device_id: 'device_gone', status: 'pending', last_observed_at: minutesAgo(60) })
    );

    // The race has to land strictly between the snapshot read and the bulk
    // write, or the guarded deleteMany is never even constructed (that was
    // the bug in the test this replaces: promoting before calling
    // sweepStaleAlerts made the sweep's own `find` see 'firing' already, so
    // `toDelete` stayed empty and the guard was never exercised). Spying on
    // bulkWrite is the only hook with the right timing.
    const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
    const bulkWriteSpy = jest
      .spyOn(AlertV2, 'bulkWrite')
      .mockImplementationOnce(async (writes, options) => {
        await AlertV2.updateOne({ _id: alert._id }, { $set: { status: 'firing' } });
        return realBulkWrite(writes, options);
      });

    const result = await sweepStaleAlerts(new Set(['device_001']));

    // The status-guarded deleteMany must not match a document that is no
    // longer 'pending' by the time the write reaches the server.
    expect(result.deleted).toBe(0);
    expect(result.resolved).toHaveLength(0);

    const stored = await AlertV2.findOne({ _id: alert._id }).lean();
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe('firing');
    expect(stored!.is_open).toBe(true);

    bulkWriteSpy.mockRestore();
  });

  it('should not resolve a stale alert as stale once a fresh observation lands before the write', async () => {
    // Stale AT SNAPSHOT TIME on a reporting device: deviceInactive is false,
    // so this can only take the 'stale' branch, which is exactly the branch
    // 1a guards.
    const alert = await AlertV2.create(
      createAlertInput({ device_id: 'device_001', status: 'firing', last_observed_at: minutesAgo(60) })
    );

    // Between the snapshot read and the write, a concurrent evaluateReadings()
    // records a fresh breaching observation — the episode is breaching again
    // and must not be closed out from under it.
    const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
    const bulkWriteSpy = jest
      .spyOn(AlertV2, 'bulkWrite')
      .mockImplementationOnce(async (writes, options) => {
        await AlertV2.updateOne({ _id: alert._id }, { $set: { last_observed_at: new Date() } });
        return realBulkWrite(writes, options);
      });

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(0);
    expect(result.deleted).toBe(0);

    const stored = await AlertV2.findOne({ _id: alert._id }).lean();
    expect(stored!.status).toBe('firing');
    expect(stored!.is_open).toBe(true);
    expect(stored!.audit.resolution).toBeUndefined();

    bulkWriteSpy.mockRestore();
  });

  it('should report deleted as the actual deletedCount, not the candidate count', async () => {
    // Two pending alerts on non-reporting devices are both delete candidates
    // at snapshot time; only one survives to the write untouched.
    const untouched = await AlertV2.create(
      createAlertInput({ device_id: 'device_gone_1', status: 'pending', last_observed_at: minutesAgo(60) })
    );
    const promoted = await AlertV2.create(
      createAlertInput({ device_id: 'device_gone_2', status: 'pending', last_observed_at: minutesAgo(60) })
    );

    const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
    const bulkWriteSpy = jest
      .spyOn(AlertV2, 'bulkWrite')
      .mockImplementationOnce(async (writes, options) => {
        // Only ONE of the two candidates races to 'firing' before the write.
        await AlertV2.updateOne({ _id: promoted._id }, { $set: { status: 'firing' } });
        return realBulkWrite(writes, options);
      });

    const result = await sweepStaleAlerts(new Set(['device_001']));

    // toDelete had 2 candidates; only 1 delete actually landed.
    expect(result.deleted).toBe(1);

    expect(await AlertV2.findById(untouched._id).lean()).toBeNull();
    expect((await AlertV2.findById(promoted._id).lean())!.status).toBe('firing');

    bulkWriteSpy.mockRestore();
  });

  it('should exclude an alert a concurrent writer already resolved from resolved[]', async () => {
    const alert = await AlertV2.create(
      createAlertInput({ device_id: 'device_gone', status: 'firing', last_observed_at: minutesAgo(1) })
    );

    // A different writer (e.g. a human PATCHing the alert to 'resolved')
    // closes this SAME episode first, with its own timestamp, between the
    // sweep's snapshot read and its write. The timestamp is deliberately NOT
    // `new Date()`: the reconciliation query keys on `audit.resolved_at ===
    // now`, and a concurrent write racing in on the same tick can land in the
    // same millisecond as the sweep's `now`, which would make this test pass
    // for the wrong reason (coincidental timestamp equality) instead of
    // proving the sweep's own guarded updateOne failed to match.
    const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
    const bulkWriteSpy = jest
      .spyOn(AlertV2, 'bulkWrite')
      .mockImplementationOnce(async (writes, options) => {
        await AlertV2.updateOne(
          { _id: alert._id },
          {
            $set: {
              status: 'resolved',
              is_open: false,
              'audit.resolved_at': minutesAgo(5),
              'audit.resolved_by': 'human@example.com',
              'audit.resolution': 'manual',
            },
          }
        );
        return realBulkWrite(writes, options);
      });

    const result = await sweepStaleAlerts(new Set(['device_001']));

    // The sweep's own updateOne (filter: { is_open: true, ... }) cannot match
    // a document the concurrent writer already closed, so this episode must
    // not be reported as one the SWEEP resolved.
    expect(result.resolved).toHaveLength(0);

    const stored = await AlertV2.findOne({ _id: alert._id }).lean();
    expect(stored!.audit.resolution).toBe('manual'); // untouched by the sweep

    bulkWriteSpy.mockRestore();
  });
});

describe('safe wrappers', () => {
  beforeEach(() => {
    monitoring.resetMetrics();
  });

  it('should swallow an evaluation error and return an empty result', async () => {
    // A matching rule is MANDATORY here. Without one, no (rule, device) pair is
    // formed, evaluateReadings short-circuits on `pairs.size === 0` BEFORE it
    // ever calls AlertV2.find, and the mocked throw is never reached — the
    // assertion would then pass whether or not the try/catch does anything.
    await AlertRuleV2.create(
      createAlertRuleInput({
        metric: 'value',
        comparison: 'gt',
        threshold: 0,
        selector: { types: ['temperature'] },
      })
    );

    const spy = jest.spyOn(AlertV2, 'find').mockImplementationOnce(() => {
      throw new Error('database exploded');
    });
    const errorSpy = jest.spyOn(monitoring.logger, 'error').mockImplementation(() => undefined);
    const captureSpy = jest
      .spyOn(monitoring, 'captureException')
      .mockImplementation(() => undefined);

    const result = await safeEvaluateReadings(
      [{ metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' }, timestamp: new Date(), value: 1 }] as never,
      [{ _id: 'device_001', type: 'temperature', location: { building_id: 'HQ', floor: 1, room_name: 'X' }, metadata: { tags: [], department: 'x' } }] as never
    );

    expect(result.fired).toEqual([]);
    // Proves the catch block actually executed, rather than the happy path
    // returning an empty result for unrelated reasons.
    expect(spy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    // The console line the logger produces never leaves the process, and the
    // counter resets on every cold start. Sentry is the one channel that
    // survives both, so a swallowed evaluator error must reach it — tagged so
    // it can be triaged as an alerting failure rather than a generic exception.
    // The tag rides in the THIRD argument (Sentry tags), not folded into the
    // second (context/"Additional Data") — see lib/monitoring/sentry.ts.
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(expect.any(Error), undefined, {
      subsystem: 'alerting',
    });
    // Not just "called with an Error" — the SAME error that was thrown, not a
    // placeholder constructed independently of it.
    expect(captureSpy.mock.calls[0][0].message).toBe('database exploded');

    // Exact labelled value via getMetricsSnapshot(), per the brief — not
    // "some metric changed". resetMetrics() in beforeEach makes 1 the whole
    // count for this test, not a delta against unrelated prior activity.
    const snapshot = monitoring.getMetricsSnapshot();
    const alerts = snapshot.alerts as Record<string, unknown>;
    expect(alerts.evaluationErrors).toBe(1);

    spy.mockRestore();
    errorSpy.mockRestore();
    captureSpy.mockRestore();
  });

  it('should swallow a sweep error', async () => {
    const spy = jest.spyOn(AlertV2, 'find').mockImplementationOnce(() => {
      throw new Error('database exploded');
    });
    const errorSpy = jest.spyOn(monitoring.logger, 'error').mockImplementation(() => undefined);
    const captureSpy = jest
      .spyOn(monitoring, 'captureException')
      .mockImplementation(() => undefined);

    const result = await safeSweepStaleAlerts(new Set(['device_001']));

    expect(result).toEqual({ deleted: 0, resolved: [] });
    // Proves the catch block actually executed, rather than the happy path
    // returning an empty result for unrelated reasons (e.g. no open alerts) —
    // { deleted: 0, resolved: [] } is byte-identical to that early return.
    expect(spy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(expect.any(Error), undefined, {
      subsystem: 'alerting',
    });
    expect(captureSpy.mock.calls[0][0].message).toBe('database exploded');

    const snapshot = monitoring.getMetricsSnapshot();
    const alerts = snapshot.alerts as Record<string, unknown>;
    expect(alerts.evaluationErrors).toBe(1);

    spy.mockRestore();
    errorSpy.mockRestore();
    captureSpy.mockRestore();
  });

  // The whole point of catching around captureException (see the doc comment
  // on reportToSentry in lib/alerting/index.ts) is that a misbehaving Sentry
  // SDK must not turn an already-handled evaluator/sweep error into an
  // unhandled one. These two tests make captureException itself throw and
  // rely on Jest failing the test via an unhandled rejection if the wrapper
  // ever lets that propagate — there is no try/catch around the `await`
  // below to hide it.

  it('should not throw when captureException itself throws (evaluator path)', async () => {
    await AlertRuleV2.create(
      createAlertRuleInput({
        metric: 'value',
        comparison: 'gt',
        threshold: 0,
        selector: { types: ['temperature'] },
      })
    );

    const findSpy = jest.spyOn(AlertV2, 'find').mockImplementationOnce(() => {
      throw new Error('database exploded');
    });
    const errorSpy = jest.spyOn(monitoring.logger, 'error').mockImplementation(() => undefined);
    const captureSpy = jest.spyOn(monitoring, 'captureException').mockImplementation(() => {
      throw new Error('sentry sdk exploded');
    });

    const result = await safeEvaluateReadings(
      [{ metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' }, timestamp: new Date(), value: 1 }] as never,
      [{ _id: 'device_001', type: 'temperature', location: { building_id: 'HQ', floor: 1, room_name: 'X' }, metadata: { tags: [], department: 'x' } }] as never
    );

    // Still the normal swallow-and-return-empty behavior, unchanged by the
    // second failure.
    expect(result.fired).toEqual([]);
    expect(result.resolved).toEqual([]);
    // Proves captureException was actually reached (and threw), not skipped
    // for some unrelated reason.
    expect(captureSpy).toHaveBeenCalledTimes(1);

    findSpy.mockRestore();
    errorSpy.mockRestore();
    captureSpy.mockRestore();
  });

  it('should not throw when captureException itself throws (sweep path)', async () => {
    const findSpy = jest.spyOn(AlertV2, 'find').mockImplementationOnce(() => {
      throw new Error('database exploded');
    });
    const errorSpy = jest.spyOn(monitoring.logger, 'error').mockImplementation(() => undefined);
    const captureSpy = jest.spyOn(monitoring, 'captureException').mockImplementation(() => {
      throw new Error('sentry sdk exploded');
    });

    const result = await safeSweepStaleAlerts(new Set(['device_001']));

    expect(result).toEqual({ deleted: 0, resolved: [] });
    expect(captureSpy).toHaveBeenCalledTimes(1);

    findSpy.mockRestore();
    errorSpy.mockRestore();
    captureSpy.mockRestore();
  });
});
