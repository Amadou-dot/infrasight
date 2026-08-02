import { z } from 'zod';
import { READING_TYPES } from '@/models/v2/AlertRuleV2';
import {
  buildingIdSchema,
  floorSchema,
  zoneSchema,
  paginationSchema,
  createSortSchema,
} from '../common.validation';

// ============================================================================
// ENUMS
// ============================================================================

export const readingTypeSchema = z.enum(READING_TYPES as unknown as [string, ...string[]]);
export const alertMetricSchema = z.enum(['value', 'anomaly_score', 'battery_level']);
export const alertComparisonSchema = z.enum(['gt', 'gte', 'lt', 'lte']);
export const alertSeveritySchema = z.enum(['info', 'warning', 'critical']);

// ============================================================================
// SELECTOR
// ============================================================================

/**
 * Every dimension is optional; an absent dimension means "no constraint".
 * A device must satisfy ALL present dimensions, and carry ALL listed tags.
 */
export const alertRuleSelectorSchema = z
  .object({
    types: z.array(readingTypeSchema).max(15).optional(),
    building_id: buildingIdSchema.optional(),
    floor: floorSchema.optional(),
    zone: zoneSchema,
    tags: z
      .array(
        z
          .string()
          .min(1, 'Tag cannot be empty')
          .max(50, 'Tag must be 50 characters or less')
          .regex(/^[a-zA-Z0-9_-]+$/, 'Tags can only contain alphanumeric characters, underscores, and hyphens')
      )
      .max(20, 'Cannot have more than 20 tags')
      .optional(),
  })
  .strict();

// ============================================================================
// CROSS-FIELD REFINEMENTS
// ============================================================================

interface ConditionShape {
  metric: 'value' | 'anomaly_score' | 'battery_level';
  threshold: number;
  selector: z.infer<typeof alertRuleSelectorSchema>;
}

/**
 * A bare value threshold across mixed units is meaningless — 30 is a reasonable
 * temperature ceiling and an absurd power one. anomaly_score and battery_level
 * are unit-free and meaningful fleet-wide, so they may omit `types`.
 */
function typesRequiredForValueMetric(data: ConditionShape): boolean {
  if (data.metric !== 'value') return true;
  return (data.selector?.types?.length ?? 0) > 0;
}

/** Reject a rule that can never fire, at the edge rather than at evaluation. */
function thresholdWithinMetricBounds(data: ConditionShape): boolean {
  if (data.metric === 'anomaly_score') return data.threshold >= 0 && data.threshold <= 1;
  if (data.metric === 'battery_level') return data.threshold >= 0 && data.threshold <= 100;
  return true;
}

const TYPES_REQUIRED_MESSAGE = "selector.types must list at least one reading type when metric is 'value'";
const THRESHOLD_BOUNDS_MESSAGE =
  'threshold is outside the valid range for this metric (anomaly_score: 0-1, battery_level: 0-100)';

// ============================================================================
// CREATE
// ============================================================================

export const createAlertRuleSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or less'),
    description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
    enabled: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(true),
    selector: alertRuleSelectorSchema.default({}),
    metric: alertMetricSchema,
    comparison: alertComparisonSchema,
    threshold: z.number(),
    for_duration_seconds: z
      .number()
      .int('for_duration_seconds must be an integer')
      .min(0)
      .max(86400, 'for_duration_seconds cannot exceed 24 hours')
      .default(0),
    severity: alertSeveritySchema,
    cooldown_seconds: z
      .number()
      .int('cooldown_seconds must be an integer')
      .min(0)
      .max(86400, 'cooldown_seconds cannot exceed 24 hours')
      .default(300),
  })
  .refine(thresholdWithinMetricBounds, {
    message: THRESHOLD_BOUNDS_MESSAGE,
    path: ['threshold'],
  })
  .refine(typesRequiredForValueMetric, {
    message: TYPES_REQUIRED_MESSAGE,
    path: ['selector', 'types'],
  });

// ============================================================================
// UPDATE
// ============================================================================

/**
 * `metric`, `comparison`, `threshold` and `selector` form an atomic group: if any
 * is present, all must be. Otherwise the cross-field refinements above are
 * undecidable — you cannot bound a threshold without knowing its metric.
 */
const CONDITION_FIELDS = ['metric', 'comparison', 'threshold', 'selector'] as const;

export const updateAlertRuleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    enabled: z.union([z.boolean(), z.string().transform(v => v === 'true')]).optional(),
    selector: alertRuleSelectorSchema.optional(),
    metric: alertMetricSchema.optional(),
    comparison: alertComparisonSchema.optional(),
    threshold: z.number().optional(),
    for_duration_seconds: z.number().int().min(0).max(86400).optional(),
    severity: alertSeveritySchema.optional(),
    cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  })
  .refine(
    data => Object.values(data).some(v => v !== undefined),
    'At least one field must be provided for update'
  )
  .refine(
    data => {
      const present = CONDITION_FIELDS.filter(f => data[f] !== undefined);
      return present.length === 0 || present.length === CONDITION_FIELDS.length;
    },
    {
      message:
        'metric, comparison, threshold and selector must be updated together — send all four or none',
      path: ['metric'],
    }
  )
  .refine(
    data =>
      data.metric === undefined ||
      thresholdWithinMetricBounds(data as unknown as ConditionShape),
    { message: THRESHOLD_BOUNDS_MESSAGE, path: ['threshold'] }
  )
  .refine(
    data =>
      data.metric === undefined ||
      typesRequiredForValueMetric(data as unknown as ConditionShape),
    { message: TYPES_REQUIRED_MESSAGE, path: ['selector', 'types'] }
  );

// ============================================================================
// QUERY
// ============================================================================

const alertRuleSortFields = ['name', 'created_at', 'updated_at', 'severity'] as const;

export const listAlertRulesQuerySchema = z.object({
  ...paginationSchema.shape,
  ...createSortSchema(alertRuleSortFields).shape,
  enabled: z.union([z.boolean(), z.string().transform(v => v === 'true')]).optional(),
  metric: alertMetricSchema.optional(),
  severity: alertSeveritySchema.optional(),
});

export const alertRuleIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid alert rule ID format'),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
export type ListAlertRulesQuery = z.infer<typeof listAlertRulesQuerySchema>;
export type AlertRuleSelectorInput = z.infer<typeof alertRuleSelectorSchema>;
