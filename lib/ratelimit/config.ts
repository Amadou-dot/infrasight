/**
 * Rate Limit Configuration
 *
 * Defines rate limits per endpoint type and identifier.
 * Configurable via environment variables.
 */

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  max: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Unique identifier for this limit (used in Redis keys) */
  name: string;
}

export interface EndpointLimits {
  /** Per-device rate limits (for ingestion endpoints) */
  perDevice?: RateLimitConfig;
  /** Per-IP rate limits */
  perIp: RateLimitConfig;
}

/**
 * Get environment variable as number with default
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Rate limit configurations by endpoint pattern
 */
export const RATE_LIMIT_CONFIGS: Record<string, EndpointLimits> = {
  // Readings ingestion - most critical endpoint
  // Protects against malfunctioning sensors flooding the system
  '/api/v2/readings/ingest': {
    perDevice: {
      name: 'ingest:device',
      max: getEnvNumber('RATE_LIMIT_INGEST_PER_DEVICE', 1000),
      windowSeconds: 60, // 1 minute
    },
    perIp: {
      name: 'ingest:ip',
      max: getEnvNumber('RATE_LIMIT_INGEST_PER_IP', 10000),
      windowSeconds: 60,
    },
  },

  // Default for mutation endpoints (POST, PATCH, DELETE)
  'MUTATION_DEFAULT': {
    perIp: {
      name: 'mutation:ip',
      max: getEnvNumber('RATE_LIMIT_MUTATIONS_PER_IP', 100),
      windowSeconds: 60,
    },
  },

  // Default for read endpoints (GET)
  'READ_DEFAULT': {
    perIp: {
      name: 'read:ip',
      max: 1000, // Higher limit for reads
      windowSeconds: 60,
    },
  },
};

/**
 * Endpoints that should skip rate limiting
 * (health checks, metrics, etc.)
 */
const RATE_LIMIT_EXEMPT_PATHS = [
  '/api/health',
  '/api/v2/metrics',
  '/api/v2/health',
];

/**
 * Check if rate limiting is enabled
 */
export function isRateLimitEnabled(): boolean {
  return process.env.RATE_LIMIT_ENABLED !== 'false';
}

/**
 * Check if a path is exempt from rate limiting
 */
export function isRateLimitExempt(path: string): boolean {
  return RATE_LIMIT_EXEMPT_PATHS.some(exempt => path.startsWith(exempt));
}

/**
 * Get rate limit config for a specific path and method
 */
export function getRateLimitConfig(
  path: string,
  method: string
): EndpointLimits | null {
  // Check if rate limiting is enabled
  if (!isRateLimitEnabled()) 
    return null;
  

  // Check if path is exempt
  if (isRateLimitExempt(path)) 
    return null;
  

  // Check for exact path match first
  if (RATE_LIMIT_CONFIGS[path]) 
    return RATE_LIMIT_CONFIGS[path];
  

  // Fall back to method-based defaults
  const methodUpper = method.toUpperCase();
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(methodUpper)) 
    return RATE_LIMIT_CONFIGS['MUTATION_DEFAULT'];
  

  return RATE_LIMIT_CONFIGS['READ_DEFAULT'];
}

/**
 * Custom rate limit config builder
 */
export function createRateLimitConfig(
  name: string,
  max: number,
  windowSeconds: number
): RateLimitConfig {
  return { name, max, windowSeconds };
}
