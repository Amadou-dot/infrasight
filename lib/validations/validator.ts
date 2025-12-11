/**
 * Validation Utilities
 *
 * Wrapper functions for Zod schema validation with consistent
 * error handling and formatting. Integrates with the ApiError
 * system for standardized error responses.
 */

import { z, type ZodError, type ZodSchema } from 'zod';
import { ApiError, type ApiErrorMetadata } from '../errors/ApiError';
import { ErrorCodes } from '../errors/errorCodes';
import { sanitizeInput } from './sanitizer';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Validation result with discriminated union
 */
export type ValidationResult<T> =
  | { success: true; data: T; errors?: undefined }
  | { success: false; data?: undefined; errors: ValidationError[] };

/**
 * Structured validation error
 */
export interface ValidationError {
  /** Field path (e.g., 'user.email') */
  path: string;
  /** Error message */
  message: string;
  /** Zod error code */
  code: string;
  /** Expected type/value */
  expected?: string;
  /** Received value (sanitized) */
  received?: string;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  /** Sanitize input before validation */
  sanitize?: boolean;
  /** Abort on first error (default: false - collect all errors) */
  abortEarly?: boolean;
  /** Strip unknown keys from objects */
  stripUnknown?: boolean;
  /** Context for error messages */
  context?: string;
}

// ============================================================================
// ERROR FORMATTING
// ============================================================================

/**
 * Converts Zod errors to structured ValidationError array
 */
export function formatZodErrors(error: ZodError): ValidationError[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');

    const validationError: ValidationError = {
      path: path || 'root',
      message: issue.message,
      code: issue.code,
    };

    // Add expected/received for specific error types
    if (issue.code === 'invalid_type') {
      validationError.expected = issue.expected;
      validationError.received = typeof issue.input === 'string' 
        ? issue.input 
        : String(issue.input);
    } else if (issue.code === 'invalid_value') {
      if ('values' in issue) {
        validationError.expected = (issue.values as string[])?.join(', ');
      }
      if ('input' in issue) {
        validationError.received = String(issue.input);
      }
    } else if (issue.code === 'too_small' || issue.code === 'too_big') {
      validationError.expected =
        issue.code === 'too_small'
          ? `at least ${issue.minimum}`
          : `at most ${issue.maximum}`;
    }

    return validationError;
  });
}

/**
 * Creates a human-readable error message from validation errors
 */
export function formatErrorMessage(
  errors: ValidationError[],
  context?: string
): string {
  if (errors.length === 0) {
    return 'Validation failed';
  }

  if (errors.length === 1) {
    const error = errors[0];
    const prefix = context ? `${context}: ` : '';
    return error.path && error.path !== 'root'
      ? `${prefix}${error.path}: ${error.message}`
      : `${prefix}${error.message}`;
  }

  const prefix = context ? `${context} ` : '';
  const messages = errors
    .slice(0, 3)
    .map((e) => (e.path && e.path !== 'root' ? `${e.path}: ${e.message}` : e.message));

  const remaining = errors.length - 3;
  const suffix = remaining > 0 ? ` (and ${remaining} more)` : '';

  return `${prefix}Validation failed: ${messages.join('; ')}${suffix}`;
}

/**
 * Creates ApiError metadata from validation errors
 */
function createErrorMetadata(errors: ValidationError[]): ApiErrorMetadata {
  const firstError = errors[0];

  return {
    field: firstError?.path !== 'root' ? firstError?.path : undefined,
    errors: errors.map((e) => ({
      path: e.path,
      message: e.message,
      code: e.code,
      ...(e.expected ? { expected: e.expected } : {}),
      ...(e.received ? { received: e.received } : {}),
    })),
  };
}

// ============================================================================
// CORE VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates data against a Zod schema
 *
 * @example
 * ```typescript
 * const schema = z.object({ name: z.string(), age: z.number() });
 *
 * const result = validateInput({ name: 'John', age: 30 }, schema);
 * if (result.success) {
 *   console.log(result.data); // { name: 'John', age: 30 }
 * } else {
 *   console.log(result.errors); // ValidationError[]
 * }
 * ```
 */
export function validateInput<T>(
  data: unknown,
  schema: ZodSchema<T>,
  options: ValidationOptions = {}
): ValidationResult<T> {
  const { sanitize = true, stripUnknown = false } = options;

  try {
    // Sanitize input if requested
    let processedData = data;
    if (sanitize && typeof data === 'object' && data !== null) {
      processedData = sanitizeInput(data as Record<string, unknown>, {
        removeMongoOperators: true,
        sanitizeStrings: true,
      });
    }

    // Apply strip unknown if requested
    let effectiveSchema = schema;
    if (stripUnknown && schema instanceof z.ZodObject) {
      effectiveSchema = schema.strip() as unknown as ZodSchema<T>;
    }

    // Parse with Zod
    const result = effectiveSchema.safeParse(processedData);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      errors: formatZodErrors(result.error),
    };
  } catch (error) {
    // Handle unexpected errors
    return {
      success: false,
      errors: [
        {
          path: 'root',
          message: error instanceof Error ? error.message : 'Validation failed',
          code: 'custom',
        },
      ],
    };
  }
}

/**
 * Validates data and throws ApiError on failure
 *
 * @example
 * ```typescript
 * const data = validateOrThrow(input, schema);
 * // Use data directly - throws if invalid
 * ```
 */
export function validateOrThrow<T>(
  data: unknown,
  schema: ZodSchema<T>,
  options: ValidationOptions = {}
): T {
  const result = validateInput(data, schema, options);

  if (!result.success) {
    throw new ApiError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      formatErrorMessage(result.errors, options.context),
      createErrorMetadata(result.errors)
    );
  }

  return result.data;
}

/**
 * Validates query parameters from URLSearchParams
 *
 * @example
 * ```typescript
 * const querySchema = z.object({
 *   page: z.coerce.number().optional(),
 *   limit: z.coerce.number().optional(),
 *   status: z.string().optional(),
 * });
 *
 * const params = validateQuery(request.url, querySchema);
 * ```
 */
export function validateQuery<T>(
  urlOrSearchParams: string | URL | URLSearchParams,
  schema: ZodSchema<T>,
  options: ValidationOptions = {}
): ValidationResult<T> {
  // Extract URLSearchParams
  let searchParams: URLSearchParams;
  if (urlOrSearchParams instanceof URLSearchParams) {
    searchParams = urlOrSearchParams;
  } else if (urlOrSearchParams instanceof URL) {
    searchParams = urlOrSearchParams.searchParams;
  } else {
    try {
      searchParams = new URL(urlOrSearchParams).searchParams;
    } catch {
      searchParams = new URLSearchParams(urlOrSearchParams);
    }
  }

  // Convert to object
  const queryObject: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = queryObject[key];
    if (existing !== undefined) {
      // Handle multiple values for same key
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        queryObject[key] = [existing, value];
      }
    } else {
      queryObject[key] = value;
    }
  }

  return validateInput(queryObject, schema, {
    ...options,
    context: options.context ?? 'Query parameter',
  });
}

/**
 * Validates query parameters and throws ApiError on failure
 */
export function validateQueryOrThrow<T>(
  urlOrSearchParams: string | URL | URLSearchParams,
  schema: ZodSchema<T>,
  options: ValidationOptions = {}
): T {
  const result = validateQuery(urlOrSearchParams, schema, options);

  if (!result.success) {
    throw new ApiError(
      ErrorCodes.INVALID_QUERY_PARAM,
      400,
      formatErrorMessage(result.errors, 'Query parameter'),
      createErrorMetadata(result.errors)
    );
  }

  return result.data;
}

/**
 * Validates request body (JSON)
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const body = await validateBody(request, createDeviceSchema);
 *   // body is fully typed
 * }
 * ```
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>,
  options: ValidationOptions = {}
): Promise<ValidationResult<T>> {
  try {
    const body = await request.json();
    return validateInput(body, schema, {
      ...options,
      context: options.context ?? 'Request body',
    });
  } catch (error) {
    // JSON parsing error
    if (error instanceof SyntaxError) {
      return {
        success: false,
        errors: [
          {
            path: 'root',
            message: 'Invalid JSON in request body',
            code: 'invalid_json',
          },
        ],
      };
    }

    return {
      success: false,
      errors: [
        {
          path: 'root',
          message: error instanceof Error ? error.message : 'Failed to parse request body',
          code: 'parse_error',
        },
      ],
    };
  }
}

/**
 * Validates request body and throws ApiError on failure
 */
export async function validateBodyOrThrow<T>(
  request: Request,
  schema: ZodSchema<T>,
  options: ValidationOptions = {}
): Promise<T> {
  const result = await validateBody(request, schema, options);

  if (!result.success) {
    const firstError = result.errors[0];
    const errorCode =
      firstError?.code === 'invalid_json'
        ? ErrorCodes.INVALID_BODY
        : ErrorCodes.VALIDATION_ERROR;

    throw new ApiError(
      errorCode,
      400,
      formatErrorMessage(result.errors, 'Request body'),
      createErrorMetadata(result.errors)
    );
  }

  return result.data;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Validates a single value against a schema
 */
export function validateValue<T>(
  value: unknown,
  schema: ZodSchema<T>,
  fieldName?: string
): ValidationResult<T> {
  const result = schema.safeParse(value);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Override path with fieldName if provided
  const errors = formatZodErrors(result.error).map((error) => ({
    ...error,
    path: fieldName ?? error.path,
  }));

  return { success: false, errors };
}

/**
 * Creates a validation schema with common transformations
 */
export function createSchema<T>(
  schema: ZodSchema<T>,
  options: {
    /** Make all fields optional */
    partial?: boolean;
    /** Strip unknown keys */
    strip?: boolean;
    /** Make fields required */
    required?: boolean;
  } = {}
): ZodSchema<T> {
  let modified: ZodSchema<T> = schema;

  if (options.partial && schema instanceof z.ZodObject) {
    modified = schema.partial() as unknown as ZodSchema<T>;
  }

  if (options.strip && schema instanceof z.ZodObject) {
    modified = schema.strip() as unknown as ZodSchema<T>;
  }

  if (options.required && schema instanceof z.ZodObject) {
    modified = schema.required() as unknown as ZodSchema<T>;
  }

  return modified;
}

/**
 * Combines multiple schemas with merge
 */
export function mergeSchemas<T extends z.ZodRawShape, U extends z.ZodRawShape>(
  base: z.ZodObject<T>,
  extension: z.ZodObject<U>
) {
  return base.merge(extension);
}

// ============================================================================
// EXPORTS
// ============================================================================

const validatorUtils = {
  validateInput,
  validateOrThrow,
  validateQuery,
  validateQueryOrThrow,
  validateBody,
  validateBodyOrThrow,
  validateValue,
  formatZodErrors,
  formatErrorMessage,
  createSchema,
  mergeSchemas,
};

export default validatorUtils;
