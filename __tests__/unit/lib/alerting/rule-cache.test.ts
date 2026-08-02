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

describe('normalizeRule', () => {
  it('should stringify an ObjectId _id', () => {
    const oid = new Types.ObjectId();
    const normalized = normalizeRule({ _id: oid, name: 'X' });

    expect(normalized._id).toBe(String(oid));
    expect(typeof normalized._id).toBe('string');
  });

  it('should leave an already-stringified _id alone (Redis round trip)', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(normalizeRule({ _id: id, name: 'X' })._id).toBe(id);
  });
});

describe('loadActiveRules', () => {
  beforeEach(() => {
    resetCounters();
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

  it('should report the longest cooldown across all rules', () => {
    const buckets = buildRuleBuckets([
      cachedRule({ cooldown_seconds: 300 }),
      cachedRule({ cooldown_seconds: 900 }),
      cachedRule({ cooldown_seconds: 0 }),
    ]);

    expect(buckets.maxCooldownSeconds).toBe(900);
  });

  it('should report zero max cooldown when no rule has one', () => {
    expect(buildRuleBuckets([cachedRule({ cooldown_seconds: 0 })]).maxCooldownSeconds).toBe(0);
  });

  it('should produce empty buckets for an empty rule set', () => {
    const { byType, ruleCount, maxCooldownSeconds } = buildRuleBuckets([]);

    expect(ruleCount).toBe(0);
    expect(maxCooldownSeconds).toBe(0);
    for (const rules of byType.values()) expect(rules).toHaveLength(0);
  });
});
