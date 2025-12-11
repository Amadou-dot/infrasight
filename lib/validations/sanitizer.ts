/**
 * Input Sanitization Utilities
 *
 * Functions to sanitize user input and prevent:
 * - NoSQL injection attacks
 * - XSS (Cross-Site Scripting)
 * - Special character attacks
 * - Prototype pollution
 */

import { ApiError } from '../errors/ApiError';
import { ErrorCodes } from '../errors/errorCodes';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * MongoDB operators that could be used for injection
 */
const MONGO_OPERATORS = [
  '$where',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$ne',
  '$in',
  '$nin',
  '$or',
  '$and',
  '$not',
  '$nor',
  '$exists',
  '$type',
  '$mod',
  '$regex',
  '$text',
  '$search',
  '$elemMatch',
  '$size',
  '$all',
  '$expr',
  '$jsonSchema',
  '$comment',
] as const;

/**
 * Dangerous prototype properties
 */
const DANGEROUS_KEYS = [
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
] as const;

/**
 * Characters to escape in regex patterns
 */
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

/**
 * Potentially dangerous HTML characters
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

// ============================================================================
// STRING SANITIZATION
// ============================================================================

/**
 * Sanitizes a string by trimming whitespace and optionally escaping HTML
 *
 * @example
 * ```typescript
 * sanitizeString('  hello world  '); // 'hello world'
 * sanitizeString('<script>alert("xss")</script>', { escapeHtml: true });
 * // '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 * ```
 */
export function sanitizeString(
  str: string,
  options: {
    /** Escape HTML special characters */
    escapeHtml?: boolean;
    /** Maximum length to truncate to */
    maxLength?: number;
    /** Convert to lowercase */
    lowercase?: boolean;
    /** Allow empty string */
    allowEmpty?: boolean;
  } = {}
): string {
  const {
    escapeHtml = false,
    maxLength,
    lowercase = false,
    allowEmpty = true,
  } = options;

  // Handle non-string input
  if (typeof str !== 'string') {
    str = String(str ?? '');
  }

  // Trim whitespace
  let sanitized = str.trim();

  // Check for empty string
  if (!allowEmpty && sanitized.length === 0) {
    throw new ApiError(
      ErrorCodes.INVALID_INPUT,
      400,
      'Input cannot be empty'
    );
  }

  // Remove null bytes and other control characters
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Truncate if maxLength specified
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Escape HTML if requested
  if (escapeHtml) {
    sanitized = sanitized.replace(
      /[&<>"'`=/]/g,
      (char) => HTML_ESCAPE_MAP[char] || char
    );
  }

  // Convert to lowercase if requested
  if (lowercase) {
    sanitized = sanitized.toLowerCase();
  }

  return sanitized;
}

/**
 * Escapes special characters for use in MongoDB $regex
 *
 * @example
 * ```typescript
 * sanitizeForRegex('hello (world)'); // 'hello \\(world\\)'
 * ```
 */
export function sanitizeForRegex(str: string): string {
  if (typeof str !== 'string') {
    str = String(str ?? '');
  }

  return str.trim().replace(REGEX_SPECIAL_CHARS, '\\$&');
}

/**
 * Sanitizes a search query for safe use in MongoDB
 */
export function sanitizeSearchQuery(query: string): string {
  if (typeof query !== 'string') {
    return '';
  }

  // Trim and remove excessive whitespace
  let sanitized = query.trim().replace(/\s+/g, ' ');

  // Remove MongoDB operators
  for (const op of MONGO_OPERATORS) {
    const regex = new RegExp(`\\${op}`, 'gi');
    sanitized = sanitized.replace(regex, '');
  }

  // Escape regex special characters
  sanitized = sanitizeForRegex(sanitized);

  return sanitized;
}

// ============================================================================
// OBJECT SANITIZATION
// ============================================================================

/**
 * Checks if a key is a MongoDB operator
 */
export function isMongoOperator(key: string): boolean {
  return key.startsWith('$') || MONGO_OPERATORS.includes(key as typeof MONGO_OPERATORS[number]);
}

/**
 * Checks if a key is a dangerous prototype property
 */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.includes(key as typeof DANGEROUS_KEYS[number]);
}

/**
 * Recursively sanitizes an object, removing dangerous keys and MongoDB operators
 *
 * @example
 * ```typescript
 * sanitizeInput({ name: 'test', $where: '1==1' });
 * // { name: 'test' }
 *
 * sanitizeInput({ name: '  hello  ', age: 25 });
 * // { name: 'hello', age: 25 }
 * ```
 */
export function sanitizeInput<T extends Record<string, unknown>>(
  obj: T,
  options: {
    /** Remove MongoDB operators from keys */
    removeMongoOperators?: boolean;
    /** Sanitize string values */
    sanitizeStrings?: boolean;
    /** Maximum depth for recursion */
    maxDepth?: number;
    /** Fields to skip sanitization */
    skipFields?: string[];
  } = {}
): T {
  const {
    removeMongoOperators = true,
    sanitizeStrings = true,
    maxDepth = 10,
    skipFields = [],
  } = options;

  function sanitizeRecursive(value: unknown, depth: number): unknown {
    // Prevent infinite recursion
    if (depth > maxDepth) {
      return value;
    }

    // Handle null/undefined
    if (value === null || value === undefined) {
      return value;
    }

    // Handle strings
    if (typeof value === 'string') {
      return sanitizeStrings ? sanitizeString(value) : value;
    }

    // Handle numbers (check for Infinity and NaN)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return 0;
      }
      return value;
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      return value;
    }

    // Handle dates
    if (value instanceof Date) {
      return value;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeRecursive(item, depth + 1));
    }

    // Handle objects
    if (typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};

      for (const [key, val] of Object.entries(value)) {
        // Skip dangerous keys
        if (isDangerousKey(key)) {
          continue;
        }

        // Skip MongoDB operators if configured
        if (removeMongoOperators && isMongoOperator(key)) {
          continue;
        }

        // Skip specified fields
        if (skipFields.includes(key)) {
          sanitized[key] = val;
          continue;
        }

        sanitized[key] = sanitizeRecursive(val, depth + 1);
      }

      return sanitized;
    }

    // Return other types as-is
    return value;
  }

  return sanitizeRecursive(obj, 0) as T;
}

// ============================================================================
// MONGODB OBJECTID VALIDATION
// ============================================================================

/**
 * MongoDB ObjectId regex pattern (24 hex characters)
 */
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Validates a MongoDB ObjectId format
 *
 * @example
 * ```typescript
 * validateObjectId('507f1f77bcf86cd799439011'); // true
 * validateObjectId('invalid'); // false
 * ```
 */
export function validateObjectId(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  return OBJECT_ID_REGEX.test(id);
}

/**
 * Validates ObjectId and throws if invalid
 */
export function assertObjectId(
  id: string,
  fieldName = 'id'
): asserts id is string {
  if (!validateObjectId(id)) {
    throw new ApiError(
      ErrorCodes.INVALID_FORMAT,
      400,
      `Invalid ObjectId format for '${fieldName}'`,
      { field: fieldName, value: id }
    );
  }
}

// ============================================================================
// CUSTOM ID VALIDATION (device_001 format)
// ============================================================================

/**
 * Custom device ID regex pattern
 */
const DEVICE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates custom device ID format
 *
 * @example
 * ```typescript
 * validateDeviceId('device_001'); // true
 * validateDeviceId('invalid id!'); // false
 * ```
 */
export function validateDeviceId(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  return DEVICE_ID_REGEX.test(id) && id.length >= 1 && id.length <= 100;
}

/**
 * Validates device ID and throws if invalid
 */
export function assertDeviceId(
  id: string,
  fieldName = 'device_id'
): asserts id is string {
  if (!validateDeviceId(id)) {
    throw new ApiError(
      ErrorCodes.INVALID_FORMAT,
      400,
      `Invalid device ID format for '${fieldName}'. Must be 1-100 alphanumeric characters, underscores, or hyphens`,
      { field: fieldName, value: id }
    );
  }
}

// ============================================================================
// NUMBER VALIDATION
// ============================================================================

/**
 * Sanitizes and validates a number
 *
 * @example
 * ```typescript
 * sanitizeNumber('123'); // 123
 * sanitizeNumber('12.5'); // 12.5
 * sanitizeNumber('abc'); // undefined
 * sanitizeNumber('Infinity'); // undefined
 * ```
 */
export function sanitizeNumber(
  value: unknown,
  options: {
    /** Minimum allowed value */
    min?: number;
    /** Maximum allowed value */
    max?: number;
    /** Whether to parse integers only */
    integer?: boolean;
    /** Default value if parsing fails */
    default?: number;
  } = {}
): number | undefined {
  const { min, max, integer = false, default: defaultValue } = options;

  let num: number;

  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    num = integer ? parseInt(value, 10) : parseFloat(value);
  } else {
    return defaultValue;
  }

  // Check for NaN and Infinity
  if (!Number.isFinite(num)) {
    return defaultValue;
  }

  // Apply min/max constraints
  if (min !== undefined && num < min) {
    return defaultValue;
  }
  if (max !== undefined && num > max) {
    return defaultValue;
  }

  return num;
}

/**
 * Sanitizes a number and throws if invalid
 */
export function assertNumber(
  value: unknown,
  fieldName: string,
  options: {
    min?: number;
    max?: number;
    integer?: boolean;
  } = {}
): number {
  const result = sanitizeNumber(value, options);

  if (result === undefined) {
    throw new ApiError(
      ErrorCodes.INVALID_INPUT,
      400,
      `Invalid number for '${fieldName}'`,
      { field: fieldName, value: String(value) }
    );
  }

  return result;
}

// ============================================================================
// DATE VALIDATION
// ============================================================================

/**
 * Sanitizes and validates a date
 *
 * @example
 * ```typescript
 * sanitizeDate('2024-01-15'); // Date object
 * sanitizeDate('invalid'); // undefined
 * ```
 */
export function sanitizeDate(
  value: unknown,
  options: {
    /** Minimum allowed date */
    minDate?: Date;
    /** Maximum allowed date */
    maxDate?: Date;
    /** Default value if parsing fails */
    default?: Date;
  } = {}
): Date | undefined {
  const { minDate, maxDate, default: defaultValue } = options;

  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else {
    return defaultValue;
  }

  // Check for invalid date
  if (isNaN(date.getTime())) {
    return defaultValue;
  }

  // Apply min/max constraints
  if (minDate && date < minDate) {
    return defaultValue;
  }
  if (maxDate && date > maxDate) {
    return defaultValue;
  }

  return date;
}

/**
 * Sanitizes a date and throws if invalid
 */
export function assertDate(
  value: unknown,
  fieldName: string,
  options: {
    minDate?: Date;
    maxDate?: Date;
    notInFuture?: boolean;
  } = {}
): Date {
  const { notInFuture = false, ...restOptions } = options;

  const effectiveOptions = {
    ...restOptions,
    ...(notInFuture ? { maxDate: new Date() } : {}),
  };

  const result = sanitizeDate(value, effectiveOptions);

  if (result === undefined) {
    throw new ApiError(
      ErrorCodes.INVALID_INPUT,
      400,
      `Invalid date for '${fieldName}'`,
      { field: fieldName, value: String(value) }
    );
  }

  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

const sanitizerUtils = {
  sanitizeString,
  sanitizeForRegex,
  sanitizeSearchQuery,
  sanitizeInput,
  sanitizeNumber,
  sanitizeDate,
  validateObjectId,
  validateDeviceId,
  assertObjectId,
  assertDeviceId,
  assertNumber,
  assertDate,
  isMongoOperator,
  isDangerousKey,
};

export default sanitizerUtils;
