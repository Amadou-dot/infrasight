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
export async function invalidateDevice(deviceId: string): Promise<void> {
  try {
    await Promise.all([
      // Specific device cache
      del(deviceKey(deviceId)),
      // All device lists (filters may include this device)
      delPattern(devicesListPattern()),
      // Metadata (device counts, manufacturers, etc.)
      delPattern(metadataPattern()),
      // Health analytics (device health stats)
      delPattern(healthPattern()),
    ]);

    logger.debug('Device cache invalidated', { deviceId });
  } catch (error) {
    logger.warn(
      'Device cache invalidation failed',
      { deviceId },
      error as Error
    );
  }
}

/**
 * Invalidate cache when devices are bulk updated
 * Called after bulk operations
 */
export async function invalidateAllDevices(): Promise<void> {
  try {
    await Promise.all([
      delPattern(`device:*`),
      delPattern(devicesListPattern()),
      delPattern(metadataPattern()),
      delPattern(healthPattern()),
    ]);

    logger.debug('All device caches invalidated');
  } catch (error) {
    logger.warn('Bulk device cache invalidation failed', {}, error as Error);
  }
}

/**
 * Invalidate cache when a device is created
 * Less aggressive than update - only lists and metadata
 */
export async function invalidateOnDeviceCreate(): Promise<void> {
  try {
    await Promise.all([
      delPattern(devicesListPattern()),
      delPattern(metadataPattern()),
      delPattern(healthPattern()),
    ]);

    logger.debug('Device create cache invalidated');
  } catch (error) {
    logger.warn('Device create cache invalidation failed', {}, error as Error);
  }
}

// ============================================================================
// READINGS INVALIDATION
// ============================================================================

/**
 * Invalidate cache after readings ingestion
 * Called after readings are inserted
 */
export async function invalidateReadings(): Promise<void> {
  try {
    await Promise.all([
      delPattern(readingsPattern()),
      // Health cache depends on last_seen which is updated with readings
      delPattern(healthPattern()),
    ]);

    logger.debug('Readings cache invalidated');
  } catch (error) {
    logger.warn('Readings cache invalidation failed', {}, error as Error);
  }
}

/**
 * Invalidate readings for specific devices
 */
export async function invalidateDeviceReadings(deviceIds: string[]): Promise<void> {
  if (deviceIds.length === 0) return;

  try {
    // For now, invalidate all readings cache
    // Could be optimized to only invalidate specific device readings
    await delPattern(readingsPattern());

    logger.debug('Device readings cache invalidated', { deviceCount: deviceIds.length });
  } catch (error) {
    logger.warn(
      'Device readings cache invalidation failed',
      { deviceIds },
      error as Error
    );
  }
}

// ============================================================================
// HEALTH INVALIDATION
// ============================================================================

/**
 * Invalidate health analytics cache
 * Called when device status changes or health metrics update
 */
export async function invalidateHealthCache(): Promise<void> {
  try {
    await delPattern(healthPattern());

    logger.debug('Health cache invalidated');
  } catch (error) {
    logger.warn('Health cache invalidation failed', {}, error as Error);
  }
}

// ============================================================================
// METADATA INVALIDATION
// ============================================================================

/**
 * Invalidate metadata cache
 * Called when aggregated stats need refreshing
 */
export async function invalidateMetadata(): Promise<void> {
  try {
    await delPattern(metadataPattern());

    logger.debug('Metadata cache invalidated');
  } catch (error) {
    logger.warn('Metadata cache invalidation failed', {}, error as Error);
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
      delPattern('device:*'),
      delPattern('devices:*'),
      delPattern('metadata:*'),
      delPattern('health:*'),
      delPattern('readings:*'),
      delPattern('analytics:*'),
    ]);

    logger.info('All caches cleared');
  } catch (error) {
    logger.error('Full cache clear failed', {}, error as Error);
  }
}
