import { z } from 'zod';
import {
  deviceIdSchema,
  paginationSchema,
  dateRangeSchema,
  createSortSchema,
  userIdentifierSchema,
} from '../common.validation';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Service type enum
 */
export const serviceTypeSchema = z.enum([
  'firmware_update',
  'calibration',
  'emergency_fix',
  'general_maintenance',
]);

/**
 * Schedule status enum
 */
export const scheduleStatusSchema = z.enum(['scheduled', 'completed', 'cancelled']);

// ============================================================================
// NESTED SCHEMAS
// ============================================================================

/**
 * Schedule audit trail schema
 */
export const scheduleAuditSchema = z.object({
  created_at: z.date().default(() => new Date()),
  created_by: userIdentifierSchema,
  updated_at: z.date().default(() => new Date()),
  updated_by: userIdentifierSchema,
  completed_at: z.date().optional(),
  completed_by: userIdentifierSchema.optional(),
  cancelled_at: z.date().optional(),
  cancelled_by: userIdentifierSchema.optional(),
});

// ============================================================================
// SCHEDULE CREATION SCHEMA (POST)
// ============================================================================

/**
 * Schema for creating new schedules (POST /api/v2/schedules)
 * Supports bulk creation via device_ids array
 */
export const createScheduleSchema = z.object({
  // Array of device IDs - supports bulk scheduling
  device_ids: z
    .array(deviceIdSchema)
    .min(1, 'At least one device ID is required')
    .max(100, 'Cannot schedule more than 100 devices at once'),

  // Service type
  service_type: serviceTypeSchema,

  // Scheduled date must be in the future
  scheduled_date: z
    .string()
    .datetime({ message: 'Invalid datetime format' })
    .or(z.date())
    .transform(val => (typeof val === 'string' ? new Date(val) : val))
    .refine(date => date > new Date(), 'Scheduled date must be in the future'),

  // Optional notes
  notes: z
    .string()
    .max(1000, 'Notes must be 1000 characters or less')
    .optional(),
});

// ============================================================================
// SCHEDULE UPDATE SCHEMA (PATCH)
// ============================================================================

/**
 * Schema for updating a schedule (PATCH /api/v2/schedules/:id)
 * All fields are optional
 */
export const updateScheduleSchema = z
  .object({
    // Reschedule to a new date
    scheduled_date: z
      .string()
      .datetime({ message: 'Invalid datetime format' })
      .or(z.date())
      .transform(val => (typeof val === 'string' ? new Date(val) : val))
      .refine(date => date > new Date(), 'Scheduled date must be in the future')
      .optional(),

    // Status transition (only valid transitions from 'scheduled')
    status: z.enum(['completed', 'cancelled']).optional(),

    // Update notes
    notes: z
      .string()
      .max(1000, 'Notes must be 1000 characters or less')
      .optional(),
  })
  .refine(data => Object.keys(data).length > 0, 'At least one field must be provided for update');

// ============================================================================
// SCHEDULE QUERY SCHEMAS (GET)
// ============================================================================

/**
 * Schedule sort fields
 */
const scheduleSortFields = [
  'scheduled_date',
  'created_at',
  'updated_at',
  'status',
  'service_type',
] as const;

/**
 * Schema for schedule list query parameters (GET /api/v2/schedules)
 */
export const listSchedulesQuerySchema = z.object({
  // Pagination
  ...paginationSchema.shape,

  // Sorting
  ...createSortSchema(scheduleSortFields).shape,

  // Filter by device_id
  device_id: deviceIdSchema.optional(),

  // Filter by status
  status: z
    .union([
      scheduleStatusSchema,
      z.array(scheduleStatusSchema),
      z.string().transform(val => val.split(',') as z.infer<typeof scheduleStatusSchema>[]),
    ])
    .optional(),

  // Filter by service type
  service_type: z
    .union([
      serviceTypeSchema,
      z.array(serviceTypeSchema),
      z.string().transform(val => val.split(',') as z.infer<typeof serviceTypeSchema>[]),
    ])
    .optional(),

  // Date range for scheduled_date
  ...dateRangeSchema.shape,

  // Include completed/cancelled schedules (default: only scheduled)
  include_all: z
    .union([z.boolean(), z.string().transform(v => v === 'true')])
    .default(false),
});

/**
 * Schema for single schedule query (GET /api/v2/schedules/:id)
 */
export const getScheduleQuerySchema = z.object({
  // Include device details
  include_device: z
    .union([z.boolean(), z.string().transform(v => v === 'true')])
    .default(false),
});

// ============================================================================
// SCHEDULE ID PARAM SCHEMA
// ============================================================================

/**
 * Schema for schedule ID path parameter (MongoDB ObjectId)
 */
export const scheduleIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid schedule ID format'),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type ServiceType = z.infer<typeof serviceTypeSchema>;
export type ScheduleStatus = z.infer<typeof scheduleStatusSchema>;
export type ScheduleAudit = z.infer<typeof scheduleAuditSchema>;
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type ListSchedulesQuery = z.infer<typeof listSchedulesQuerySchema>;
export type GetScheduleQuery = z.infer<typeof getScheduleQuerySchema>;
