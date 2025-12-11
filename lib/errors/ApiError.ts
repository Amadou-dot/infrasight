/**
 * Custom API Error Class
 *
 * Provides a standardized way to throw and handle API errors with:
 * - HTTP status codes
 * - Application-specific error codes
 * - Optional metadata for debugging
 * - JSON serialization for API responses
 */

export interface ApiErrorMetadata {
  /** Resource identifier that caused the error */
  id?: string;
  /** Field that caused a validation error */
  field?: string;
  /** Expected value or format */
  expected?: string;
  /** Actual value received */
  received?: string;
  /** Additional context-specific data */
  [key: string]: unknown;
}

export interface ApiErrorJSON {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    metadata?: ApiErrorMetadata;
  };
  timestamp: string;
}

/**
 * Custom API Error class for consistent error handling across the application.
 *
 * @example
 * ```typescript
 * // Basic usage
 * throw new ApiError('DEVICE_NOT_FOUND', 404, 'Device not found');
 *
 * // With metadata
 * throw new ApiError('DEVICE_NOT_FOUND', 404, 'Device not found', { id: 'device_001' });
 *
 * // Using static factory methods
 * throw ApiError.notFound('Device', 'device_001');
 * throw ApiError.badRequest('Invalid device ID format');
 * throw ApiError.conflict('Serial number already exists', { serialNumber: 'ABC123' });
 * ```
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly metadata?: ApiErrorMetadata;
  public readonly timestamp: Date;
  public isOperational: boolean;

  constructor(
    errorCode: string,
    statusCode: number,
    message: string,
    metadata?: ApiErrorMetadata
  ) {
    super(message);

    this.name = 'ApiError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.metadata = metadata;
    this.timestamp = new Date();
    this.isOperational = true; // Operational errors are expected; programming errors are not

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }

    // Set prototype explicitly for proper instanceof checks
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /**
   * Converts the error to a JSON response format
   */
  toJSON(): ApiErrorJSON {
    return {
      success: false,
      error: {
        code: this.errorCode,
        message: this.message,
        statusCode: this.statusCode,
        ...(this.metadata && Object.keys(this.metadata).length > 0
          ? { metadata: this.metadata }
          : {}),
      },
      timestamp: this.timestamp.toISOString(),
    };
  }

  /**
   * Creates a Response object for Next.js API routes
   */
  toResponse(): Response {
    return Response.json(this.toJSON(), { status: this.statusCode });
  }

  // ============================================================================
  // STATIC FACTORY METHODS - Common error types
  // ============================================================================

  /**
   * 400 Bad Request - Invalid input or request
   */
  static badRequest(message: string, metadata?: ApiErrorMetadata): ApiError {
    return new ApiError('BAD_REQUEST', 400, message, metadata);
  }

  /**
   * 400 Validation Error - Input validation failed
   */
  static validationError(
    message: string,
    metadata?: ApiErrorMetadata
  ): ApiError {
    return new ApiError('VALIDATION_ERROR', 400, message, metadata);
  }

  /**
   * 400 Invalid Input - General invalid input
   */
  static invalidInput(message: string, metadata?: ApiErrorMetadata): ApiError {
    return new ApiError('INVALID_INPUT', 400, message, metadata);
  }

  /**
   * 401 Unauthorized - Authentication required
   */
  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError('UNAUTHORIZED', 401, message);
  }

  /**
   * 403 Forbidden - Insufficient permissions
   */
  static forbidden(
    message = 'You do not have permission to perform this action'
  ): ApiError {
    return new ApiError('FORBIDDEN', 403, message);
  }

  /**
   * 404 Not Found - Resource not found
   */
  static notFound(
    resourceType: string,
    identifier?: string | Record<string, unknown>
  ): ApiError {
    const id =
      typeof identifier === 'string'
        ? identifier
        : identifier
          ? JSON.stringify(identifier)
          : undefined;

    const message = id
      ? `${resourceType} with identifier '${id}' not found`
      : `${resourceType} not found`;

    return new ApiError('NOT_FOUND', 404, message, {
      resourceType,
      ...(id ? { id } : {}),
    });
  }

  /**
   * 404 Device Not Found - Specific helper for device lookups
   */
  static deviceNotFound(deviceId: string): ApiError {
    return new ApiError('DEVICE_NOT_FOUND', 404, `Device '${deviceId}' not found`, {
      id: deviceId,
    });
  }

  /**
   * 404 Reading Not Found - Specific helper for reading lookups
   */
  static readingNotFound(readingId: string): ApiError {
    return new ApiError('READING_NOT_FOUND', 404, `Reading '${readingId}' not found`, {
      id: readingId,
    });
  }

  /**
   * 409 Conflict - Resource already exists or state conflict
   */
  static conflict(message: string, metadata?: ApiErrorMetadata): ApiError {
    return new ApiError('CONFLICT', 409, message, metadata);
  }

  /**
   * 409 Duplicate - Resource with same unique identifier exists
   */
  static duplicate(
    resourceType: string,
    field: string,
    value: string
  ): ApiError {
    return new ApiError(
      'DUPLICATE_RESOURCE',
      409,
      `${resourceType} with ${field} '${value}' already exists`,
      { field, value }
    );
  }

  /**
   * 422 Unprocessable Entity - Valid syntax but semantically incorrect
   */
  static unprocessableEntity(
    message: string,
    metadata?: ApiErrorMetadata
  ): ApiError {
    return new ApiError('UNPROCESSABLE_ENTITY', 422, message, metadata);
  }

  /**
   * 429 Rate Limit Exceeded
   */
  static rateLimitExceeded(
    retryAfterSeconds?: number,
    metadata?: ApiErrorMetadata
  ): ApiError {
    const message = retryAfterSeconds
      ? `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds`
      : 'Rate limit exceeded';

    return new ApiError('RATE_LIMIT_EXCEEDED', 429, message, {
      ...(retryAfterSeconds ? { retryAfter: retryAfterSeconds } : {}),
      ...metadata,
    });
  }

  /**
   * 500 Internal Server Error - Unexpected server error
   */
  static internalError(
    message = 'An unexpected error occurred',
    metadata?: ApiErrorMetadata
  ): ApiError {
    const error = new ApiError('INTERNAL_ERROR', 500, message, metadata);
    error.isOperational = false; // Internal errors are not operational
    return error;
  }

  /**
   * 502 Bad Gateway - External service error
   */
  static badGateway(
    serviceName: string,
    metadata?: ApiErrorMetadata
  ): ApiError {
    return new ApiError(
      'BAD_GATEWAY',
      502,
      `Error communicating with ${serviceName}`,
      { service: serviceName, ...metadata }
    );
  }

  /**
   * 503 Service Unavailable - Service temporarily unavailable
   */
  static serviceUnavailable(
    message = 'Service temporarily unavailable',
    metadata?: ApiErrorMetadata
  ): ApiError {
    return new ApiError('SERVICE_UNAVAILABLE', 503, message, metadata);
  }

  /**
   * 504 Gateway Timeout - External service timeout
   */
  static gatewayTimeout(
    serviceName: string,
    metadata?: ApiErrorMetadata
  ): ApiError {
    return new ApiError(
      'GATEWAY_TIMEOUT',
      504,
      `Request to ${serviceName} timed out`,
      { service: serviceName, ...metadata }
    );
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Checks if an error is an ApiError instance
   */
  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }

  /**
   * Creates an ApiError from an unknown error
   */
  static from(error: unknown): ApiError {
    if (ApiError.isApiError(error)) {
      return error;
    }

    if (error instanceof Error) {
      const apiError = new ApiError(
        'INTERNAL_ERROR',
        500,
        error.message || 'An unexpected error occurred'
      );
      apiError.stack = error.stack;
      return apiError;
    }

    return new ApiError(
      'INTERNAL_ERROR',
      500,
      typeof error === 'string' ? error : 'An unexpected error occurred'
    );
  }
}

export default ApiError;
