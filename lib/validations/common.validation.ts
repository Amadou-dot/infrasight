import { z } from 'zod';

/**
 * Common validation schemas used across the API
 */

// Pagination schemas
export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe('Number of items to return (1-100)'),
});

export const offsetPaginationSchema = z.object({
  offset: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Number of items to skip'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe('Number of items to return (1-100)'),
});

// Date range schema
export const dateRangeSchema = z
  .object({
    start_date: z.coerce
      .date()
      .optional()
      .describe('Start date for filtering (ISO 8601)'),
    end_date: z.coerce
      .date()
      .optional()
      .describe('End date for filtering (ISO 8601)'),
  })
  .refine(
    (data) => {
      if (data.start_date && data.end_date) {
        return data.start_date <= data.end_date;
      }
      return true;
    },
    {
      message: 'start_date must be before or equal to end_date',
      path: ['start_date'],
    }
  );

// Sort order schema
export const sortOrderSchema = z.enum(['asc', 'desc', 'ASC', 'DESC']).default('asc');

export const sortSchema = z.object({
  sort_by: z.string().optional().describe('Field to sort by'),
  sort_order: sortOrderSchema.optional(),
});

// Common field validations
export const nonEmptyStringSchema = z
  .string()
  .trim()
  .min(1, 'Field cannot be empty');

export const positiveNumberSchema = z
  .number()
  .positive('Value must be positive');

export const nonNegativeNumberSchema = z
  .number()
  .nonnegative('Value must be non-negative');

export const percentageSchema = z
  .number()
  .min(0, 'Percentage must be between 0 and 100')
  .max(100, 'Percentage must be between 0 and 100');

export const timestampSchema = z.coerce
  .date()
  .refine(
    (date) => date <= new Date(),
    {
      message: 'Timestamp cannot be in the future',
    }
  );

// Export types for use in other files
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;
export type OffsetPagination = z.infer<typeof offsetPaginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type SortOrder = z.infer<typeof sortOrderSchema>;
export type Sort = z.infer<typeof sortSchema>;
