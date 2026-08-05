/**
 * Alert Rule Cache and Bucketing Tests
 */

import { Types } from 'mongoose';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import {
  loadActiveRules,
  buildRuleBuckets,
  normalizeRule,
  ALERT_RULE_CACHE_TTL_SECONDS,
} from '@/lib/alerting/rule-cache';
import { getMetricsSnapshot, getPrometheusMetrics, logger, resetMetrics } from '@/lib/monitoring';
import { createAlertRuleInput, resetCounters } from '../../../setup/factories';
import type { CachedAlertRule } from '@/lib/alerting/types';

function cachedRule(overrides: Partial<CachedAlertRule> = {}): CachedAlertRule {
  return {
    _id: String(new Types.ObjectId()),
    name: 'Rule',
    enabled: true,
    selector: { types: ['temperature'] },
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    for_duration_seconds: 0,
    severity: 'warning',
    cooldown_seconds: 300,
    audit: {
      created_at: new Date(),
      created_by: 'test',
      updated_at: new Date(),
      updated_by: 'test',
    },
    ...overrides,
  } as CachedAlertRule;
}

/**
 * Write a rule document straight through the driver, bypassing Mongoose schema
 * validation. This is how a malformed rule actually reaches the cache: a seed
 * or migration script writing directly, or a Redis entry written before a
 * schema change — a `.lean()` read or a cache hit hands whatever is stored
 * onward with no re-validation.
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

describe('normalizeRule', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should stringify an ObjectId _id', () => {
    const oid = new Types.ObjectId();
    const normalized = normalizeRule(cachedRule({ _id: oid as unknown as string }));

    expect(normalized!._id).toBe(String(oid));
    expect(typeof normalized!._id).toBe('string');
  });

  it('should leave an already-stringified _id alone (Redis round trip)', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(normalizeRule(cachedRule({ _id: id }))!._id).toBe(id);
  });

  it('should return the original object, not the schema-stripped parse output', () => {
    const rule = cachedRule();

    const normalized = normalizeRule(rule)!;

    // `audit` and `enabled` are not in the validation schema (the evaluator
    // never reads them). Returning `parsed.data` would silently delete them.
    expect(normalized.audit).toEqual(rule.audit);
    expect(normalized.enabled).toBe(true);
  });

  // ------------------------------------------------------------------------
  // E5: the cached shape is validated, not asserted.
  //
  // Each of these used to be waved through by an `as CachedAlertRule` cast. The
  // two named consequences: a bad `comparison` reached `compare()`'s
  // `default: return false` and silently never fired, and a bad `severity`
  // produced a non-E11000 write error that cost the WHOLE evaluation batch.
  // ------------------------------------------------------------------------
  describe('validation', () => {
    // The field list is the contract, so it is enumerated rather than
    // spot-checked: the pre-fix compensating checks covered 2 of these.
    it.each([
      ['_id', 'invalid_rule_id', { _id: 'not-a-hex-object-id' }],
      ['metric', 'unknown_metric', { metric: 'not_a_metric' }],
      ['comparison', 'unexpected_error', { comparison: 'approximately' }],
      ['severity', 'unexpected_error', { severity: 'apocalyptic' }],
      ['threshold', 'unexpected_error', { threshold: 'thirty' }],
      ['name', 'unexpected_error', { name: '' }],
      ['selector', 'unexpected_error', { selector: { types: ['temperature'], tags: 'not-an-array' } }],
      ['for_duration_seconds', 'unexpected_error', { for_duration_seconds: '300' }],
      ['cooldown_seconds', 'unexpected_error', { cooldown_seconds: -1 }],
    ])('should skip a rule with an invalid %s and count it as %s', (_field, reason, bad) => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = normalizeRule(cachedRule(bad as Partial<CachedAlertRule>));

      expect(result).toBeNull();
      const skipped = (getMetricsSnapshot().alerts as Record<string, unknown>)
        .rulesSkipped as Record<string, number>;
      expect(skipped[reason as string]).toBe(1);

      // Skipped is not the same as silent — the whole point of the finding.
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });

    it('should skip a cached entry that is not an object at all', () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      expect(normalizeRule(null)).toBeNull();
      expect(normalizeRule('a string')).toBeNull();
      expect(normalizeRule([])).toBeNull();

      expect(warnSpy).toHaveBeenCalledTimes(3);
      expect(getPrometheusMetrics()).toContain(
        'alert_rules_skipped_total{reason="unexpected_error"} 3'
      );

      warnSpy.mockRestore();
    });

    it('should log the rule id, the reason, and the failing field', () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const id = '507f1f77bcf86cd799439011';

      normalizeRule(cachedRule({ _id: id, name: 'Broken rule', comparison: 'sideways' as never }));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          ruleId: id,
          ruleName: 'Broken rule',
          reason: 'unexpected_error',
          issues: expect.arrayContaining([expect.stringContaining('comparison')]),
        })
      );

      warnSpy.mockRestore();
    });

    it('should accept a rule that omits the optional duration fields', () => {
      const rule = cachedRule();
      delete (rule as Partial<CachedAlertRule>).for_duration_seconds;
      delete (rule as Partial<CachedAlertRule>).cooldown_seconds;

      expect(normalizeRule(rule)).not.toBeNull();
    });

    it('should accept a fleet-wide rule with no selector at all', () => {
      const rule = cachedRule({ metric: 'battery_level' });
      delete (rule as Partial<CachedAlertRule>).selector;

      expect(normalizeRule(rule)).not.toBeNull();
    });
  });
});

describe('loadActiveRules', () => {
  beforeEach(() => {
    resetCounters();
    resetMetrics();
  });

  it('should load only enabled, non-deleted rules', async () => {
    await AlertRuleV2.create(createAlertRuleInput({ name: 'Enabled' }));
    await AlertRuleV2.create(createAlertRuleInput({ name: 'Disabled', enabled: false }));
    const deleted = await AlertRuleV2.create(createAlertRuleInput({ name: 'Deleted' }));
    await AlertRuleV2.softDelete(String(deleted._id), 'admin');

    const rules = await loadActiveRules();

    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('Enabled');
  });

  it('should return _id as a string on the fresh path', async () => {
    await AlertRuleV2.create(createAlertRuleInput());

    const rules = await loadActiveRules();

    expect(typeof rules[0]._id).toBe('string');
  });

  it('should return an empty array when no rules exist', async () => {
    expect(await loadActiveRules()).toEqual([]);
  });

  it('should use a 60 second TTL', () => {
    expect(ALERT_RULE_CACHE_TTL_SECONDS).toBe(60);
  });

  // E5's second named consequence, at the level where it actually bites: one
  // unusable rule must cost only itself. Before the fix a bad `severity`
  // survived the cast, reached the evaluator's bulk write as a schema
  // violation, and produced a non-E11000 error that lost the entire batch —
  // so every OTHER rule's alerts were lost too.
  it('should drop only the invalid rule and keep the rest of the batch', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await seedRawRule({ name: 'Bad severity', severity: 'apocalyptic' });
    await seedRawRule({ name: 'Bad comparison', comparison: 'approximately' });
    await AlertRuleV2.create(createAlertRuleInput({ name: 'Good rule' }));

    const rules = await loadActiveRules();

    expect(rules.map(r => r.name)).toEqual(['Good rule']);
    expect(getPrometheusMetrics()).toContain(
      'alert_rules_skipped_total{reason="unexpected_error"} 2'
    );

    warnSpy.mockRestore();
  });
});

describe('buildRuleBuckets', () => {
  it('should bucket a typed rule into exactly its own types', () => {
    const rule = cachedRule({ selector: { types: ['temperature', 'humidity'] } });

    const { byType } = buildRuleBuckets([rule]);

    expect(byType.get('temperature')).toHaveLength(1);
    expect(byType.get('humidity')).toHaveLength(1);
    expect(byType.get('power')).toHaveLength(0);
  });

  it('should append a type-less rule to every bucket', () => {
    const fleetWide = cachedRule({ metric: 'battery_level', selector: {} });

    const { byType } = buildRuleBuckets([fleetWide]);

    expect(byType.size).toBe(15);
    for (const rules of byType.values()) expect(rules).toHaveLength(1);
  });

  it('should treat an empty types array the same as absent', () => {
    const { byType } = buildRuleBuckets([cachedRule({ selector: { types: [] } })]);

    expect(byType.get('power')).toHaveLength(1);
  });

  // Two tests covering `RuleBuckets.maxCooldownSeconds` used to sit here. That
  // field has been removed: it had no production consumer, and its doc comment
  // claimed it "bounds the cooldown lookback" when the lookback is computed
  // independently — and more narrowly — inside evaluateReadings()
  // (lib/alerting/evaluate.ts), over only the rules that actually matched a
  // reading in the batch. Nothing observable was lost with it.

  it('should produce empty buckets for an empty rule set', () => {
    const { byType, ruleCount } = buildRuleBuckets([]);

    expect(ruleCount).toBe(0);
    for (const rules of byType.values()) expect(rules).toHaveLength(0);
  });

  it('should count and log a rule whose selector names a type with no bucket', () => {
    resetMetrics();
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    // Reaching this branch requires a rule that got past normalizeRule's
    // selector validation carrying a type READING_TYPES has no bucket for — a
    // divergence the compile-time guard on READING_TYPES exists to prevent.
    // Constructed by hand here precisely because it must not be SILENT if that
    // guard is ever removed or bypassed: `byType.get(type)?.push(rule)` used to
    // drop the rule with no error, no metric and no log.
    const rogue = cachedRule({ selector: { types: ['plasma' as unknown as 'temperature'] } });

    const { byType } = buildRuleBuckets([rogue]);

    for (const rules of byType.values()) expect(rules).toHaveLength(0);

    const skipped = (getMetricsSnapshot().alerts as Record<string, unknown>)
      .rulesSkipped as Record<string, number>;
    expect(skipped.unexpected_error).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
