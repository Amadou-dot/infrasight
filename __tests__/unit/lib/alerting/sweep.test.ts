/**
 * Staleness Sweep Tests
 */

import AlertV2 from '@/models/v2/AlertV2';
import { sweepStaleAlerts, STALE_AFTER_SECONDS } from '@/lib/alerting/sweep';
import { safeEvaluateReadings, safeSweepStaleAlerts } from '@/lib/alerting';
import { createAlertInput, resetCounters } from '../../../setup/factories';

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
});

describe('safe wrappers', () => {
  it('should swallow an evaluation error and return an empty result', async () => {
    const spy = jest.spyOn(AlertV2, 'find').mockImplementationOnce(() => {
      throw new Error('database exploded');
    });

    const result = await safeEvaluateReadings(
      [{ metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' }, timestamp: new Date(), value: 1 }] as never,
      [{ _id: 'device_001', type: 'temperature', location: { building_id: 'HQ', floor: 1, room_name: 'X' }, metadata: { tags: [], department: 'x' } }] as never
    );

    expect(result.fired).toEqual([]);
    spy.mockRestore();
  });

  it('should swallow a sweep error', async () => {
    const spy = jest.spyOn(AlertV2, 'find').mockImplementationOnce(() => {
      throw new Error('database exploded');
    });

    const result = await safeSweepStaleAlerts(new Set(['device_001']));

    expect(result).toEqual({ deleted: 0, resolved: [] });
    spy.mockRestore();
  });
});
