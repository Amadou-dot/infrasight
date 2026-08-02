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
