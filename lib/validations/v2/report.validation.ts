import { z } from 'zod';

// ============================================================================
// REPORT GENERATION SCHEMA
// ============================================================================

/**
 * Schema for report generation query parameters
 * GET /api/v2/reports/device-health
 */
export const reportGenerateQuerySchema = z
  .object({
    scope: z.enum(['all', 'building']),
    building_id: z.string().optional(),
  })
  .refine(d => d.scope === 'all' || !!d.building_id, {
    message: 'building_id is required when scope is "building"',
    path: ['building_id'],
  });

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type ReportGenerateQuery = z.infer<typeof reportGenerateQuerySchema>;
