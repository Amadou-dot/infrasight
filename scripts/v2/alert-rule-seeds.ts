/**
 * Starter alert rules.
 *
 * Lives in its own module rather than in seed-v2.ts, which invokes seed() at
 * module scope — importing that from a test would wipe the test database.
 */

// ============================================================================
// ALERT RULE SEEDS
// ============================================================================

export interface AlertRuleSeed {
  name: string;
  description: string;
  enabled: boolean;
  selector: { types?: string[] };
  metric: 'value' | 'anomaly_score' | 'battery_level';
  comparison: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  for_duration_seconds: number;
  severity: 'info' | 'warning' | 'critical';
  cooldown_seconds: number;
  audit: {
    created_at: Date;
    created_by: string;
    updated_at: Date;
    updated_by: string;
  };
}

/**
 * A small rule set so alert rules exist to be evaluated. Without it the whole
 * phase is invisible to a visitor.
 *
 * Seeding rules is necessary but not sufficient for /alerts to show anything:
 * neither `pnpm seed` nor `scripts/v2/simulate.ts` triggers evaluation — both
 * insert readings via raw `ReadingV2.insertMany`, bypassing the API routes
 * where `evaluateReadings` actually runs. Alerts only appear once an
 * authenticated `GET /api/v2/cron/simulate` call runs the evaluator.
 */
export function buildAlertRuleSeeds(): AlertRuleSeed[] {
  const now = new Date();
  const audit = {
    created_at: now,
    created_by: 'sys-seed-agent',
    updated_at: now,
    updated_by: 'sys-seed-agent',
  };

  return [
    {
      name: 'High temperature',
      description: 'Temperature sustained above 30 C for five minutes.',
      enabled: true,
      selector: { types: ['temperature'] },
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      for_duration_seconds: 300,
      severity: 'critical',
      cooldown_seconds: 900,
      audit,
    },
    {
      name: 'Power spike',
      description: 'Instantaneous power draw above 4000 W.',
      enabled: true,
      selector: { types: ['power'] },
      metric: 'value',
      comparison: 'gt',
      threshold: 4000,
      for_duration_seconds: 0,
      severity: 'warning',
      cooldown_seconds: 600,
      audit,
    },
    {
      // No selector.types: battery is a DEVICE property, so a rule that only
      // watched temperature sensors' batteries would be close to useless. This
      // is the rule that motivates making selector.types optional.
      //
      // Threshold is 25, not 20, deliberately: both data generators floor
      // context.battery_level at exactly 20 (seed-v2.ts:299,
      // lib/simulation/readings.ts:262), so `lt 20` can never be satisfied.
      // 25 catches the [20, 24] band — roughly 6% of devices.
      name: 'Low battery',
      description: 'Any device reporting below 25% battery.',
      enabled: true,
      selector: {},
      metric: 'battery_level',
      comparison: 'lt',
      threshold: 25,
      for_duration_seconds: 0,
      severity: 'warning',
      cooldown_seconds: 3600,
      audit,
    },
    {
      name: 'High anomaly score',
      description: 'Any reading scored 0.85 or higher by anomaly detection.',
      enabled: true,
      selector: {},
      metric: 'anomaly_score',
      comparison: 'gte',
      threshold: 0.85,
      for_duration_seconds: 0,
      severity: 'info',
      cooldown_seconds: 300,
      audit,
    },
  ];
}
