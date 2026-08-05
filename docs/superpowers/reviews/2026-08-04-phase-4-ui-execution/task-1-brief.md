### Task 1: AlertRuleV2 model

**Files:**
- Create: `models/v2/AlertRuleV2.ts`
- Modify: `__tests__/setup/factories.ts` (append an alert-rule factory)
- Modify: `scripts/v2/create-indexes-v2.ts` (add `ALERT_RULE_V2_INDEXES`)
- Test: `__tests__/unit/models/AlertRuleV2.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type AlertMetric = 'value' | 'anomaly_score' | 'battery_level'`
  - `export type AlertComparison = 'gt' | 'gte' | 'lt' | 'lte'`
  - `export type AlertSeverity = 'info' | 'warning' | 'critical'`
  - `export const READING_TYPES: readonly ReadingType[]` (all 15, exported for reuse by the validation schema and the rule bucketer)
  - `export interface IAlertRuleSelector { types?: ReadingType[]; building_id?: string; floor?: number; zone?: string; tags?: string[] }`
  - `export interface IAlertRuleV2 { _id: Types.ObjectId; name: string; description?: string; enabled: boolean; selector: IAlertRuleSelector; metric: AlertMetric; comparison: AlertComparison; threshold: number; for_duration_seconds: number; severity: AlertSeverity; cooldown_seconds: number; audit: IAlertRuleAudit }`
  - `AlertRuleV2.findActive(filter?): Query`, `AlertRuleV2.softDelete(id: string, deletedBy: string): Promise<Doc | null>`
  - `createAlertRuleInput(overrides?): AlertRuleInput` from `__tests__/setup/factories`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/models/AlertRuleV2.test.ts`:

```typescript
/**
 * AlertRuleV2 Model Unit Tests
 */

import AlertRuleV2, { READING_TYPES } from '@/models/v2/AlertRuleV2';
import { createAlertRuleInput, resetCounters } from '../../setup/factories';

describe('AlertRuleV2 Model', () => {
  beforeEach(() => {
    resetCounters();
  });

  describe('document creation', () => {
    it('should create a rule with defaults applied', async () => {
      const rule = await AlertRuleV2.create(
        createAlertRuleInput({
          name: 'High temperature',
          metric: 'value',
          comparison: 'gt',
          threshold: 30,
          severity: 'critical',
          selector: { types: ['temperature'] },
        })
      );

      expect(rule.enabled).toBe(true);
      expect(rule.for_duration_seconds).toBe(0);
      expect(rule.cooldown_seconds).toBe(300);
      expect(rule.selector.types).toEqual(['temperature']);
      expect(rule.audit.created_at).toBeInstanceOf(Date);
      expect(rule.audit.deleted_at).toBeUndefined();
    });

    it('should allow a rule with no selector types (fleet-wide)', async () => {
      const rule = await AlertRuleV2.create(
        createAlertRuleInput({ metric: 'battery_level', comparison: 'lt', threshold: 20, selector: {} })
      );

      expect(rule.selector.types).toBeUndefined();
    });

    it('should reject an unknown metric', async () => {
      await expect(
        AlertRuleV2.create(createAlertRuleInput({ metric: 'humidity_delta' as never }))
      ).rejects.toThrow();
    });

    it('should expose all 15 reading types', () => {
      expect(READING_TYPES).toHaveLength(15);
      expect(READING_TYPES).toContain('temperature');
      expect(READING_TYPES).toContain('energy');
    });
  });

  describe('findActive', () => {
    it('should exclude soft-deleted rules', async () => {
      const kept = await AlertRuleV2.create(createAlertRuleInput({ name: 'Kept' }));
      const gone = await AlertRuleV2.create(createAlertRuleInput({ name: 'Gone' }));
      await AlertRuleV2.softDelete(String(gone._id), 'admin@example.com');

      const active = await AlertRuleV2.findActive().lean();

      expect(active).toHaveLength(1);
      expect(String(active[0]._id)).toBe(String(kept._id));
    });

    it('should accept an additional filter', async () => {
      await AlertRuleV2.create(createAlertRuleInput({ name: 'On', enabled: true }));
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Off', enabled: false }));

      const active = await AlertRuleV2.findActive({ enabled: true }).lean();

      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('On');
    });
  });

  describe('softDelete', () => {
    it('should stamp deleted_at and deleted_by', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const deleted = await AlertRuleV2.softDelete(String(rule._id), 'admin@example.com');

      expect(deleted?.audit.deleted_at).toBeInstanceOf(Date);
      expect(deleted?.audit.deleted_by).toBe('admin@example.com');
    });

    it('should return null for an unknown id', async () => {
      const missing = await AlertRuleV2.softDelete('507f1f77bcf86cd799439011', 'admin@example.com');
      expect(missing).toBeNull();
    });
  });

  describe('middleware', () => {
    it('should bump audit.updated_at on findOneAndUpdate', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());
      const before = rule.audit.updated_at;

      await new Promise(r => setTimeout(r, 5));
      const updated = await AlertRuleV2.findByIdAndUpdate(
        rule._id,
        { $set: { threshold: 99 } },
        { new: true }
      );

      expect(updated!.audit.updated_at.getTime()).toBeGreaterThan(before.getTime());
    });
  });
});
```

Append to `__tests__/setup/factories.ts`:

```typescript
// ============================================================================
// ALERT RULE FACTORIES
// ============================================================================

export interface AlertRuleInput {
  name: string;
  description?: string;
  enabled?: boolean;
  selector: Record<string, unknown>;
  metric: 'value' | 'anomaly_score' | 'battery_level';
  comparison: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  for_duration_seconds?: number;
  severity: 'info' | 'warning' | 'critical';
  cooldown_seconds?: number;
  audit?: Record<string, unknown>;
}

let alertRuleCounter = 0;

export function createAlertRuleInput(overrides: Partial<AlertRuleInput> = {}): AlertRuleInput {
  alertRuleCounter += 1;
  return {
    name: `Test Rule ${alertRuleCounter}`,
    enabled: true,
    selector: { types: ['temperature'] },
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    severity: 'warning',
    audit: {
      created_at: new Date(),
      created_by: 'test@example.com',
      updated_at: new Date(),
      updated_by: 'test@example.com',
    },
    ...overrides,
  };
}
```

Also add `alertRuleCounter = 0;` to the body of the existing `resetCounters()` function in that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/models/AlertRuleV2.test.ts`
Expected: FAIL — `Cannot find module '@/models/v2/AlertRuleV2'`

- [ ] **Step 3: Write the model**

Create `models/v2/AlertRuleV2.ts`:

```typescript
// `Types` is used only in type position here (Types.ObjectId as a field type),
// so it must be a type-only import or @typescript-eslint/consistent-type-imports
// fails. Task 7 does use `new Types.ObjectId()` and needs the value import.
import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type { ReadingType } from './ReadingV2';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * All 15 reading types. Exported so the validation schema and the rule
 * bucketer share one source of truth with the schema enum below.
 */
export const READING_TYPES = [
  'temperature',
  'humidity',
  'occupancy',
  'power',
  'co2',
  'pressure',
  'light',
  'motion',
  'air_quality',
  'water_flow',
  'gas',
  'vibration',
  'voltage',
  'current',
  'energy',
] as const satisfies readonly ReadingType[];

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

export type AlertMetric = 'value' | 'anomaly_score' | 'battery_level';
export type AlertComparison = 'gt' | 'gte' | 'lt' | 'lte';
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Declarative device selector. Every field is optional; an absent field means
 * "no constraint on this dimension". Devices must satisfy ALL present fields,
 * and for `tags` must carry ALL listed tags.
 */
export interface IAlertRuleSelector {
  types?: ReadingType[];
  building_id?: string;
  floor?: number;
  zone?: string;
  tags?: string[];
}

export interface IAlertRuleAudit {
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at?: Date;
  deleted_by?: string;
}

export interface IAlertRuleV2 {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  enabled: boolean;
  selector: IAlertRuleSelector;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;
  /** Breach must hold this long before the alert fires. 0 = fire immediately. */
  for_duration_seconds: number;
  severity: AlertSeverity;
  /** A new episode for the same (rule, device) pair is suppressed this long after resolution. */
  cooldown_seconds: number;
  audit: IAlertRuleAudit;
}

// ============================================================================
// MONGOOSE SCHEMA
// ============================================================================

const SelectorSchema = new Schema<IAlertRuleSelector>(
  {
    // `default: undefined` overrides Mongoose's implicit `[]` default for array
    // paths, so an omitted field stays truly absent (no constraint) rather than
    // becoming a vacuous empty array. Without it a fleet-wide rule round-trips
    // as `types: []` instead of `types: undefined`.
    types: { type: [String], enum: READING_TYPES as unknown as string[], default: undefined },
    building_id: { type: String },
    floor: { type: Number },
    zone: { type: String },
    tags: { type: [String], default: undefined },
  },
  { _id: false }
);

const AuditSchema = new Schema<IAlertRuleAudit>(
  {
    created_at: { type: Date, default: () => new Date() },
    created_by: { type: String, required: true },
    updated_at: { type: Date, default: () => new Date() },
    updated_by: { type: String, required: true },
    deleted_at: { type: Date },
    deleted_by: { type: String },
  },
  { _id: false }
);

const AlertRuleV2Schema = new Schema<IAlertRuleV2>(
  {
    name: { type: String, required: true, maxlength: 200 },
    description: { type: String, maxlength: 1000 },
    enabled: { type: Boolean, default: true },
    selector: { type: SelectorSchema, default: () => ({}) },
    metric: {
      type: String,
      enum: ['value', 'anomaly_score', 'battery_level'],
      required: true,
    },
    comparison: {
      type: String,
      enum: ['gt', 'gte', 'lt', 'lte'],
      required: true,
    },
    threshold: { type: Number, required: true },
    for_duration_seconds: { type: Number, default: 0, min: 0, max: 86400 },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      required: true,
    },
    cooldown_seconds: { type: Number, default: 300, min: 0, max: 86400 },
    audit: { type: AuditSchema, required: true },
  },
  {
    collection: 'alert_rules_v2',
    timestamps: false,
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// The actual load predicate used by the evaluator's rule cache.
AlertRuleV2Schema.index({ enabled: 1, 'audit.deleted_at': 1 });

// Default list sort.
AlertRuleV2Schema.index({ 'audit.created_at': -1 });

// ============================================================================
// MIDDLEWARE
// ============================================================================

AlertRuleV2Schema.pre('save', function () {
  if (!this.isNew) this.audit.updated_at = new Date();
});

AlertRuleV2Schema.pre('findOneAndUpdate', function () {
  this.set({ 'audit.updated_at': new Date() });
});

// ============================================================================
// STATIC METHODS
// ============================================================================

AlertRuleV2Schema.statics.findActive = function (filter: Record<string, unknown> = {}) {
  return this.find({ ...filter, 'audit.deleted_at': { $exists: false } });
};

AlertRuleV2Schema.statics.softDelete = async function (id: string, deletedBy: string) {
  return this.findOneAndUpdate(
    { _id: id, 'audit.deleted_at': { $exists: false } },
    {
      $set: {
        'audit.deleted_at': new Date(),
        'audit.deleted_by': deletedBy,
        enabled: false,
      },
    },
    { new: true }
  );
};

// ============================================================================
// INTERFACE FOR STATIC METHODS
// ============================================================================

export interface IAlertRuleV2Model extends Model<IAlertRuleV2> {
  findActive(filter?: Record<string, unknown>): ReturnType<Model<IAlertRuleV2>['find']>;
  softDelete(id: string, deletedBy: string): Promise<(IAlertRuleV2 & Document) | null>;
}

// ============================================================================
// MODEL EXPORT
// ============================================================================

const AlertRuleV2 =
  (mongoose.models.AlertRuleV2 as unknown as IAlertRuleV2Model) ||
  mongoose.model<IAlertRuleV2, IAlertRuleV2Model>('AlertRuleV2', AlertRuleV2Schema);

export default AlertRuleV2;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/models/AlertRuleV2.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the index definitions to the index scripts**

In `scripts/v2/create-indexes-v2.ts`, add this block next to the existing `DEVICE_V2_INDEXES` and `READING_V2_INDEXES` arrays (there is no schedule index array in this file — follow those two):

```typescript
/**
 * AlertRuleV2 Index Definitions
 *
 * These indexes optimize:
 * - The evaluator's rule-cache load predicate (enabled + not soft-deleted)
 * - The default list sort
 */
const ALERT_RULE_V2_INDEXES: IndexDefinition[] = [
  {
    name: 'enabled_deleted_at',
    spec: { enabled: 1, 'audit.deleted_at': 1 } as IndexSpec,
    options: { background: true },
    description: 'Rule cache load predicate: { enabled: true, audit.deleted_at: { $exists: false } }',
  },
  {
    name: 'audit_created_at_desc',
    spec: { 'audit.created_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Default sort for GET /api/v2/alert-rules',
  },
];
```

Then register it inside `createIndexes()` alongside the existing collections, following the exact call shape already used there for `devices_v2` (collection name `alert_rules_v2`). Mirror the same addition in `scripts/v2/verify-indexes.ts` so `pnpm verify-indexes` checks for them.

- [ ] **Step 6: Verify the scripts still typecheck**

Run: `./.superpowers/sdd/2026-08-01-alerting-subsystem/lintcheck && ./.superpowers/sdd/2026-08-01-alerting-subsystem/tscheck`
Expected: lint clean; tscheck OK (no NEW type errors — the repo carries 39 pre-existing ones).

- [ ] **Step 7: Commit**

```bash
git add models/v2/AlertRuleV2.ts __tests__/unit/models/AlertRuleV2.test.ts __tests__/setup/factories.ts scripts/v2/create-indexes-v2.ts scripts/v2/verify-indexes.ts
git commit -m "feat(alerting): add AlertRuleV2 model with declarative selector"
```

---

