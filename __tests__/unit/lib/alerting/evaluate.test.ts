/**
 * Alert Evaluation Tests
 */

import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import AlertV2 from '@/models/v2/AlertV2';
import { evaluateReadings, extractWriteErrors } from '@/lib/alerting/evaluate';
import { createAlertRuleInput, resetCounters } from '../../../setup/factories';
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

  it('should auto-resolve a firing alert when the condition clears', async () => {
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:05:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const result = await evaluateReadings([reading(20, t1)], [DEVICE]);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('auto');
    expect(result.resolved[0].actor).toBe('system');

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
});
