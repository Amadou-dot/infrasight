/**
 * Request Body Size Limits
 *
 * Enforces maximum body size based on endpoint type.
 * Protects against memory exhaustion from oversized payloads.
 */

import { ApiError } from '../errors/ApiError';
import { ErrorCodes } from '../errors/errorCodes';

export interface BodySizeConfig {
  /** Default max body size in bytes (1MB) */
  default: number;
  /** Max body size for bulk endpoints in bytes (10MB) */
  bulk: number;
}

export const DEFAULT_BODY_SIZE_CONFIG: BodySizeConfig = {
  default: 1 * 1024 * 1024,  // 1MB
  bulk: 10 * 1024 * 1024,    // 10MB
};

/** Endpoints that accept bulk data uploads */
const BULK_ENDPOINTS = [
  '/api/v2/readings/ingest',
];

/**
 * Get maximum allowed body size for a given path
 */
export function getMaxBodySize(
  pathname: string,
  config: BodySizeConfig = DEFAULT_BODY_SIZE_CONFIG
): number {
  const isBulkEndpoint = BULK_ENDPOINTS.some(ep => pathname.startsWith(ep));
  return isBulkEndpoint ? config.bulk : config.default;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) 
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  
  if (bytes >= 1024) 
    return `${(bytes / 1024).toFixed(1)}KB`;
  
  return `${bytes}B`;
}

/**
 * Validate request body size against configured limits
 *
 * @throws ApiError with 413 status if body exceeds limit
 */
export async function validateBodySize(
  request: Request,
  pathname: string,
  config: BodySizeConfig = DEFAULT_BODY_SIZE_CONFIG
): Promise<void> {
  const contentLength = request.headers.get('content-length');

  if (!contentLength) 
    // Allow requests without content-length for streaming
    // Body size will be checked during parsing if needed
    return;
  

  const size = parseInt(contentLength, 10);

  if (isNaN(size)) 
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      'Invalid Content-Length header',
      { received: contentLength }
    );
  

  const maxSize = getMaxBodySize(pathname, config);

  if (size > maxSize) 
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      413, // Payload Too Large
      `Request body too large. Maximum size is ${formatBytes(maxSize)}`,
      {
        received: formatBytes(size),
        maximum: formatBytes(maxSize),
        receivedBytes: size,
        maximumBytes: maxSize,
      }
    );
  
}
