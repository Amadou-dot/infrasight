### Task 19: Seed alert rules

**Without seeded rules the entire phase is invisible to a visitor**, which would defeat its purpose. `/alerts` must be populated on first load.

**Files:**
- Create: `scripts/v2/alert-rule-seeds.ts`
- Modify: `scripts/v2/seed-v2.ts`
- Test: `__tests__/unit/lib/seed-alert-rules.test.ts`

**The seeds live in their own module, not in `seed-v2.ts`.** `scripts/v2/seed-v2.ts` calls `seed()` at module scope (`seed-v2.ts:313`), so importing it from a test would run the seeder against the test database and wipe it. A separate side-effect-free module is importable from both the seed script and the test.

**The four rules**, chosen so the demo exercises every branch of the design:

| Rule | Metric | Condition | Duration | Why it is in the set |
| --- | --- | --- | --- | --- |
| High temperature | `value` | `> 30` on `temperature` | 300s | Exercises the `pending → firing` promotion |
| Power spike | `value` | `> 4000` on `power` | 0s | Fires immediately; the common case |
| Low battery | `battery_level` | `< 20`, **no `selector.types`** | 0s | The rule that motivates optional `selector.types` — battery is a device property, and a rule that only watched temperature sensors' batteries would be close to useless |
| High anomaly score | `anomaly_score` | `>= 0.85`, no `selector.types` | 0s | The single coupling point between alerting and the existing anomaly endpoint |

**Interfaces:**
- Consumes: `AlertRuleV2` (Task 1).
- Produces, from `scripts/v2/alert-rule-seeds.ts`: `export interface AlertRuleSeed`, `export function buildAlertRuleSeeds(): AlertRuleSeed[]`. No side effects on import.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/seed-alert-rules.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/seed-alert-rules.test.ts`
Expected: FAIL — `buildAlertRuleSeeds` is not exported.

- [ ] **Step 3: Add the seeds**

Create `scripts/v2/alert-rule-seeds.ts` — **no imports with side effects, no `mongoose.connect`, nothing that runs on import**:

```typescript
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
 * A small rule set so /alerts is populated on first load. Without it the whole
 * phase is invisible to a visitor.
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
      name: 'Low battery',
      description: 'Any device reporting below 20% battery.',
      enabled: true,
      selector: {},
      metric: 'battery_level',
      comparison: 'lt',
      threshold: 20,
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
```

Then in `scripts/v2/seed-v2.ts`, import both:

```typescript
import AlertRuleV2 from '../../models/v2/AlertRuleV2';
import { buildAlertRuleSeeds } from './alert-rule-seeds';
```

Inside `seed()`, extend the clear step and add an insert step:

```typescript
    await DeviceV2.deleteMany({});
    await ReadingV2.deleteMany({});
    await AlertRuleV2.deleteMany({});
```

```typescript
    // Seed alert rules so /alerts is populated on first load.
    console.log('🔔 Seeding alert rules...');
    const alertRules = buildAlertRuleSeeds();
    await AlertRuleV2.insertMany(alertRules);
    console.log(`✅ Inserted ${alertRules.length} alert rules\n`);
```

Add `Alert rules: ${alertRules.length}` to the seed summary block.

**Do not delete `alerts_v2` in the seed.** The seed wipes devices and readings; alerts referencing wiped devices are swept to `device_inactive` on the next cron run, which is the correct behaviour and also demonstrates the sweep.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/seed-alert-rules.test.ts`
Expected: PASS, 6 tests. If `jest` cannot resolve `@/scripts/v2/alert-rule-seeds`, check that `scripts/` is not excluded in `tsconfig.json` — `jest.config.js` maps `^@/(.*)$` to `<rootDir>/$1`, so resolution is a tsconfig concern, not a jest one.

Also confirm the new module has no import side effects: `npx tsx -e "import('./scripts/v2/alert-rule-seeds.ts').then(m => console.log(m.buildAlertRuleSeeds().length))"` must print `4` without connecting to MongoDB.

- [ ] **Step 5: Run the seed end to end against a local database**

Run: `pnpm seed` (requires a local `MONGODB_URI` in `.env.local`; the script refuses a non-local target without `--force`)
Expected: 500 devices, readings, and 4 alert rules. Then run `pnpm create-indexes-v2 && pnpm verify-indexes` and confirm the eight new alert indexes are reported present.

- [ ] **Step 6: Commit**

```bash
git add scripts/v2/alert-rule-seeds.ts scripts/v2/seed-v2.ts __tests__/unit/lib/seed-alert-rules.test.ts
git commit -m "feat(alerting): seed a starter alert rule set"
```

---

