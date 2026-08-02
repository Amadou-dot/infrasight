import { z } from 'zod';
import {
  deviceIdSchema,
  objectIdSchema,
  paginationSchema,
  dateRangeSchema,
  createSortSchema,
} from '../common.validation';
import { alertSeveritySchema } from './alert-rule.validation';

// ============================================================================
// ENUMS
// ============================================================================

export const alertStatusSchema = z.enum(['pending', 'firing', 'acknowledged', 'resolved']);
export const alertResolutionSchema = z.enum(['manual', 'auto', 'stale', 'device_inactive']);

// ============================================================================
// UPDATE (PATCH /api/v2/alerts/:id)
// ============================================================================

/**
 * The only transitions a human can drive. `pending` is internal and `firing` is
 * system-generated, so neither is a legal PATCH target.
 */
export const updateAlertSchema = z.object({
  status: z.enum(['acknowledged', 'resolved']),
  note: z.string().max(1000, 'Note must be 1000 characters or less').optional(),
});

// ============================================================================
// QUERY
// ============================================================================

const alertSortFields = [
  'created_at',
  'fired_at',
  'severity',
  'status',
  'last_observed_at',
] as const;

export const listAlertsQuerySchema = z
  .object({
    ...paginationSchema.shape,
    ...createSortSchema(alertSortFields).shape,
    ...dateRangeSchema.shape,
    // Accepts `firing`, `['firing','acknowledged']`, or `'firing,acknowledged'`.
    status: z
      .union([
        alertStatusSchema,
        z.array(alertStatusSchema),
        z
          .string()
          .transform(val => val.split(',').map(s => s.trim()).filter(Boolean))
          .pipe(z.array(alertStatusSchema)),
      ])
      .optional(),
    severity: z
      .union([
        alertSeveritySchema,
        z.array(alertSeveritySchema),
        z
          .string()
          .transform(val => val.split(',').map(s => s.trim()).filter(Boolean))
          .pipe(z.array(alertSeveritySchema)),
      ])
      .optional(),
    device_id: deviceIdSchema.optional(),
    rule_id: objectIdSchema.optional(),
  })
  .refine(
    data => !(data.startDate && data.endDate) || data.startDate <= data.endDate,
    { message: 'Start date must be before or equal to end date', path: ['endDate'] }
  );

export const getAlertQuerySchema = z.object({
  include_device: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(false),
});

export const alertIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid alert ID format'),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
export type GetAlertQuery = z.infer<typeof getAlertQuerySchema>;
