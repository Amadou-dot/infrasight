/**
 * Application Error Codes
 *
 * Centralized error code definitions with associated HTTP status codes.
 * Used for consistent error responses across all API endpoints.
 */

// ============================================================================
// ERROR CODE TYPE
// ============================================================================

export interface ErrorCodeDefinition {
  /** The error code string */
  code: string;
  /** Default HTTP status code */
  statusCode: number;
  /** Human-readable description */
  description: string;
}

// ============================================================================
// ERROR CODES ENUM
// ============================================================================

/**
 * All application error codes as constants
 */
export const ErrorCodes = {
  // ---- Authentication & Authorization (401, 403) ----
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',

  // ---- Validation Errors (400) ----
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_QUERY_PARAM: 'INVALID_QUERY_PARAM',
  INVALID_BODY: 'INVALID_BODY',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  INVALID_PAGINATION: 'INVALID_PAGINATION',
  INVALID_SORT: 'INVALID_SORT',

  // ---- Not Found Errors (404) ----
  NOT_FOUND: 'NOT_FOUND',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  READING_NOT_FOUND: 'READING_NOT_FOUND',
  BUILDING_NOT_FOUND: 'BUILDING_NOT_FOUND',
  FLOOR_NOT_FOUND: 'FLOOR_NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',

  // ---- Conflict Errors (409) ----
  CONFLICT: 'CONFLICT',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  SERIAL_NUMBER_EXISTS: 'SERIAL_NUMBER_EXISTS',
  DEVICE_ID_EXISTS: 'DEVICE_ID_EXISTS',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',

  // ---- Business Logic Errors (422) ----
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  INVALID_READING: 'INVALID_READING',
  INVALID_DEVICE_STATUS: 'INVALID_DEVICE_STATUS',
  INVALID_DEVICE_TYPE: 'INVALID_DEVICE_TYPE',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  DEVICE_IN_MAINTENANCE: 'DEVICE_IN_MAINTENANCE',
  THRESHOLD_EXCEEDED: 'THRESHOLD_EXCEEDED',
  CALIBRATION_REQUIRED: 'CALIBRATION_REQUIRED',

  // ---- Rate Limiting (429) ----
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

  // ---- Server Errors (500, 502, 503, 504) ----
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  BAD_GATEWAY: 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  PUSHER_ERROR: 'PUSHER_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ============================================================================
// ERROR CODE REGISTRY
// ============================================================================

/**
 * Registry mapping error codes to their definitions
 */
export const ErrorCodeRegistry: Record<ErrorCode, ErrorCodeDefinition> = {
  // ---- Authentication & Authorization ----
  [ErrorCodes.UNAUTHORIZED]: {
    code: ErrorCodes.UNAUTHORIZED,
    statusCode: 401,
    description: 'Authentication is required to access this resource',
  },
  [ErrorCodes.FORBIDDEN]: {
    code: ErrorCodes.FORBIDDEN,
    statusCode: 403,
    description: 'You do not have permission to perform this action',
  },
  [ErrorCodes.INVALID_TOKEN]: {
    code: ErrorCodes.INVALID_TOKEN,
    statusCode: 401,
    description: 'The provided authentication token is invalid',
  },
  [ErrorCodes.TOKEN_EXPIRED]: {
    code: ErrorCodes.TOKEN_EXPIRED,
    statusCode: 401,
    description: 'The authentication token has expired',
  },
  [ErrorCodes.INSUFFICIENT_PERMISSIONS]: {
    code: ErrorCodes.INSUFFICIENT_PERMISSIONS,
    statusCode: 403,
    description: 'Insufficient permissions to perform this action',
  },

  // ---- Validation Errors ----
  [ErrorCodes.BAD_REQUEST]: {
    code: ErrorCodes.BAD_REQUEST,
    statusCode: 400,
    description: 'The request could not be understood or was missing required parameters',
  },
  [ErrorCodes.INVALID_INPUT]: {
    code: ErrorCodes.INVALID_INPUT,
    statusCode: 400,
    description: 'The provided input is invalid',
  },
  [ErrorCodes.VALIDATION_ERROR]: {
    code: ErrorCodes.VALIDATION_ERROR,
    statusCode: 400,
    description: 'Input validation failed',
  },
  [ErrorCodes.INVALID_QUERY_PARAM]: {
    code: ErrorCodes.INVALID_QUERY_PARAM,
    statusCode: 400,
    description: 'Invalid query parameter',
  },
  [ErrorCodes.INVALID_BODY]: {
    code: ErrorCodes.INVALID_BODY,
    statusCode: 400,
    description: 'Invalid request body',
  },
  [ErrorCodes.MISSING_REQUIRED_FIELD]: {
    code: ErrorCodes.MISSING_REQUIRED_FIELD,
    statusCode: 400,
    description: 'A required field is missing',
  },
  [ErrorCodes.INVALID_FORMAT]: {
    code: ErrorCodes.INVALID_FORMAT,
    statusCode: 400,
    description: 'The provided value has an invalid format',
  },
  [ErrorCodes.INVALID_DATE_RANGE]: {
    code: ErrorCodes.INVALID_DATE_RANGE,
    statusCode: 400,
    description: 'Invalid date range specified',
  },
  [ErrorCodes.INVALID_PAGINATION]: {
    code: ErrorCodes.INVALID_PAGINATION,
    statusCode: 400,
    description: 'Invalid pagination parameters',
  },
  [ErrorCodes.INVALID_SORT]: {
    code: ErrorCodes.INVALID_SORT,
    statusCode: 400,
    description: 'Invalid sort parameters',
  },

  // ---- Not Found Errors ----
  [ErrorCodes.NOT_FOUND]: {
    code: ErrorCodes.NOT_FOUND,
    statusCode: 404,
    description: 'The requested resource was not found',
  },
  [ErrorCodes.DEVICE_NOT_FOUND]: {
    code: ErrorCodes.DEVICE_NOT_FOUND,
    statusCode: 404,
    description: 'The specified device was not found',
  },
  [ErrorCodes.READING_NOT_FOUND]: {
    code: ErrorCodes.READING_NOT_FOUND,
    statusCode: 404,
    description: 'The specified reading was not found',
  },
  [ErrorCodes.BUILDING_NOT_FOUND]: {
    code: ErrorCodes.BUILDING_NOT_FOUND,
    statusCode: 404,
    description: 'The specified building was not found',
  },
  [ErrorCodes.FLOOR_NOT_FOUND]: {
    code: ErrorCodes.FLOOR_NOT_FOUND,
    statusCode: 404,
    description: 'The specified floor was not found',
  },
  [ErrorCodes.ROUTE_NOT_FOUND]: {
    code: ErrorCodes.ROUTE_NOT_FOUND,
    statusCode: 404,
    description: 'The requested route does not exist',
  },

  // ---- Conflict Errors ----
  [ErrorCodes.CONFLICT]: {
    code: ErrorCodes.CONFLICT,
    statusCode: 409,
    description: 'The request conflicts with the current state of the resource',
  },
  [ErrorCodes.DUPLICATE_RESOURCE]: {
    code: ErrorCodes.DUPLICATE_RESOURCE,
    statusCode: 409,
    description: 'A resource with the same identifier already exists',
  },
  [ErrorCodes.SERIAL_NUMBER_EXISTS]: {
    code: ErrorCodes.SERIAL_NUMBER_EXISTS,
    statusCode: 409,
    description: 'A device with this serial number already exists',
  },
  [ErrorCodes.DEVICE_ID_EXISTS]: {
    code: ErrorCodes.DEVICE_ID_EXISTS,
    statusCode: 409,
    description: 'A device with this ID already exists',
  },
  [ErrorCodes.CONCURRENT_MODIFICATION]: {
    code: ErrorCodes.CONCURRENT_MODIFICATION,
    statusCode: 409,
    description: 'The resource was modified by another request',
  },

  // ---- Business Logic Errors ----
  [ErrorCodes.UNPROCESSABLE_ENTITY]: {
    code: ErrorCodes.UNPROCESSABLE_ENTITY,
    statusCode: 422,
    description: 'The request was well-formed but contains semantic errors',
  },
  [ErrorCodes.INVALID_READING]: {
    code: ErrorCodes.INVALID_READING,
    statusCode: 422,
    description: 'The reading value is invalid or out of acceptable range',
  },
  [ErrorCodes.INVALID_DEVICE_STATUS]: {
    code: ErrorCodes.INVALID_DEVICE_STATUS,
    statusCode: 422,
    description: 'Invalid device status transition',
  },
  [ErrorCodes.INVALID_DEVICE_TYPE]: {
    code: ErrorCodes.INVALID_DEVICE_TYPE,
    statusCode: 422,
    description: 'Invalid device type specified',
  },
  [ErrorCodes.DEVICE_OFFLINE]: {
    code: ErrorCodes.DEVICE_OFFLINE,
    statusCode: 422,
    description: 'The device is currently offline',
  },
  [ErrorCodes.DEVICE_IN_MAINTENANCE]: {
    code: ErrorCodes.DEVICE_IN_MAINTENANCE,
    statusCode: 422,
    description: 'The device is currently in maintenance mode',
  },
  [ErrorCodes.THRESHOLD_EXCEEDED]: {
    code: ErrorCodes.THRESHOLD_EXCEEDED,
    statusCode: 422,
    description: 'A threshold value has been exceeded',
  },
  [ErrorCodes.CALIBRATION_REQUIRED]: {
    code: ErrorCodes.CALIBRATION_REQUIRED,
    statusCode: 422,
    description: 'Device calibration is required before taking readings',
  },

  // ---- Rate Limiting ----
  [ErrorCodes.RATE_LIMIT_EXCEEDED]: {
    code: ErrorCodes.RATE_LIMIT_EXCEEDED,
    statusCode: 429,
    description: 'Too many requests. Please try again later',
  },
  [ErrorCodes.TOO_MANY_REQUESTS]: {
    code: ErrorCodes.TOO_MANY_REQUESTS,
    statusCode: 429,
    description: 'Request rate limit exceeded',
  },

  // ---- Server Errors ----
  [ErrorCodes.INTERNAL_ERROR]: {
    code: ErrorCodes.INTERNAL_ERROR,
    statusCode: 500,
    description: 'An unexpected internal error occurred',
  },
  [ErrorCodes.DATABASE_ERROR]: {
    code: ErrorCodes.DATABASE_ERROR,
    statusCode: 500,
    description: 'A database error occurred',
  },
  [ErrorCodes.CONNECTION_ERROR]: {
    code: ErrorCodes.CONNECTION_ERROR,
    statusCode: 500,
    description: 'Failed to connect to an external service',
  },
  [ErrorCodes.BAD_GATEWAY]: {
    code: ErrorCodes.BAD_GATEWAY,
    statusCode: 502,
    description: 'Invalid response received from upstream server',
  },
  [ErrorCodes.SERVICE_UNAVAILABLE]: {
    code: ErrorCodes.SERVICE_UNAVAILABLE,
    statusCode: 503,
    description: 'The service is temporarily unavailable',
  },
  [ErrorCodes.GATEWAY_TIMEOUT]: {
    code: ErrorCodes.GATEWAY_TIMEOUT,
    statusCode: 504,
    description: 'The upstream server failed to respond in time',
  },
  [ErrorCodes.PUSHER_ERROR]: {
    code: ErrorCodes.PUSHER_ERROR,
    statusCode: 500,
    description: 'Failed to broadcast real-time update',
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the HTTP status code for an error code
 */
export function getStatusCodeForError(errorCode: ErrorCode): number {
  return ErrorCodeRegistry[errorCode]?.statusCode ?? 500;
}

/**
 * Get the description for an error code
 */
export function getErrorDescription(errorCode: ErrorCode): string {
  return ErrorCodeRegistry[errorCode]?.description ?? 'An error occurred';
}

/**
 * Check if an error code exists
 */
export function isValidErrorCode(code: string): code is ErrorCode {
  return code in ErrorCodeRegistry;
}

/**
 * Get all error codes for a specific HTTP status code
 */
export function getErrorCodesForStatus(statusCode: number): ErrorCode[] {
  return Object.entries(ErrorCodeRegistry)
    .filter(([, def]) => def.statusCode === statusCode)
    .map(([code]) => code as ErrorCode);
}

export default ErrorCodes;
