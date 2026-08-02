/**
 * Pure alerting predicates. No I/O, no database, no cache.
 *
 * NOTE ON THE TYPE DIMENSION: `matchesSelector` deliberately ignores
 * `selector.types`. The type dimension is handled by rule *bucketing* in
 * `rule-cache.ts`, which indexes rules by the reading type they apply to and
 * appends type-less rules to every bucket. Checking it here as well would mean
 * two places could disagree about a reading whose `metadata.type` differs from
 * its device's `type`.
 */

import type { AlertComparison, AlertMetric, IAlertRuleSelector } from '@/models/v2/AlertRuleV2';
import type { EvaluableDevice, EvaluableReading } from './types';

/**
 * Each metric is a direct field read off the reading being evaluated — no
 * derived quantities, no lookback windows. Adding a fourth is one line.
 *
 * Returns `undefined` (never 0) when the field is absent, so a reading missing
 * the metric is skipped rather than treated as a breach of a `lt` rule.
 */
export const METRIC_ACCESSORS: Record<AlertMetric, (r: EvaluableReading) => number | undefined> = {
  value: r => r.value,
  anomaly_score: r => r.quality?.anomaly_score,
  battery_level: r => r.context?.battery_level,
};

export function compare(
  value: number,
  comparison: AlertComparison,
  threshold: number
): boolean {
  switch (comparison) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    default:
      return false;
  }
}

/**
 * Does this device fall inside the rule's selector?
 *
 * A device must satisfy EVERY present dimension, and for `tags` must carry ALL
 * listed tags (not any). An absent dimension is no constraint.
 */
export function matchesSelector(
  device: EvaluableDevice,
  selector: IAlertRuleSelector | undefined
): boolean {
  if (!selector) return true;

  if (selector.building_id !== undefined && device.location?.building_id !== selector.building_id)
    return false;

  if (selector.floor !== undefined && device.location?.floor !== selector.floor) return false;

  if (selector.zone !== undefined && device.location?.zone !== selector.zone) return false;

  if (selector.tags?.length) {
    const deviceTags = new Set(device.metadata?.tags ?? []);
    if (!selector.tags.every(tag => deviceTags.has(tag))) return false;
  }

  return true;
}
