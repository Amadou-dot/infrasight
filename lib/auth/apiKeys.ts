/**
 * API Key Management
 *
 * Handles API key validation and storage.
 * Keys are stored in environment variable for simplicity.
 *
 * Format: API_KEYS=name:key:role,name:key:role,...
 * Example: API_KEYS=sensor-gateway:abc123:operator,dashboard:xyz789:viewer
 */

import { createHash } from 'crypto';
import { isValidRole, type Role } from './permissions';
import { logger } from '../monitoring/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface ApiKeyConfig {
  /** Human-readable name for the key (used in audit trails) */
  name: string;
  /** The actual API key value */
  key: string;
  /** Role assigned to this key */
  role: Role;
}

export interface ValidatedApiKey {
  /** Key name for audit trails */
  name: string;
  /** Role for permission checks */
  role: Role;
  /** Masked key for logging (first 4 and last 4 chars) */
  maskedKey: string;
}

// ============================================================================
// KEY PARSING
// ============================================================================

/**
 * Parse API keys from environment variable
 * Format: name:key:role,name:key:role,...
 */
function parseApiKeys(): ApiKeyConfig[] {
  const keysEnv = process.env.API_KEYS || '';

  if (!keysEnv.trim()) 
    return [];
  

  const keys: ApiKeyConfig[] = [];

  for (const entry of keysEnv.split(',')) {
    const parts = entry.trim().split(':');

    if (parts.length !== 3) {
      logger.warn('Invalid API key format, skipping', {
        entry: entry.slice(0, 20) + '...',
      });
      continue;
    }

    const [name, key, role] = parts;

    if (!name || !key || !isValidRole(role)) {
      logger.warn('Invalid API key values, skipping', { name });
      continue;
    }

    keys.push({ name, key, role: role as Role });
  }

  return keys;
}

// Cache parsed keys
let cachedKeys: ApiKeyConfig[] | null = null;

function getApiKeys(): ApiKeyConfig[] {
  if (cachedKeys === null) {
    cachedKeys = parseApiKeys();
    if (cachedKeys.length > 0) 
      logger.info('API keys loaded', { count: cachedKeys.length });
    
  }
  return cachedKeys;
}

/**
 * Clear cached keys (for testing or key rotation)
 */
export function clearApiKeyCache(): void {
  cachedKeys = null;
}

// ============================================================================
// KEY UTILITIES
// ============================================================================

/**
 * Mask an API key for safe logging
 */
function maskKey(key: string): string {
  if (key.length <= 8) 
    return '****';
  
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Hash an API key for secure comparison (future use)
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate an API key and return its configuration
 *
 * @returns Validated key info or null if invalid
 */
export function validateApiKey(providedKey: string): ValidatedApiKey | null {
  if (!providedKey) 
    return null;
  

  const keys = getApiKeys();

  // Simple string comparison for now
  // Could be enhanced to use hashed keys for security
  const found = keys.find(k => k.key === providedKey);

  if (!found) {
    logger.auth('failure', maskKey(providedKey), {
      reason: 'Invalid key',
    });
    return null;
  }

  return {
    name: found.name,
    role: found.role,
    maskedKey: maskKey(providedKey),
  };
}

/**
 * Extract API key from request headers
 *
 * Supports:
 * - Authorization: Bearer <key>
 * - X-API-Key: <key>
 */
export function extractApiKey(request: Request): string | null {
  // Check Authorization header first (preferred)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) 
    return authHeader.slice(7);
  

  // Check X-API-Key header
  const apiKeyHeader = request.headers.get('x-api-key');
  if (apiKeyHeader) 
    return apiKeyHeader;
  

  return null;
}

// ============================================================================
// KEY MANAGEMENT
// ============================================================================

/**
 * Check if authentication is required
 * Returns false if API_KEYS is empty (opt-in auth)
 */
export function isAuthRequired(): boolean {
  // Auth is opt-in - if no keys configured, auth is disabled
  return getApiKeys().length > 0;
}

/**
 * Get list of configured key names (for admin purposes)
 */
export function getConfiguredKeyNames(): string[] {
  return getApiKeys().map(k => k.name);
}
