/**
 * Error Handler Utility
 *
 * Centralized error handling that normalizes various error types into
 * consistent ApiError instances. Handles:
 * - Custom ApiError instances
 * - Mongoose/MongoDB errors
 * - Zod validation errors
 * - Standard JavaScript errors
 * - Unknown error types
 */

import { ZodError } from 'zod';
import { ApiError, type ApiErrorMetadata } from './ApiError';
import { ErrorCodes } from './errorCodes';

// ============================================================================
// TYPES
// ============================================================================

export interface ErrorHandlerOptions {
  /** Whether to log errors (defaults to true) */
  logError?: boolean;
  /** Custom logger function */
  logger?: (error: Error, context?: Record<string, unknown>) => void;
  /** Additional context to include in logs */
  context?: Record<string, unknown>;
  /** Whether to include stack trace in response (defaults to false in production) */
  includeStack?: boolean;
}

export interface NormalizedError {
  error: ApiError;
  shouldLog: boolean;
}

// ============================================================================
// MONGOOSE ERROR TYPES (checking by name to avoid import dependency)
// ============================================================================

interface MongooseValidationError extends Error {
  name: 'ValidationError';
  errors: Record<string, { message: string; path: string; value?: unknown }>;
}

interface MongooseCastError extends Error {
  name: 'CastError';
  path: string;
  value: unknown;
  kind: string;
}

interface MongoError extends Error {
  code?: number;
  keyPattern?: Record<string, number>;
  keyValue?: Record<string, unknown>;
}

// ============================================================================
// ERROR DETECTION HELPERS
// ============================================================================

function isMongooseValidationError(
  error: unknown
): error is MongooseValidationError {
  return (
    error instanceof Error &&
    error.name === 'ValidationError' &&
    'errors' in error
  );
}

function isMongooseCastError(error: unknown): error is MongooseCastError {
  return (
    error instanceof Error &&
    error.name === 'CastError' &&
    'path' in error &&
    'kind' in error
  );
}

function isMongoError(error: unknown): error is MongoError {
  return error instanceof Error && 'code' in error;
}

function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

// ============================================================================
// ERROR FORMATTERS
// ============================================================================

/**
 * Format Zod validation errors into a readable message
 */
function formatZodErrors(error: ZodError): {
  message: string;
  metadata: ApiErrorMetadata;
} {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  const firstIssue = error.issues[0];
  const field = firstIssue?.path.join('.') || undefined;

  return {
    message: issues.length === 1 ? issues[0] : `Validation failed: ${issues.join('; ')}`,
    metadata: {
      field,
      errors: error.issues.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    },
  };
}

/**
 * Format Mongoose validation errors
 */
function formatMongooseValidationErrors(
  error: MongooseValidationError
): { message: string; metadata: ApiErrorMetadata } {
  const errors = Object.entries(error.errors).map(([path, err]) => ({
    path,
    message: err.message,
    value: err.value,
  }));

  const messages = errors.map((e) => `${e.path}: ${e.message}`);

  return {
    message:
      messages.length === 1
        ? messages[0]
        : `Validation failed: ${messages.join('; ')}`,
    metadata: {
      field: errors[0]?.path,
      errors,
    },
  };
}

/**
 * Handle MongoDB duplicate key errors
 */
function handleMongoDuplicateKeyError(error: MongoError): ApiError {
  const keyPattern = error.keyPattern || {};
  const keyValue = error.keyValue || {};

  const field = Object.keys(keyPattern)[0] || 'unknown';
  const value = keyValue[field];

  // Special handling for known fields
  if (field === 'serial_number' || field === 'serialNumber') 
    return new ApiError(
      ErrorCodes.SERIAL_NUMBER_EXISTS,
      409,
      `A device with serial number '${value}' already exists`,
      { field, value: String(value) }
    );
  

  if (field === '_id' || field === 'id') 
    return new ApiError(
      ErrorCodes.DEVICE_ID_EXISTS,
      409,
      `A resource with ID '${value}' already exists`,
      { field, value: String(value) }
    );
  

  return new ApiError(
    ErrorCodes.DUPLICATE_RESOURCE,
    409,
    `Duplicate value for field '${field}'`,
    { field, value: String(value) }
  );
}

// ============================================================================
// MAIN ERROR HANDLER
// ============================================================================

/**
 * Normalizes any error type to an ApiError
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   const { error: apiError, shouldLog } = handleError(error);
 *   if (shouldLog) console.error(apiError);
 *   return apiError.toResponse();
 * }
 * ```
 */
export function handleError(
  error: unknown,
  options: ErrorHandlerOptions = {}
): NormalizedError {
  const { logError = true, logger, context } = options;

  let apiError: ApiError;
  let shouldLog;

  // Already an ApiError - just pass through
  if (ApiError.isApiError(error)) {
    apiError = error;
    // Only log server errors by default
    shouldLog = error.statusCode >= 500;
  }
  // Zod validation errors
  else if (isZodError(error)) {
    const { message, metadata } = formatZodErrors(error);
    apiError = new ApiError(ErrorCodes.VALIDATION_ERROR, 400, message, metadata);
    shouldLog = false; // Validation errors are expected
  }
  // Mongoose validation errors
  else if (isMongooseValidationError(error)) {
    const { message, metadata } = formatMongooseValidationErrors(error);
    apiError = new ApiError(ErrorCodes.VALIDATION_ERROR, 400, message, metadata);
    shouldLog = false;
  }
  // Mongoose cast errors (e.g., invalid ObjectId)
  else if (isMongooseCastError(error)) {
    apiError = new ApiError(
      ErrorCodes.INVALID_FORMAT,
      400,
      `Invalid value for '${error.path}'. Expected ${error.kind}`,
      { field: error.path, expected: error.kind, received: String(error.value) }
    );
    shouldLog = false;
  }
  // MongoDB errors (duplicate key, etc.)
  else if (isMongoError(error)) 
    // Duplicate key error
    if (error.code === 11000) {
      apiError = handleMongoDuplicateKeyError(error);
      shouldLog = false;
    }
    // Connection errors
    else if (
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ETIMEDOUT')
    ) {
      apiError = new ApiError(
        ErrorCodes.CONNECTION_ERROR,
        500,
        'Database connection error',
        { originalMessage: error.message }
      );
      shouldLog = true;
    }
    // Other MongoDB errors
    else {
      apiError = new ApiError(
        ErrorCodes.DATABASE_ERROR,
        500,
        'A database error occurred',
        { originalMessage: error.message }
      );
      shouldLog = true;
    }
  
  // Standard Error instances
  else if (error instanceof Error) {
    // Check for common error patterns
    if (error.message?.toLowerCase().includes('timeout')) 
      apiError = new ApiError(
        ErrorCodes.GATEWAY_TIMEOUT,
        504,
        'Request timed out',
        { originalMessage: error.message }
      );
     else if (error.message?.toLowerCase().includes('network')) 
      apiError = new ApiError(
        ErrorCodes.CONNECTION_ERROR,
        500,
        'Network error occurred',
        { originalMessage: error.message }
      );
     else 
      apiError = new ApiError(
        ErrorCodes.INTERNAL_ERROR,
        500,
        'An unexpected error occurred',
        { originalMessage: error.message }
      );
    
    // Preserve original stack trace
    apiError.stack = error.stack;
    shouldLog = true;
  }
  // Unknown error types
  else {
    const message =
      typeof error === 'string' ? error : 'An unexpected error occurred';
    apiError = new ApiError(ErrorCodes.INTERNAL_ERROR, 500, message);
    shouldLog = true;
  }

  // Log if requested
  if (logError && shouldLog) {
    const logFn = logger || console.error;
    logFn(apiError, {
      ...context,
      errorCode: apiError.errorCode,
      statusCode: apiError.statusCode,
      timestamp: apiError.timestamp.toISOString(),
    });
  }

  return { error: apiError, shouldLog };
}

/**
 * Convenience function that returns an ApiError directly
 */
export function normalizeError(
  error: unknown,
  options?: ErrorHandlerOptions
): ApiError {
  return handleError(error, options).error;
}

/**
 * Higher-order function that wraps an async handler with error handling
 * Useful for Next.js API route handlers
 *
 * @example
 * ```typescript
 * export const GET = withErrorHandler(async (request) => {
 *   const data = await fetchData();
 *   return Response.json({ success: true, data });
 * });
 * ```
 */
export function withErrorHandler<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      const { error: apiError } = handleError(error);
      return apiError.toResponse();
    }
  };
}

/**
 * Creates a Response from any error
 */
export function errorToResponse(
  error: unknown,
  options?: ErrorHandlerOptions
): Response {
  const { error: apiError } = handleError(error, options);
  return apiError.toResponse();
}

export default handleError;
