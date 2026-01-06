/**
 * Cache Key Generators
 *
 * Centralized cache key management for consistency.
 * All cache keys should be generated through these functions.
 */

export const CACHE_PREFIXES = {
  DEVICE: 'device',
  DEVICES_LIST: 'devices:list',
  METADATA: 'metadata',
  HEALTH: 'health',
  READINGS_LATEST: 'readings:latest',
  ANALYTICS: 'analytics',
} as const;

/**
 * Generate a deterministic key from an object of parameters
 */
function serializeParams(params: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return 'default';
  }

  return Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null)
    .sort()
    .map(key => `${key}:${String(params[key])}`)
    .join(':');
}

/**
 * Generate cache key for a single device
 */
export function deviceKey(deviceId: string): string {
  return `${CACHE_PREFIXES.DEVICE}:${deviceId}`;
}

/**
 * Generate cache key for device list with filters
 */
export function devicesListKey(filters: Record<string, unknown> = {}): string {
  return `${CACHE_PREFIXES.DEVICES_LIST}:${serializeParams(filters)}`;
}

/**
 * Generate cache key for metadata endpoint
 */
export function metadataKey(params: Record<string, unknown> = {}): string {
  return `${CACHE_PREFIXES.METADATA}:${serializeParams(params)}`;
}

/**
 * Generate cache key for health analytics
 */
export function healthKey(filters: Record<string, unknown> = {}): string {
  return `${CACHE_PREFIXES.HEALTH}:${serializeParams(filters)}`;
}

/**
 * Generate cache key for latest readings
 */
export function latestReadingsKey(
  deviceIds: string[] = [],
  types: string[] = []
): string {
  const params = {
    devices: deviceIds.sort().join(',') || 'all',
    types: types.sort().join(',') || 'all',
  };
  return `${CACHE_PREFIXES.READINGS_LATEST}:${serializeParams(params)}`;
}

/**
 * Generate cache key for analytics data
 */
export function analyticsKey(
  endpoint: string,
  params: Record<string, unknown> = {}
): string {
  return `${CACHE_PREFIXES.ANALYTICS}:${endpoint}:${serializeParams(params)}`;
}

// ============================================================================
// PATTERN GENERATORS (for invalidation)
// ============================================================================

/**
 * Pattern to match all device cache keys
 */
export function devicePattern(): string {
  return `${CACHE_PREFIXES.DEVICE}:*`;
}

/**
 * Pattern to match all device list cache keys
 */
export function devicesListPattern(): string {
  return `${CACHE_PREFIXES.DEVICES_LIST}:*`;
}

/**
 * Pattern to match all metadata cache keys
 */
export function metadataPattern(): string {
  return `${CACHE_PREFIXES.METADATA}:*`;
}

/**
 * Pattern to match all health cache keys
 */
export function healthPattern(): string {
  return `${CACHE_PREFIXES.HEALTH}:*`;
}

/**
 * Pattern to match all readings cache keys
 */
export function readingsPattern(): string {
  return `${CACHE_PREFIXES.READINGS_LATEST}:*`;
}

/**
 * Pattern to match all analytics cache keys
 */
export function analyticsPattern(): string {
  return `${CACHE_PREFIXES.ANALYTICS}:*`;
}
