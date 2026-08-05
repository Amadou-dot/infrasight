/**
 * AlertRuleV2 Model Unit Tests
 */

import type { Schema } from 'mongoose';
import AlertRuleV2, { READING_TYPES } from '@/models/v2/AlertRuleV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import { readingTypeSchema } from '@/lib/validations/v2/reading.validation';
import { deviceTypeSchema } from '@/lib/validations/v2/device.validation';
import { createAlertRuleInput, resetCounters } from '../../setup/factories';

/**
 * Read an `enum` off a compiled Mongoose path. Deliberately goes through the
 * live schema rather than re-importing a constant: the enum literal in
 * ReadingV2.ts / DeviceV2.ts is a SEPARATE hand-maintained copy of the reading
 * type list, and reading it back out of the schema is the only way to compare
 * against it without simply restating it here.
 */
function schemaEnum(schema: Schema, path: string): string[] {
  const options = schema.path(path)?.options as { enum?: string[] } | undefined;
  const values = options?.enum;
  if (!values) throw new Error(`No enum on schema path "${path}"`);
  return values;
}

/** The `metadata` sub-schema of the readings timeseries collection. */
function readingMetadataSchema(): Schema {
  return (ReadingV2.schema.path('metadata') as unknown as { schema: Schema }).schema;
}

const sorted = (values: readonly string[]) => [...values].sort();

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
      expect(rule.selector?.types).toEqual(['temperature']);
      expect(rule.audit.created_at).toBeInstanceOf(Date);
      expect(rule.audit.deleted_at).toBeUndefined();
    });

    it('should allow a rule with no selector types (fleet-wide)', async () => {
      const rule = await AlertRuleV2.create(
        createAlertRuleInput({ metric: 'battery_level', comparison: 'lt', threshold: 20, selector: {} })
      );

      expect(rule.selector?.types).toBeUndefined();
    });

    it('should reject an unknown metric', async () => {
      await expect(
        AlertRuleV2.create(createAlertRuleInput({ metric: 'humidity_delta' as never }))
      ).rejects.toThrow();
    });

  });

  /**
   * READING_TYPES is one of several hand-maintained copies of the reading type
   * list (see "Adding a New Device / Reading Type" in CLAUDE.md). A count
   * assertion — which is what used to live here — passes as soon as somebody
   * adds a 16th type to one copy and a 16th type to this one, even if they are
   * different types. These compare the actual SETS.
   *
   * The compile-time guard in models/v2/AlertRuleV2.ts covers the copies that
   * are TypeScript unions; `tsc` cannot see a Mongoose `enum` array or a Zod
   * `z.enum`, so those are covered here at runtime. Between the two, every copy
   * outside the UI layer is checked.
   *
   * Why it matters that this is not a count: an omitted type gets NO rule
   * bucket in lib/alerting/rule-cache.ts, `evaluateReadings` then evaluates
   * every reading of that type against zero rules, and fleet-wide rules (no
   * `selector.types` at all) stop applying to it too. Nothing throws, nothing
   * is counted, and every affected rule still reads as Enabled.
   */
  describe('READING_TYPES conformance', () => {
    it('should match the ReadingV2 timeseries metadata.type enum', () => {
      expect(sorted(READING_TYPES)).toEqual(sorted(schemaEnum(readingMetadataSchema(), 'type')));
    });

    it('should match the DeviceV2 type enum', () => {
      expect(sorted(READING_TYPES)).toEqual(sorted(schemaEnum(DeviceV2.schema, 'type')));
    });

    it('should match the reading validation Zod enum', () => {
      expect(sorted(READING_TYPES)).toEqual(sorted(readingTypeSchema.options));
    });

    it('should match the device validation Zod enum', () => {
      expect(sorted(READING_TYPES)).toEqual(sorted(deviceTypeSchema.options));
    });

    it('should have no duplicate entries', () => {
      expect(new Set(READING_TYPES).size).toBe(READING_TYPES.length);
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
