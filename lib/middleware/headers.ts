/**
 * Header Validation Middleware
 *
 * Validates required headers for API requests:
 * - Content-Type for mutation requests
 * - Custom header requirements
 */

import { ApiError } from '../errors/ApiError';
import { ErrorCodes } from '../errors/errorCodes';

export interface HeaderValidationOptions {
  /** Require Content-Type header for mutation requests (default: true) */
  requireContentType?: boolean;
  /** Allowed Content-Type values (default: ['application/json']) */
  allowedContentTypes?: string[];
  /** Additional required headers */
  requiredHeaders?: string[];
}

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH'];

/**
 * Validate request headers
 *
 * @throws ApiError if required headers are missing or invalid
 */
export function validateHeaders(request: Request, options: HeaderValidationOptions = {}): void {
  const {
    requireContentType = true,
    allowedContentTypes = ['application/json'],
    requiredHeaders = [],
  } = options;

  const method = request.method.toUpperCase();

  // Check Content-Type for mutation requests
  if (requireContentType && MUTATION_METHODS.includes(method)) {
    const contentType = request.headers.get('content-type');

    if (!contentType)
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        'Content-Type header is required for this request',
        {
          method,
          expected: allowedContentTypes.join(' or '),
        }
      );

    // Normalize content type (strip charset and other params)
    const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();

    const isAllowed = allowedContentTypes.some(
      allowed => normalizedContentType === allowed.toLowerCase()
    );

    if (!isAllowed)
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        415, // Unsupported Media Type
        `Unsupported Content-Type: ${normalizedContentType}`,
        {
          received: normalizedContentType,
          expected: allowedContentTypes.join(' or '),
        }
      );
  }

  // Check additional required headers
  for (const header of requiredHeaders) {
    const value = request.headers.get(header);
    if (!value)
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `Missing required header: ${header}`, {
        header,
      });
  }
}

/**
 * Extract common request metadata from headers
 */
export function extractRequestMetadata(request: Request): {
  userAgent: string | null;
  acceptLanguage: string | null;
  origin: string | null;
  referer: string | null;
} {
  return {
    userAgent: request.headers.get('user-agent'),
    acceptLanguage: request.headers.get('accept-language'),
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
  };
}
