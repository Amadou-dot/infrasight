/**
 * Seed Alert Rule Tests
 *
 * The seeded rule set is what makes Phase 4 visible on a fresh database, and it
 * is also the fixture that proves optional selector.types is load-bearing.
 */

import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import { buildAlertRuleSeeds } from '@/scripts/v2/alert-rule-seeds';

describe('buildAlertRuleSeeds', () => {
  it('should produce four rules', () => {
    expect(buildAlertRuleSeeds()).toHaveLength(4);
  });

  it('should include a duration-gated temperature rule', () => {
    const rule = buildAlertRuleSeeds().find(r => r.selector.types?.includes('temperature'));

    expect(rule).toBeDefined();
    expect(rule!.metric).toBe('value');
    expect(rule!.for_duration_seconds).toBe(300);
  });

  it('should include a fleet-wide low-battery rule with no selector.types', () => {
    const rule = buildAlertRuleSeeds().find(r => r.metric === 'battery_level');

    expect(rule).toBeDefined();
    expect(rule!.selector.types).toBeUndefined();
    expect(rule!.comparison).toBe('lt');
  });

  it('should include an anomaly_score rule bounded to 0-1', () => {
    const rule = buildAlertRuleSeeds().find(r => r.metric === 'anomaly_score');

    expect(rule).toBeDefined();
    expect(rule!.threshold).toBeGreaterThanOrEqual(0);
    expect(rule!.threshold).toBeLessThanOrEqual(1);
  });

  it('should give every value-metric rule a non-empty selector.types', () => {
    for (const rule of buildAlertRuleSeeds())
      if (rule.metric === 'value') expect(rule.selector.types!.length).toBeGreaterThan(0);
  });

  it('should produce rules the model accepts', async () => {
    await AlertRuleV2.insertMany(buildAlertRuleSeeds());

    expect(await AlertRuleV2.countDocuments({})).toBe(4);
  });

  // The test above proves little on its own: if Mongoose's insertMany silently
  // dropped an invalid document instead of throwing, countDocuments could still
  // read back something other than 4 and fail for an unrelated reason, or -
  // worse - a partial insert could coincidentally still total 4 someday if the
  // seed count changes. This test pins down the actual contract: insertMany is
  // called with its default options (no `ordered: false`) everywhere in this
  // module and in scripts/v2/seed-v2.ts, and under that default a single
  // schema-violating document rejects the WHOLE batch, inserting nothing.
  // Verified empirically against this repo's Mongoose version (see task report):
  // with `{ ordered: false }` the same corrupted batch instead inserts the 3
  // valid docs and silently drops the bad one - which is the exact failure mode
  // this test exists to rule out for the real seed set.
  it('should reject the whole batch, inserting nothing, if a seed violated the schema', async () => {
    const corrupted: unknown[] = [
      ...buildAlertRuleSeeds().slice(1),
      { ...buildAlertRuleSeeds()[0], metric: 'not_a_real_metric' },
    ];

    await expect(AlertRuleV2.insertMany(corrupted)).rejects.toThrow(/validation failed/i);
    expect(await AlertRuleV2.countDocuments({})).toBe(0);
  });

  // The "no selector.types" assertion above runs against the plain object
  // buildAlertRuleSeeds() returns, which trivially has no `types` key - it
  // proves nothing about what Mongoose does with it. AlertRuleV2 gives its
  // selector array paths `default: undefined` specifically so persisting
  // `selector: {}` does not silently turn into `selector: { types: [] }` (see
  // models/v2/AlertRuleV2.ts). Only a real round trip through MongoDB, read
  // back the same way the rule cache reads it (lib/alerting/rule-cache.ts uses
  // `.lean()`), proves that override still holds for these exact seeds.
  it('should keep a fleet-wide seed selector.types genuinely absent (not []) after a lean round trip', async () => {
    await AlertRuleV2.insertMany(buildAlertRuleSeeds());

    const persisted = await AlertRuleV2.findOne({ metric: 'battery_level' }).lean();

    expect(persisted).not.toBeNull();
    expect(persisted!.selector?.types).toBeUndefined();
    expect(Array.isArray(persisted!.selector?.types)).toBe(false);
  });

  // Same claim, but through a hydrated (non-lean) document, which is the one
  // read path where Mongoose actually reconstructs the `selector` subdocument
  // via its schema default and would reveal an unguarded array path defaulting
  // to `[]`. This is the version of the check that goes red if AlertRuleV2's
  // `default: undefined` override on `types` is ever removed.
  it('should keep selector.types undefined on a hydrated re-read of a fleet-wide seed too', async () => {
    const [, , lowBattery] = buildAlertRuleSeeds();
    expect(lowBattery.metric).toBe('battery_level');

    await AlertRuleV2.insertMany([lowBattery]);
    const rehydrated = await AlertRuleV2.findOne({ metric: 'battery_level' });

    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.selector?.types).toBeUndefined();
    expect(Array.isArray(rehydrated!.selector?.types)).toBe(false);
  });
});
