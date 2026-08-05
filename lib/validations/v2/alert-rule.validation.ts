import { z } from 'zod';
import { READING_TYPES } from '@/models/v2/AlertRuleV2';
import type { UpdateAlertRuleBody } from '@/types/v2/alert.types';
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

export const readingTypeSchema = z.enum(
  READING_TYPES as unknown as [(typeof READING_TYPES)[number], ...(typeof READING_TYPES)[number][]]
);
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

/**
 * The fields every metric arm shares, including their defaults. Spread into
 * each arm below so the three arms cannot drift on `cooldown_seconds`'s
 * default or `name`'s length cap.
 */
const alertRuleBaseShape = {
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or less'),
  description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
  enabled: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(true),
  comparison: alertComparisonSchema,
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
};

/**
 * `metric: 'value'` requires at least one reading type — see
 * `typesRequiredForValueMetric` for why. Expressed as a required, non-empty
 * `types` on this arm's selector rather than as a cross-field refinement, so
 * the constraint survives into `z.input<typeof createAlertRuleSchema>`.
 */
const valueMetricSelectorSchema = alertRuleSelectorSchema.extend({
  types: z.array(readingTypeSchema).min(1, TYPES_REQUIRED_MESSAGE).max(15),
});

/**
 * A DISCRIMINATED UNION, not a flat object with refinements.
 *
 * The flat version accepted `{ metric: 'value', … }` with no `selector` and
 * `{ metric: 'anomaly_score', threshold: 30 }` at the TYPE level and rejected
 * both at runtime, which is why `z.infer` of it was a trap: it described a
 * request shape the API always 400s. Discriminating on `metric` moves both
 * constraints into the type, so `z.input<typeof createAlertRuleSchema>` and the
 * hand-written `CreateAlertRuleBody` (types/v2/alert.types.ts) finally describe
 * the same request. The conformance assertions in
 * __tests__/unit/types/alerting-type-contracts.test.ts keep them that way.
 *
 * Runtime behaviour is unchanged in what it accepts and rejects. The two
 * refinement helpers above are still the single statement of each rule and are
 * still used by `updateAlertRuleSchema`; here their messages are attached to
 * the arm-level constraints that now enforce them.
 */
export const createAlertRuleSchema = z.discriminatedUnion('metric', [
  z.object({
    ...alertRuleBaseShape,
    metric: z.literal('value'),
    /** Unbounded: a value threshold is in the sensor's own unit. */
    threshold: z.number(),
    selector: valueMetricSelectorSchema,
  }),
  z.object({
    ...alertRuleBaseShape,
    metric: z.literal('anomaly_score'),
    threshold: z
      .number()
      .min(0, THRESHOLD_BOUNDS_MESSAGE)
      .max(1, THRESHOLD_BOUNDS_MESSAGE),
    selector: alertRuleSelectorSchema.default({}),
  }),
  z.object({
    ...alertRuleBaseShape,
    metric: z.literal('battery_level'),
    threshold: z
      .number()
      .min(0, THRESHOLD_BOUNDS_MESSAGE)
      .max(100, THRESHOLD_BOUNDS_MESSAGE),
    selector: alertRuleSelectorSchema.default({}),
  }),
]);

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

/**
 * The request body a client SENDS (`z.input`), not the parsed output
 * (`z.infer`/`z.output`) — the old export used `z.infer`, which describes the
 * post-parse document, with every default already applied. It typed
 * `cooldown_seconds` as required, so it was useless as a request type, and it
 * was flat, so it accepted condition shapes the API always 400s.
 *
 * Now that `createAlertRuleSchema` is a discriminated union, `z.input` of it is
 * the honest request type and is checked against the hand-written
 * `CreateAlertRuleBody` by a conformance assertion (see
 * __tests__/unit/types/alerting-type-contracts.test.ts).
 */
export type CreateAlertRuleInput = z.input<typeof createAlertRuleSchema>;

/**
 * Deliberately the hand-written union from `types/v2/alert.types.ts`, NOT
 * `z.infer<typeof updateAlertRuleSchema>`.
 *
 * The inferred type is flat and all-optional, so `{ threshold: 5 }` satisfies
 * it and the API always 400s it — precisely the trap this alias removes.
 * `updateAlertRuleSchema` cannot be rewritten as a union to fix that at the
 * source the way `createAlertRuleSchema` was: its contract is "every field
 * optional, at least one present, and the four condition fields all-or-none",
 * whose only Zod encoding is a `z.union` of a no-condition arm plus one arm per
 * metric. Zod reports a union failure as a nested `invalid_union` issue whose
 * own `message` is the literal string "Invalid input" — measured, not assumed —
 * and PATCH /api/v2/alert-rules/[id] joins `errors.map(e => e.message)` straight
 * into its 400 body, which `CreateAlertRuleModal` renders. Today a partial
 * condition update answers with one actionable sentence ("metric, comparison,
 * threshold and selector must be updated together — send all four or none");
 * under a union it would answer "Invalid input".
 *
 * So the runtime keeps the refinements and the exported TYPE is the union that
 * already encodes the same rule. A conformance assertion checks that every
 * shape this type permits is a shape the schema accepts.
 */
export type UpdateAlertRuleInput = UpdateAlertRuleBody;

export type ListAlertRulesQuery = z.infer<typeof listAlertRulesQuerySchema>;
export type AlertRuleSelectorInput = z.infer<typeof alertRuleSelectorSchema>;
