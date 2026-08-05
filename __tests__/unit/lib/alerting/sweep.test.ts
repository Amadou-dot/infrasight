/**
 * Staleness Sweep Tests
 */

import AlertV2 from '@/models/v2/AlertV2';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import { sweepStaleAlerts, STALE_AFTER_SECONDS } from '@/lib/alerting/sweep';
import { safeEvaluateReadings, safeSweepStaleAlerts } from '@/lib/alerting';
import * as notifyModule from '@/lib/alerting/notify';
import * as monitoring from '@/lib/monitoring';
import { createAlertInput, resetCounters, createAlertRuleInput } from '../../../setup/factories';

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

describe('STALE_AFTER_SECONDS', () => {
  it('should default to 30 minutes', () => {
    expect(STALE_AFTER_SECONDS).toBe(1800);
  });

  // STALE_AFTER_SECONDS is computed once at module load from
  // ALERT_STALE_AFTER_SECONDS, so exercising a different env value requires a
  // fresh module instance — jest.resetModules() + a dynamic require, the same
  // technique __tests__/unit/lib/sentry.test.ts uses for its own
  // env-driven, import-time configuration.
  describe('malformed ALERT_STALE_AFTER_SECONDS', () => {
    const original = process.env.ALERT_STALE_AFTER_SECONDS;

    afterEach(() => {
      if (original === undefined) delete process.env.ALERT_STALE_AFTER_SECONDS;
      else process.env.ALERT_STALE_AFTER_SECONDS = original;
      jest.resetModules();
    });

    it('should fall back to 1800 and warn on a non-numeric value, instead of silently disabling staleness detection', () => {
      process.env.ALERT_STALE_AFTER_SECONDS = 'not-a-number';

      jest.resetModules();
      // Requiring monitoring fresh FIRST, then spying on its logger, then
      // requiring sweep fresh: sweep's own internal require of
      // '@/lib/monitoring' resolves to this exact cached instance (same
      // resolved path, same fresh registry generation), so the spy actually
      // intercepts the call sweep.ts makes — spying on the OLD top-level
      // `monitoring` import (from before resetModules) would not, since that
      // binds to a now-discarded module instance.
      const freshMonitoring = require('@/lib/monitoring');
      const warnSpy = jest.spyOn(freshMonitoring.logger, 'warn').mockImplementation(() => {});

      const fresh = require('@/lib/alerting/sweep');

      // Would be NaN under the old parseInt-with-no-guard code — proving
      // this assertion alone is not vacuous even without the warn check.
      expect(fresh.STALE_AFTER_SECONDS).toBe(1800);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Malformed ALERT_STALE_AFTER_SECONDS'),
        expect.objectContaining({ value: 'not-a-number' })
      );

      warnSpy.mockRestore();
    });

    it('should fall back to 1800 on a non-positive value', () => {
      process.env.ALERT_STALE_AFTER_SECONDS = '-30';

      jest.resetModules();
      const fresh = require('@/lib/alerting/sweep');

      expect(fresh.STALE_AFTER_SECONDS).toBe(1800);
    });

    it('should use a valid override unchanged', () => {
      process.env.ALERT_STALE_AFTER_SECONDS = '900';

      jest.resetModules();
      const fresh = require('@/lib/alerting/sweep');

      expect(fresh.STALE_AFTER_SECONDS).toBe(900);
    });
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

  // The test above deliberately avoids the same-millisecond case (see its
  // comment about `minutesAgo(5)`), which left exactly one hole: a foreign
  // resolution whose `audit.resolved_at` happens to EQUAL this sweep's `now`.
  // `audit.resolved_at` is written by three other paths — the evaluator's
  // auto-resolve on the ingest path, PATCH /alerts/[id] via AlertV2.resolve(),
  // and PATCH /alert-rules/[id]'s condition-change close — and ingest vs cron,
  // or a human clicking Resolve as a sweep runs, is ordinary concurrency.
  // Confirming on the timestamp alone would relabel any of them as the sweep's
  // own 'stale'/'device_inactive'. The predicate now also matches the
  // resolution the candidate's own op wrote.
  //
  // This is the resolve-side mirror of the fix applied to evaluateReadings'
  // Step 8 confirmation, and it is what keeps the two from confirming each
  // other: the sweep writes only 'stale'/'device_inactive', the evaluator only
  // 'auto', the manual paths only 'manual'.
  describe('resolve confirmation is exact, not merely same-instant', () => {
    /**
     * Seed one open episode, freeze the clock so the sweep's internal `now` is
     * knowable, and land a foreign resolution stamped with that exact `now`
     * between the sweep's snapshot read and its bulk write.
     *
     * `reportingDeviceIds` decides which branch the sweep takes:
     * a device absent from it resolves as 'device_inactive', a present one with
     * a stale observation resolves as 'stale'. Both are exercised below.
     */
    async function raceForeignResolution(
      deviceId: string,
      reporting: string[],
      resolveRacer: (id: string, now: Date) => Promise<unknown>
    ) {
      const alert = await AlertV2.create(
        createAlertInput({
          device_id: deviceId,
          status: 'firing',
          last_observed_at: minutesAgo(60),
        })
      );

      // Only Date is faked, so the real mongodb-memory-server connection's own
      // timers are untouched. Same technique as evaluate.test.ts's collision
      // tests — a same-millisecond collision cannot be expressed
      // deterministically while `new Date()` returns unpredictable wall clock.
      jest.useFakeTimers({
        doNotFake: [
          'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
          'setImmediate', 'clearImmediate', 'nextTick', 'hrtime', 'performance',
          'queueMicrotask',
        ],
      });
      // Deliberately AFTER the seed, so `last_observed_at: minutesAgo(60)` is a
      // real 60 minutes before the frozen `now` and the staleness cutoff bites.
      const now = new Date();
      jest.setSystemTime(now);

      try {
        const realBulkWrite = AlertV2.bulkWrite.bind(AlertV2);
        const bulkWriteSpy = jest
          .spyOn(AlertV2, 'bulkWrite')
          .mockImplementationOnce(async (writes, options) => {
            await resolveRacer(String(alert._id), now);
            return realBulkWrite(writes, options);
          });

        const result = await sweepStaleAlerts(new Set(reporting));
        bulkWriteSpy.mockRestore();
        return { result, alert, now };
      } finally {
        jest.useRealTimers();
      }
    }

    it("should not claim the evaluator's auto-resolve landing in the same millisecond", async () => {
      monitoring.resetMetrics();

      // Exactly what evaluateReadings' auto-resolve op writes, stamped with the
      // same `now` this sweep will use.
      const { result, alert } = await raceForeignResolution(
        'device_gone',
        ['device_001'],
        async (id, now) => {
          await AlertV2.updateOne(
            { _id: id, is_open: true },
            {
              $set: {
                status: 'resolved',
                is_open: false,
                'audit.updated_at': now,
                'audit.updated_by': 'system',
                'audit.resolved_at': now,
                'audit.resolved_by': 'system',
                'audit.resolution': 'auto',
              },
            }
          );
        }
      );

      // The sweep's own guarded updateOne matched nothing — is_open was already
      // false. audit.resolved_at equals its `now` only because the EVALUATOR
      // set it.
      expect(result.resolved).toHaveLength(0);
      expect(monitoring.getPrometheusMetrics()).not.toContain(
        'alerts_resolved_total{resolution="device_inactive"}'
      );

      // History is not relabelled: the problem really did clear, and the
      // timeline must not say the sensor merely went quiet.
      const stored = await AlertV2.findOne({ _id: alert._id }).lean();
      expect(stored!.audit.resolution).toBe('auto');
    });

    it('should not claim a manual resolution landing in the same millisecond', async () => {
      monitoring.resetMetrics();

      // The real static PATCH /api/v2/alerts/[id] calls. It stamps its own
      // `new Date()`, which under the frozen clock IS the sweep's `now` — the
      // collision arises naturally rather than being hand-constructed.
      const { result, alert } = await raceForeignResolution(
        'device_gone',
        ['device_001'],
        id => AlertV2.resolve(id, 'human@example.com', 'manual')
      );

      expect(result.resolved).toHaveLength(0);
      expect(monitoring.getPrometheusMetrics()).not.toContain(
        'alerts_resolved_total{resolution="device_inactive"}'
      );

      const stored = await AlertV2.findOne({ _id: alert._id }).lean();
      expect(stored!.audit.resolution).toBe('manual');
      expect(stored!.audit.resolved_by).toBe('human@example.com');
    });

    // The 'stale' branch takes a different filter from 'device_inactive' (it
    // carries the last_observed_at cutoff), so it needs its own collision case
    // rather than being assumed equivalent.
    it("should not claim a foreign resolution on the 'stale' branch either", async () => {
      monitoring.resetMetrics();

      // device_001 IS reporting, but its observation is an hour old — the only
      // way to reach the 'stale' branch.
      const { result, alert } = await raceForeignResolution(
        'device_001',
        ['device_001'],
        id => AlertV2.resolve(id, 'human@example.com', 'manual')
      );

      expect(result.resolved).toHaveLength(0);
      expect(monitoring.getPrometheusMetrics()).not.toContain(
        'alerts_resolved_total{resolution="stale"}'
      );

      const stored = await AlertV2.findOne({ _id: alert._id }).lean();
      expect(stored!.audit.resolution).toBe('manual');
    });

    // Without this, a predicate tightened until it never matches would pass all
    // three tests above while silently breaking the sweep entirely.
    it('should still report its own resolutions under the same frozen clock', async () => {
      monitoring.resetMetrics();

      const { result, alert } = await raceForeignResolution(
        'device_gone',
        ['device_001'],
        async () => {
          /* no racer: the sweep's own op is the only writer */
        }
      );

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].resolution).toBe('device_inactive');
      expect(monitoring.getPrometheusMetrics()).toContain(
        'alerts_resolved_total{resolution="device_inactive"} 1'
      );

      const stored = await AlertV2.findOne({ _id: alert._id }).lean();
      expect(stored!.audit.resolution).toBe('device_inactive');
    });

    // Both branches in ONE sweep, which is what makes a single blanket
    // predicate insufficient: the grouped $or must confirm each candidate
    // against the resolution ITS OWN op wrote, not against a shared value.
    it('should confirm a mixed stale/device_inactive sweep per candidate', async () => {
      monitoring.resetMetrics();

      const inactive = await AlertV2.create(
        createAlertInput({
          device_id: 'device_gone',
          status: 'firing',
          last_observed_at: minutesAgo(1),
        })
      );
      const stale = await AlertV2.create(
        createAlertInput({
          device_id: 'device_001',
          status: 'firing',
          last_observed_at: minutesAgo(60),
        })
      );

      const result = await sweepStaleAlerts(new Set(['device_001']));

      expect(result.resolved).toHaveLength(2);
      const byId = new Map(result.resolved.map(a => [a._id, a.resolution]));
      expect(byId.get(String(inactive._id))).toBe('device_inactive');
      expect(byId.get(String(stale._id))).toBe('stale');

      const prom = monitoring.getPrometheusMetrics();
      expect(prom).toContain('alerts_resolved_total{resolution="device_inactive"} 1');
      expect(prom).toContain('alerts_resolved_total{resolution="stale"} 1');
    });
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

  // publishAlertEvents runs in its OWN nested try/catch inside safeEvaluateReadings
  // and safeSweepStaleAlerts (lib/alerting/index.ts), separate from the try/catch
  // around the DB call. Spying on '@/lib/alerting/notify' rather than the
  // '@/lib/alerting' barrel is deliberate: index.ts imports publishAlertEvents
  // from './notify' directly (a relative import, resolving to the same module as
  // '@/lib/alerting/notify'), so a spy on the barrel's re-export would never
  // intercept the call index.ts actually makes — the exact dead-spy hazard this
  // suite was warned about for the PATCH route's own barrel import.
  it('should return the real evaluation result, not the empty fallback, when publishAlertEvents throws', async () => {
    await AlertRuleV2.create(
      createAlertRuleInput({
        metric: 'value',
        comparison: 'gt',
        threshold: 0,
        selector: { types: ['temperature'] },
      })
    );
    const publishSpy = jest
      .spyOn(notifyModule, 'publishAlertEvents')
      .mockRejectedValueOnce(new Error('pusher exploded'));
    const errorSpy = jest.spyOn(monitoring.logger, 'error').mockImplementation(() => undefined);
    const captureSpy = jest
      .spyOn(monitoring, 'captureException')
      .mockImplementation(() => undefined);

    const result = await safeEvaluateReadings(
      [{ metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' }, timestamp: new Date(), value: 1 }] as never,
      [{ _id: 'device_001', type: 'temperature', location: { building_id: 'HQ', floor: 1, room_name: 'X' }, metadata: { tags: [], department: 'x' } }] as never
    );

    // The evaluation itself succeeded and fired a real alert. If the broadcast
    // failure reached the outer catch, this would come back
    // emptyEvaluationResult() ({ fired: [], ... }) instead.
    expect(result.fired).toHaveLength(1);
    expect(await AlertV2.countDocuments({ status: 'firing' })).toBe(1);

    // A broadcast fault must never be mislabeled as an evaluation_error — that
    // counter is reserved for the DB call itself.
    const snapshot = monitoring.getMetricsSnapshot();
    const alerts = snapshot.alerts as Record<string, unknown>;
    expect(alerts.evaluationErrors).toBe(0);

    // Proves the mocked rejection was actually reached, not skipped.
    expect(publishSpy).toHaveBeenCalledTimes(1);

    // The nested catch around publishAlertEvents must still give the fault a
    // voice — a bare `catch {}` here would pass every assertion above while
    // producing zero log line and zero Sentry event. This is the exact gap
    // the backend review already flagged once for the alerting subsystem.
    expect(errorSpy).toHaveBeenCalledWith(
      'Alert broadcast failed after a committed write',
      expect.objectContaining({ error: 'pusher exploded' })
    );
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(expect.any(Error), undefined, {
      subsystem: 'alerting',
    });
    expect(captureSpy.mock.calls[0][0].message).toBe('pusher exploded');

    publishSpy.mockRestore();
    errorSpy.mockRestore();
    captureSpy.mockRestore();
  });

  it('should return the real sweep result, not the empty fallback, when publishAlertEvents throws', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_gone', status: 'firing', last_observed_at: minutesAgo(1) })
    );
    const publishSpy = jest
      .spyOn(notifyModule, 'publishAlertEvents')
      .mockRejectedValueOnce(new Error('pusher exploded'));
    const errorSpy = jest.spyOn(monitoring.logger, 'error').mockImplementation(() => undefined);
    const captureSpy = jest
      .spyOn(monitoring, 'captureException')
      .mockImplementation(() => undefined);

    const result = await safeSweepStaleAlerts(new Set(['device_001']));

    // The sweep itself succeeded and resolved a real alert. If the broadcast
    // failure reached the outer catch, this would come back
    // { deleted: 0, resolved: [] } instead — byte-identical to the DB-failure
    // fallback, which is exactly why this needs its own assertion on the DB
    // state, not just on the returned shape.
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('device_inactive');
    expect((await AlertV2.findOne({}).lean())!.status).toBe('resolved');

    const snapshot = monitoring.getMetricsSnapshot();
    const alerts = snapshot.alerts as Record<string, unknown>;
    expect(alerts.evaluationErrors).toBe(0);

    expect(publishSpy).toHaveBeenCalledTimes(1);

    // Same voice requirement as the evaluator path above.
    expect(errorSpy).toHaveBeenCalledWith(
      'Alert broadcast failed after a committed write',
      expect.objectContaining({ error: 'pusher exploded' })
    );
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(expect.any(Error), undefined, {
      subsystem: 'alerting',
    });
    expect(captureSpy.mock.calls[0][0].message).toBe('pusher exploded');

    publishSpy.mockRestore();
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
