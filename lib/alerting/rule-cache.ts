/**
 * Active alert rule loading, caching, and type bucketing.
 *
 * The rule set is read on every write path and changes almost never, so it is
 * cached with a short TTL and invalidated explicitly on every rule mutation.
 */

import AlertRuleV2, { READING_TYPES } from '@/models/v2/AlertRuleV2';
import type { ReadingType } from '@/models/v2/ReadingV2';
import { getOrSet } from '@/lib/cache/cache';
import { alertRulesKey } from '@/lib/cache/keys';
import type { CachedAlertRule } from './types';

export const ALERT_RULE_CACHE_TTL_SECONDS = 60;

export interface RuleBuckets {
  /** Every one of the 15 reading types is present, possibly with an empty array. */
  byType: Map<ReadingType, CachedAlertRule[]>;
  /** The longest cooldown across all active rules — bounds the cooldown lookback. */
  maxCooldownSeconds: number;
  ruleCount: number;
}

/**
 * Force `_id` to a string.
 *
 * MANDATORY. `getOrSet` stores through JSON.stringify, so a cache HIT yields a
 * string `_id` while a cache MISS yields an ObjectId. Writing that straight into
 * `AlertV2.rule_id` would produce documents whose `rule_id` type depends on cache
 * state, and the partial unique index would silently stop deduplicating. The
 * evaluator converts back with `new Types.ObjectId(rule._id)` at write time.
 */
export function normalizeRule(raw: unknown): CachedAlertRule {
  const rule = raw as CachedAlertRule & { _id: unknown };
  return { ...rule, _id: String(rule._id) };
}

export async function loadActiveRules(): Promise<CachedAlertRule[]> {
  const rules = await getOrSet<unknown[]>(
    alertRulesKey(),
    async () =>
      AlertRuleV2.find({
        enabled: true,
        'audit.deleted_at': { $exists: false },
      }).lean(),
    { ttl: ALERT_RULE_CACHE_TTL_SECONDS }
  );

  return rules.map(normalizeRule);
}

/**
 * Group rules by the reading type they apply to.
 *
 * A type-less rule is appended to every bucket ONCE, at build time, so matching
 * at evaluation stays O(readings x rules-for-that-type) rather than
 * O(readings x all-rules).
 */
export function buildRuleBuckets(rules: CachedAlertRule[]): RuleBuckets {
  const byType = new Map<ReadingType, CachedAlertRule[]>();
  for (const type of READING_TYPES) byType.set(type as ReadingType, []);

  let maxCooldownSeconds = 0;

  for (const rule of rules) {
    const targets = rule.selector?.types?.length
      ? rule.selector.types
      : (READING_TYPES as unknown as ReadingType[]);

    for (const type of targets) byType.get(type as ReadingType)?.push(rule);

    maxCooldownSeconds = Math.max(maxCooldownSeconds, rule.cooldown_seconds ?? 0);
  }

  return { byType, maxCooldownSeconds, ruleCount: rules.length };
}

export async function getRuleBuckets(): Promise<RuleBuckets> {
  return buildRuleBuckets(await loadActiveRules());
}
