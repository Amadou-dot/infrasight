/**
 * Alert Rule Validation Schema Tests
 */

import {
  createAlertRuleSchema,
  updateAlertRuleSchema,
  listAlertRulesQuerySchema,
} from '@/lib/validations/v2/alert-rule.validation';

function validRule(overrides: Record<string, unknown> = {}) {
  return {
    name: 'High temperature',
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    severity: 'critical',
    selector: { types: ['temperature'] },
    ...overrides,
  };
}

describe('createAlertRuleSchema', () => {
  it('should accept a minimal valid rule and apply defaults', () => {
    const result = createAlertRuleSchema.safeParse(validRule());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.for_duration_seconds).toBe(0);
      expect(result.data.cooldown_seconds).toBe(300);
    }
  });

  it("should require selector.types when metric is 'value'", () => {
    const result = createAlertRuleSchema.safeParse(validRule({ selector: {} }));

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.some(i => i.path.join('.') === 'selector.types')).toBe(true);
  });

  it("should reject an empty selector.types array when metric is 'value'", () => {
    const result = createAlertRuleSchema.safeParse(validRule({ selector: { types: [] } }));
    expect(result.success).toBe(false);
  });

  it('should allow anomaly_score rules with no selector.types', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ metric: 'anomaly_score', threshold: 0.8, selector: {} })
    );
    expect(result.success).toBe(true);
  });

  it('should allow battery_level rules with no selector.types', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ metric: 'battery_level', comparison: 'lt', threshold: 20, selector: {} })
    );
    expect(result.success).toBe(true);
  });

  it('should bound anomaly_score thresholds to 0-1', () => {
    const tooHigh = createAlertRuleSchema.safeParse(
      validRule({ metric: 'anomaly_score', threshold: 30, selector: {} })
    );
    const negative = createAlertRuleSchema.safeParse(
      validRule({ metric: 'anomaly_score', threshold: -0.1, selector: {} })
    );

    expect(tooHigh.success).toBe(false);
    expect(negative.success).toBe(false);
  });

  it('should bound battery_level thresholds to 0-100', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ metric: 'battery_level', comparison: 'lt', threshold: 101, selector: {} })
    );
    expect(result.success).toBe(false);
  });

  it('should leave value thresholds unconstrained', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ threshold: -273.15, selector: { types: ['temperature'] } })
    );
    expect(result.success).toBe(true);
  });

  it('should reject an unknown reading type in the selector', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ selector: { types: ['plasma'] } })
    );
    expect(result.success).toBe(false);
  });

  it('should cap for_duration_seconds and cooldown_seconds at 86400', () => {
    expect(createAlertRuleSchema.safeParse(validRule({ for_duration_seconds: 86401 })).success).toBe(false);
    expect(createAlertRuleSchema.safeParse(validRule({ cooldown_seconds: 86401 })).success).toBe(false);
  });

  it('should accept the full selector shape', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({
        selector: {
          types: ['temperature', 'humidity'],
          building_id: 'HQ',
          floor: 3,
          zone: 'north',
          tags: ['critical', 'hvac'],
        },
      })
    );
    expect(result.success).toBe(true);
  });

  /**
   * `createAlertRuleSchema` is a discriminated union on `metric`, not a flat
   * object with cross-field refinements — see the comment on the schema for
   * why. These pin the behaviour that must NOT have changed with that rewrite:
   * the same bodies are accepted, the same bodies are rejected, and every arm
   * still applies the same defaults.
   */
  describe('metric arms', () => {
    it("should reject a 'value' rule with no selector key at all", () => {
      const { selector: _selector, ...noSelector } = validRule();
      expect(createAlertRuleSchema.safeParse(noSelector).success).toBe(false);
    });

    it('should reject an unknown metric', () => {
      expect(createAlertRuleSchema.safeParse(validRule({ metric: 'humidity_delta' })).success).toBe(
        false
      );
    });

    it('should reject a missing metric', () => {
      const { metric: _metric, ...noMetric } = validRule();
      expect(createAlertRuleSchema.safeParse(noMetric).success).toBe(false);
    });

    it.each([
      ['value', { metric: 'value', threshold: 30, selector: { types: ['temperature'] } }],
      ['anomaly_score', { metric: 'anomaly_score', threshold: 0.8, selector: {} }],
      ['battery_level', { metric: 'battery_level', comparison: 'lt', threshold: 20, selector: {} }],
    ])('should apply the same defaults on the %s arm', (_name, overrides) => {
      const result = createAlertRuleSchema.safeParse(validRule(overrides));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(true);
        expect(result.data.for_duration_seconds).toBe(0);
        expect(result.data.cooldown_seconds).toBe(300);
      }
    });

    it('should default selector to {} when a unit-free metric omits it', () => {
      const { selector: _selector, ...noSelector } = validRule({
        metric: 'anomaly_score',
        threshold: 0.8,
      });
      const result = createAlertRuleSchema.safeParse(noSelector);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.selector).toEqual({});
    });

    it('should still coerce the enabled flag from a string', () => {
      const result = createAlertRuleSchema.safeParse(validRule({ enabled: 'false' }));

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.enabled).toBe(false);
    });
  });
});

describe('updateAlertRuleSchema', () => {
  it('should accept a partial update of non-condition fields', () => {
    const result = updateAlertRuleSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
  });

  it('should reject an empty update', () => {
    const result = updateAlertRuleSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject a partial condition update', () => {
    const result = updateAlertRuleSchema.safeParse({ threshold: 40 });
    expect(result.success).toBe(false);
  });

  it('should accept a complete condition update', () => {
    const result = updateAlertRuleSchema.safeParse({
      metric: 'value',
      comparison: 'gte',
      threshold: 40,
      selector: { types: ['temperature'] },
    });
    expect(result.success).toBe(true);
  });

  it('should apply the metric threshold bounds to a complete condition update', () => {
    const result = updateAlertRuleSchema.safeParse({
      metric: 'anomaly_score',
      comparison: 'gt',
      threshold: 5,
      selector: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('listAlertRulesQuerySchema', () => {
  it('should coerce string pagination params', () => {
    const result = listAlertRulesQuerySchema.safeParse({ page: '2', limit: '50' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(50);
    }
  });

  it('should coerce the enabled flag from a string', () => {
    const result = listAlertRulesQuerySchema.safeParse({ enabled: 'false' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(false);
  });

  it('should reject an unknown sort field', () => {
    const result = listAlertRulesQuerySchema.safeParse({ sortBy: 'nonsense' });
    expect(result.success).toBe(false);
  });
});
