/**
 * Error Handling Module
 *
 * Centralized exports for error handling utilities.
 *
 * @example
 * ```typescript
 * import { ApiError, ErrorCodes, handleError } from '@/lib/errors';
 *
 * // Throw a typed error
 * throw ApiError.notFound('Device', 'device_001');
 *
 * // Handle unknown errors
 * const { error } = handleError(caughtError);
 * return error.toResponse();
 * ```
 */

// Custom error class
export { ApiError, type ApiErrorMetadata, type ApiErrorJSON } from './ApiError';

// Error codes and registry
export {
  ErrorCodes,
  ErrorCodeRegistry,
  type ErrorCode,
  type ErrorCodeDefinition,
  getStatusCodeForError,
  getErrorDescription,
  isValidErrorCode,
  getErrorCodesForStatus,
} from './errorCodes';

// Error handler utilities
export {
  handleError,
  normalizeError,
  withErrorHandler,
  errorToResponse,
  type ErrorHandlerOptions,
  type NormalizedError,
} from './errorHandler';
