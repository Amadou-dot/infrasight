import { z } from 'zod';
import {
  nonEmptyStringSchema,
  positiveNumberSchema,
  nonNegativeNumberSchema,
  percentageSchema,
  offsetPaginationSchema,
  sortSchema,
} from '../common.validation';

/**
 * Device status enum
 */
export const deviceStatusSchema = z.enum([
  'active',
  'maintenance',
  'offline',
  'decommissioned',
  'error',
]);

/**
 * Device configuration schema
 * Both thresholds are required
 */
export const deviceConfigurationSchema = z
  .object({
    threshold_warning: positiveNumberSchema,
    threshold_critical: positiveNumberSchema,
  })
  .refine(
    (config) => config.threshold_warning < config.threshold_critical,
    {
      message: 'threshold_warning must be less than threshold_critical',
      path: ['threshold_warning'],
    }
  );

/**
 * Device health schema
 * All fields are optional
 */
export const deviceHealthSchema = z.object({
  battery_level: percentageSchema.optional(),
  signal_strength: nonNegativeNumberSchema.optional(),
});

/**
 * Device creation schema (POST /api/v2/devices)
 * Used for creating new devices
 */
export const createDeviceSchema = z.object({
  serial_number: nonEmptyStringSchema.describe('Unique device serial number'),
  manufacturer: nonEmptyStringSchema.describe('Device manufacturer'),
  model: nonEmptyStringSchema.describe('Device model'),
  firmware_version: nonEmptyStringSchema.describe('Firmware version'),
  configuration: deviceConfigurationSchema,
  status: deviceStatusSchema.default('active'),
  health: deviceHealthSchema.optional(),
});

/**
 * Device update schema (PATCH /api/v2/devices/:id)
 * All fields are optional for partial updates
 */
export const updateDeviceSchema = z
  .object({
    serial_number: nonEmptyStringSchema.optional(),
    manufacturer: nonEmptyStringSchema.optional(),
    model: nonEmptyStringSchema.optional(),
    firmware_version: nonEmptyStringSchema.optional(),
    configuration: deviceConfigurationSchema.optional(),
    status: deviceStatusSchema.optional(),
    health: deviceHealthSchema.optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: 'At least one field must be provided for update',
    }
  );

/**
 * Device query parameters schema (GET /api/v2/devices)
 * Used for filtering and pagination
 */
export const deviceQuerySchema = z
  .object({
    serial_number: z.string().optional(),
    manufacturer: z.string().optional(),
    model: z.string().optional(),
    status: deviceStatusSchema.optional(),
    min_battery_level: z.coerce.number().min(0).max(100).optional(),
    max_battery_level: z.coerce.number().min(0).max(100).optional(),
  })
  .merge(offsetPaginationSchema)
  .merge(sortSchema)
  .refine(
    (data) => {
      if (
        data.min_battery_level !== undefined &&
        data.max_battery_level !== undefined
      ) {
        return data.min_battery_level <= data.max_battery_level;
      }
      return true;
    },
    {
      message: 'min_battery_level must be less than or equal to max_battery_level',
      path: ['min_battery_level'],
    }
  );

/**
 * Device ID parameter schema
 * For routes with :id parameter
 */
export const deviceIdSchema = z.object({
  id: nonEmptyStringSchema,
});

// Export types
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>;
export type DeviceHealth = z.infer<typeof deviceHealthSchema>;
export type CreateDevice = z.infer<typeof createDeviceSchema>;
export type UpdateDevice = z.infer<typeof updateDeviceSchema>;
export type DeviceQuery = z.infer<typeof deviceQuerySchema>;
export type DeviceId = z.infer<typeof deviceIdSchema>;
