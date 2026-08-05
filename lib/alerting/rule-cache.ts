/**
 * Active alert rule loading, caching, and type bucketing.
 *
 * The rule set is read on every write path and changes almost never, so it is
 * cached with a short TTL and invalidated explicitly on every rule mutation.
 */

import { z } from 'zod';
import AlertRuleV2, { READING_TYPES } from '@/models/v2/AlertRuleV2';
import type { ReadingType } from '@/models/v2/ReadingV2';
import { getOrSet } from '@/lib/cache/cache';
import { alertRulesKey } from '@/lib/cache/keys';
import { logger, recordAlertRuleSkipped, type AlertRuleSkipReason } from '@/lib/monitoring';
import {
  alertComparisonSchema,
  alertMetricSchema,
  alertRuleSelectorSchema,
  alertSeveritySchema,
} from '@/lib/validations/v2/alert-rule.validation';
import type { CachedAlertRule } from './types';

export const ALERT_RULE_CACHE_TTL_SECONDS = 60;

export interface RuleBuckets {
  /**
   * Every one of the 15 reading types is present, possibly with an empty array.
   *
   * "Every one" is guaranteed by the exhaustiveness assertions on
   * `READING_TYPES` (models/v2/AlertRuleV2.ts): a reading type added to
   * `ReadingType` but not to that list is a `tsc` error, because a missing
   * bucket here is invisible at runtime — see `bucketFor` below.
   */
  byType: Map<ReadingType, CachedAlertRule[]>;
  ruleCount: number;
}

/**
 * The shape the evaluator actually consumes, validated rather than asserted.
 *
 * Every field the evaluator reads off a rule is here, and nothing else: the
 * point is not to re-validate a rule document, it is to establish that THIS
 * object can be used to evaluate readings and to write an AlertV2. The
 * enum/selector pieces are imported from the API's own schemas
 * (`lib/validations/v2/alert-rule.validation.ts`) rather than restated, so the
 * edge and the cache cannot drift apart on what a legal value is.
 *
 * `for_duration_seconds` and `cooldown_seconds` are optional because the
 * evaluator reads them as `?? 0` — but they must be NUMBERS when present, since
 * a stringified `"300"` would silently corrupt the duration arithmetic instead
 * of failing.
 */
const cachedAlertRuleSchema = z.object({
  _id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Rule _id must be a 24-character hex ObjectId string'),
  name: z.string().min(1, 'Rule name is required').max(200),
  selector: alertRuleSelectorSchema.optional(),
  metric: alertMetricSchema,
  comparison: alertComparisonSchema,
  threshold: z.number(),
  for_duration_seconds: z.number().int().min(0).max(86400).optional(),
  severity: alertSeveritySchema,
  cooldown_seconds: z.number().int().min(0).max(86400).optional(),
});

/**
 * Map a validation failure onto one of the three skip reasons the metrics
 * surface already knows. `_id` and `metric` keep the labels the evaluator's own
 * per-rule guard uses for the same two problems, so one dashboard query covers
 * a rule rejected at cache-load time and one rejected at evaluation time.
 */
function skipReasonFor(issues: readonly { path: PropertyKey[] }[]): AlertRuleSkipReason {
  const fields = new Set(issues.map(issue => String(issue.path[0])));
  if (fields.has('_id')) return 'invalid_rule_id';
  if (fields.has('metric')) return 'unknown_metric';
  return 'unexpected_error';
}

/**
 * Validate one cached/lean rule and force its `_id` to a string.
 *
 * TWO jobs, both mandatory, and neither is optional politeness:
 *
 * 1. `_id` normalization. `getOrSet` stores through JSON.stringify, so a cache
 *    HIT yields a string `_id` while a cache MISS yields an ObjectId. Writing
 *    that straight into `AlertV2.rule_id` would produce documents whose
 *    `rule_id` type depends on cache state, and the partial unique index would
 *    silently stop deduplicating. The evaluator converts back with
 *    `new Types.ObjectId(rule._id)` at write time.
 *
 * 2. Shape validation. Nothing between Mongo and here re-validates: a `.lean()`
 *    read returns whatever a seed script or migration wrote, and a Redis entry
 *    returns whatever was cached before the last schema change. Asserting the
 *    type instead of checking it produced two silent failures — a bad
 *    `comparison` fell through `compare()`'s `default: return false` and simply
 *    never fired, and a bad `severity` produced a non-E11000 write error that
 *    cost the ENTIRE evaluation batch rather than just that rule.
 *
 * Returns null for a rule that cannot be used, after counting and logging it.
 * The side effect lives here, not in the caller, so a rule can never be dropped
 * without the drop being observable.
 */
export function normalizeRule(raw: unknown): CachedAlertRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    recordAlertRuleSkipped('unexpected_error');
    logger.warn('Alert rule skipped: cached entry is not an object', {
      received: raw === null ? 'null' : typeof raw,
    });
    return null;
  }

  const rule = raw as CachedAlertRule & { _id: unknown };
  const normalized = { ...rule, _id: String(rule._id) };

  const parsed = cachedAlertRuleSchema.safeParse(normalized);
  if (!parsed.success) {
    const reason = skipReasonFor(parsed.error.issues);
    recordAlertRuleSkipped(reason);
    logger.warn('Alert rule skipped: cached rule failed validation', {
      ruleId: normalized._id,
      ruleName: typeof rule.name === 'string' ? rule.name : undefined,
      reason,
      issues: parsed.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`),
    });
    return null;
  }

  // The ORIGINAL object is returned, not `parsed.data`: validation here is a
  // gate, not a transform. Returning the parsed output would silently drop
  // fields the schema does not list (`audit`, `enabled`, `description`) and
  // apply the edge schemas' coercions to data that is already stored.
  return normalized;
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

  // One unusable rule costs only itself. It must not reach the evaluator, where
  // it would either never fire (bad comparison) or fail the whole bulk write
  // and take every other rule's alerts down with it (bad severity).
  return rules
    .map(normalizeRule)
    .filter((rule): rule is CachedAlertRule => rule !== null);
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

  for (const rule of rules) {
    const targets = rule.selector?.types?.length
      ? rule.selector.types
      : (READING_TYPES as unknown as ReadingType[]);

    for (const type of targets) {
      // NOT `byType.get(type)?.push(rule)`. That optional chain dropped the
      // rule for that type with no error, no metric and no log — the rule
      // stayed Enabled in the UI and simply never fired. Reaching this branch
      // means `selector.types` named a type that `READING_TYPES` has no bucket
      // for, which `alertRuleSelectorSchema` (applied in `normalizeRule`)
      // should already have rejected; if it ever happens the cause is a
      // divergence between the two, and the operator needs to hear about it.
      const bucket = byType.get(type as ReadingType);
      if (!bucket) {
        recordAlertRuleSkipped('unexpected_error');
        logger.warn('Alert rule not bucketed: unknown reading type in selector.types', {
          ruleId: rule._id,
          ruleName: rule.name,
          type: String(type),
        });
        continue;
      }
      bucket.push(rule);
    }
  }

  return { byType, ruleCount: rules.length };
}

export async function getRuleBuckets(): Promise<RuleBuckets> {
  return buildRuleBuckets(await loadActiveRules());
}
