/**
 * V2 Validation Schemas
 *
 * Comprehensive Zod validation schemas for V2 API operations.
 * These schemas are used for:
 * - Request body validation (POST, PATCH)
 * - Query parameter validation (GET)
 * - Type inference for TypeScript
 */

// Common validations (shared utilities)
export * from '../common.validation';

// Device validations
export * from './device.validation';

// Reading validations
export * from './reading.validation';
// Validation utilities
export * from '../validator';

// Sanitization utilities
export * from '../sanitizer';
