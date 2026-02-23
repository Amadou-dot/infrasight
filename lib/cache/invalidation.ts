/**
 * Cache Invalidation
 *
 * Strategies for invalidating cached data on mutations.
 * Ensures cache consistency after database changes.
 */

import { del, delPattern } from './cache';
import {
  deviceKey,
  devicesListPattern,
  metadataPattern,
  healthPattern,
  readingsPattern,
} from './keys';
import { logger } from '../monitoring/logger';

// ============================================================================
// DEVICE INVALIDATION
// ============================================================================

/**
 * Invalidate cache when a single device is updated
 * Called after PATCH or DELETE on a device
 */
export async function invalidateDevice(orgId: string, deviceId: string): Promise<void> {
  try {
    await Promise.all([
      // Specific device cache
      del(deviceKey(orgId, deviceId)),
      // All device lists (filters may include this device)
      delPattern(devicesListPattern(orgId)),
      // Metadata (device counts, manufacturers, etc.)
      delPattern(metadataPattern(orgId)),
      // Health analytics (device health stats)
      delPattern(healthPattern(orgId)),
    ]);

    logger.debug('Device cache invalidated', { orgId, deviceId });
  } catch (error) {
    logger.warn('Device cache invalidation failed', { orgId, deviceId }, error as Error);
  }
}

/**
 * Invalidate cache when devices are bulk updated
 * Called after bulk operations
 */
export async function invalidateAllDevices(orgId: string): Promise<void> {
  try {
    await Promise.all([
      delPattern(`org:${orgId}:device:*`),
      delPattern(devicesListPattern(orgId)),
      delPattern(metadataPattern(orgId)),
      delPattern(healthPattern(orgId)),
    ]);

    logger.debug('All device caches invalidated', { orgId });
  } catch (error) {
    logger.warn('Bulk device cache invalidation failed', { orgId }, error as Error);
  }
}

/**
 * Invalidate cache when a device is created
 * Less aggressive than update - only lists and metadata
 */
export async function invalidateOnDeviceCreate(orgId: string): Promise<void> {
  try {
    await Promise.all([
      delPattern(devicesListPattern(orgId)),
      delPattern(metadataPattern(orgId)),
      delPattern(healthPattern(orgId)),
    ]);

    logger.debug('Device create cache invalidated', { orgId });
  } catch (error) {
    logger.warn('Device create cache invalidation failed', { orgId }, error as Error);
  }
}

// ============================================================================
// READINGS INVALIDATION
// ============================================================================

/**
 * Invalidate cache after readings ingestion
 * Called after readings are inserted
 */
export async function invalidateReadings(orgId: string): Promise<void> {
  try {
    await Promise.all([
      delPattern(readingsPattern(orgId)),
      // Health cache depends on last_seen which is updated with readings
      delPattern(healthPattern(orgId)),
    ]);

    logger.debug('Readings cache invalidated', { orgId });
  } catch (error) {
    logger.warn('Readings cache invalidation failed', { orgId }, error as Error);
  }
}

/**
 * Invalidate readings for specific devices
 */
export async function invalidateDeviceReadings(orgId: string, deviceIds: string[]): Promise<void> {
  if (deviceIds.length === 0) return;

  try {
    // For now, invalidate all readings cache
    // Could be optimized to only invalidate specific device readings
    await delPattern(readingsPattern(orgId));

    logger.debug('Device readings cache invalidated', { orgId, deviceCount: deviceIds.length });
  } catch (error) {
    logger.warn('Device readings cache invalidation failed', { orgId, deviceIds }, error as Error);
  }
}

// ============================================================================
// HEALTH INVALIDATION
// ============================================================================

/**
 * Invalidate health analytics cache
 * Called when device status changes or health metrics update
 */
export async function invalidateHealthCache(orgId: string): Promise<void> {
  try {
    await delPattern(healthPattern(orgId));

    logger.debug('Health cache invalidated', { orgId });
  } catch (error) {
    logger.warn('Health cache invalidation failed', { orgId }, error as Error);
  }
}

// ============================================================================
// METADATA INVALIDATION
// ============================================================================

/**
 * Invalidate metadata cache
 * Called when aggregated stats need refreshing
 */
export async function invalidateMetadata(orgId: string): Promise<void> {
  try {
    await delPattern(metadataPattern(orgId));

    logger.debug('Metadata cache invalidated', { orgId });
  } catch (error) {
    logger.warn('Metadata cache invalidation failed', { orgId }, error as Error);
  }
}

// ============================================================================
// FULL CACHE CLEAR
// ============================================================================

/**
 * Clear all application caches
 * Use sparingly - for emergency situations or major data changes
 */
export async function clearAllCaches(): Promise<void> {
  try {
    await Promise.all([
      delPattern('org:*:device:*'),
      delPattern('org:*:devices:*'),
      delPattern('org:*:metadata:*'),
      delPattern('org:*:health:*'),
      delPattern('org:*:readings:*'),
      delPattern('org:*:analytics:*'),
    ]);

    logger.info('All caches cleared');
  } catch (error) {
    logger.error('Full cache clear failed', {}, error as Error);
  }
}
