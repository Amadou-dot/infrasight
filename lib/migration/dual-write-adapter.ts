/**
 * Dual-Write Adapter
 *
 * Provides functionality to write data to both v1 and v2 collections during
 * the migration transition period. This enables gradual migration with
 * zero-downtime and easy rollback.
 *
 * Key Features:
 * - Writes to both v1 and v2 collections
 * - V2 failures don't fail the entire operation (soft failure)
 * - Retry logic with exponential backoff
 * - Comprehensive logging for debugging
 *
 * Usage:
 * - Enable dual-write during the transition period
 * - Monitor v2 write success rate
 * - Once v2 is stable, switch dashboard to v2 endpoints
 * - Disable dual-write and deprecate v1
 */

import mongoose from 'mongoose';
import Device, { type IDevice } from '../../models/Device';
import Reading, { type IReading } from '../../models/Reading';
import DeviceV2, { type IDeviceV2 } from '../../models/v2/DeviceV2';
import ReadingV2, { type IReadingV2 } from '../../models/v2/ReadingV2';
import {
  mapDeviceV1toV2,
  mapReadingV1toV2,
  type DeviceV1,
  type ReadingV1,
} from './v1-to-v2-mapper';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Operation type for dual-write
 */
export type DualWriteOperation = 'create' | 'update' | 'delete';

/**
 * Result of a dual-write operation
 */
export interface DualWriteResult<T = unknown> {
  success: boolean;
  v1: {
    success: boolean;
    data?: T;
    error?: string;
  };
  v2: {
    success: boolean;
    data?: T;
    error?: string;
  };
  timestamp: Date;
}

/**
 * Dual-write options
 */
export interface DualWriteOptions {
  /** Number of retry attempts for v2 writes (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 100) */
  baseDelay?: number;
  /** Maximum delay in ms (default: 5000) */
  maxDelay?: number;
  /** Whether to fail the entire operation if v2 fails (default: false) */
  failOnV2Error?: boolean;
  /** Whether to log operations (default: true) */
  logging?: boolean;
}

// Default options
const DEFAULT_OPTIONS: Required<DualWriteOptions> = {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 5000,
  failOnV2Error: false,
  logging: true,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate delay for exponential backoff
 */
function calculateBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  const delay = baseDelay * Math.pow(2, attempt);
  return Math.min(delay, maxDelay);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  baseDelay: number,
  maxDelay: number
): Promise<{ success: boolean; data?: T; error?: string }> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) 
    try {
      const data = await operation();
      return { success: true, data };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        const delay = calculateBackoff(attempt, baseDelay, maxDelay);
        await sleep(delay);
      }
    }
  

  return { success: false, error: lastError?.message || 'Unknown error' };
}

/**
 * Log a dual-write operation
 */
function logOperation(
  operation: string,
  collection: string,
  result: DualWriteResult,
  options: DualWriteOptions
): void {
  if (!options.logging) 
    return;
  

  const status = result.success ? '✅' : '❌';
  const v1Status = result.v1.success ? '✓' : '✗';
  const v2Status = result.v2.success ? '✓' : '✗';

  console.log(
    `[DualWrite] ${status} ${operation} ${collection} | v1: ${v1Status} | v2: ${v2Status}`
  );

  if (!result.v1.success) 
    console.error(`[DualWrite] V1 error: ${result.v1.error}`);
  
  if (!result.v2.success) 
    console.error(`[DualWrite] V2 error: ${result.v2.error}`);
  
}

// ============================================================================
// DEVICE DUAL-WRITE OPERATIONS
// ============================================================================

/**
 * Create a device in both v1 and v2 collections
 */
export async function dualWriteCreateDevice(
  deviceData: Partial<IDevice>,
  options: DualWriteOptions = {}
): Promise<DualWriteResult<IDevice | IDeviceV2>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result: DualWriteResult<IDevice | IDeviceV2> = {
    success: false,
    v1: { success: false },
    v2: { success: false },
    timestamp: new Date(),
  };

  // Write to v1 (primary)
  try {
    const v1Device = new Device(deviceData);
    const saved = await v1Device.save();
    result.v1 = { success: true, data: saved.toObject() };
  } catch (error) {
    result.v1 = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    // V1 failure is critical - return immediately
    logOperation('CREATE', 'device', result, opts);
    return result;
  }

  // Map and write to v2 (secondary, with retry)
  const v2Data = mapDeviceV1toV2(result.v1.data as DeviceV1);
  result.v2 = await withRetry(
    async () => {
      const v2Device = new DeviceV2(v2Data);
      const saved = await v2Device.save();
      return saved.toObject();
    },
    opts.maxRetries,
    opts.baseDelay,
    opts.maxDelay
  );

  // Determine overall success
  result.success =
    result.v1.success && (!opts.failOnV2Error || result.v2.success);

  logOperation('CREATE', 'device', result, opts);
  return result;
}

/**
 * Update a device in both v1 and v2 collections
 */
export async function dualWriteUpdateDevice(
  deviceId: string,
  updates: Partial<IDevice>,
  options: DualWriteOptions = {}
): Promise<DualWriteResult<IDevice | IDeviceV2>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result: DualWriteResult<IDevice | IDeviceV2> = {
    success: false,
    v1: { success: false },
    v2: { success: false },
    timestamp: new Date(),
  };

  // Update v1 (primary)
  try {
    const updated = await Device.findByIdAndUpdate(deviceId, updates, {
      new: true,
    }).lean();
    if (!updated) 
      result.v1 = { success: false, error: 'Device not found in v1' };
     else 
      result.v1 = { success: true, data: updated };
    
  } catch (error) {
    result.v1 = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // If v1 failed, don't attempt v2
  if (!result.v1.success) {
    logOperation('UPDATE', 'device', result, opts);
    return result;
  }

  // Map updates to v2 format and update
  const v2Updates: Record<string, unknown> = {};

  // Map v1 fields to v2 nested structure
  if (updates.building_id)
    v2Updates['location.building_id'] = updates.building_id;
  if (updates.floor !== undefined) v2Updates['location.floor'] = updates.floor;
  if (updates.room_name) v2Updates['location.room_name'] = updates.room_name;
  if (updates.type) v2Updates.type = updates.type;
  if (updates.status) v2Updates.status = updates.status;
  if (updates.configuration?.threshold_warning !== undefined) 
    v2Updates['configuration.threshold_warning'] =
      updates.configuration.threshold_warning;
  
  if (updates.configuration?.threshold_critical !== undefined) 
    v2Updates['configuration.threshold_critical'] =
      updates.configuration.threshold_critical;
  

  // Add audit info
  v2Updates['audit.updated_at'] = new Date();
  v2Updates['audit.updated_by'] = 'sys-dual-write';

  result.v2 = await withRetry(
    async () => {
      const updated = await DeviceV2.findByIdAndUpdate(deviceId, v2Updates, {
        new: true,
      }).lean();
      if (!updated) 
        throw new Error('Device not found in v2');
      
      return updated;
    },
    opts.maxRetries,
    opts.baseDelay,
    opts.maxDelay
  );

  result.success =
    result.v1.success && (!opts.failOnV2Error || result.v2.success);

  logOperation('UPDATE', 'device', result, opts);
  return result;
}

/**
 * Delete a device from both collections (soft delete for v2)
 */
export async function dualWriteDeleteDevice(
  deviceId: string,
  options: DualWriteOptions = {}
): Promise<DualWriteResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result: DualWriteResult<IDevice | IDeviceV2> = {
    success: false,
    v1: { success: false },
    v2: { success: false },
    timestamp: new Date(),
  };

  // Delete from v1 (hard delete)
  try {
    const deleted = await Device.findByIdAndDelete(deviceId).lean();
    if (!deleted) 
      result.v1 = { success: false, error: 'Device not found in v1' };
     else 
      result.v1 = { success: true, data: deleted };
    
  } catch (error) {
    result.v1 = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Soft delete in v2 (update deleted_at)
  result.v2 = await withRetry(
    async () => {
      const updated = await DeviceV2.findByIdAndUpdate(
        deviceId,
        {
          'audit.deleted_at': new Date(),
          'audit.deleted_by': 'sys-dual-write',
          status: 'decommissioned',
        },
        { new: true }
      ).lean();
      if (!updated) 
        throw new Error('Device not found in v2');
      
      return updated;
    },
    opts.maxRetries,
    opts.baseDelay,
    opts.maxDelay
  );

  result.success =
    result.v1.success && (!opts.failOnV2Error || result.v2.success);

  logOperation('DELETE', 'device', result, opts);
  return result;
}

// ============================================================================
// READING DUAL-WRITE OPERATIONS
// ============================================================================

/**
 * Create a reading in both v1 and v2 collections
 */
export async function dualWriteCreateReading(
  readingData: Partial<IReading>,
  options: DualWriteOptions = {}
): Promise<DualWriteResult<IReading | IReadingV2>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result: DualWriteResult<IReading | IReadingV2> = {
    success: false,
    v1: { success: false },
    v2: { success: false },
    timestamp: new Date(),
  };

  // Write to v1 (primary)
  try {
    const v1Reading = new Reading(readingData);
    const saved = await v1Reading.save();
    result.v1 = { success: true, data: saved.toObject() };
  } catch (error) {
    result.v1 = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    logOperation('CREATE', 'reading', result, opts);
    return result;
  }

  // Map and write to v2 (secondary, with retry)
  const v2Data = mapReadingV1toV2(result.v1.data as ReadingV1);
  result.v2 = await withRetry(
    async () => {
      const v2Reading = new ReadingV2(v2Data);
      const saved = await v2Reading.save();
      return saved.toObject();
    },
    opts.maxRetries,
    opts.baseDelay,
    opts.maxDelay
  );

  result.success =
    result.v1.success && (!opts.failOnV2Error || result.v2.success);

  logOperation('CREATE', 'reading', result, opts);
  return result;
}

/**
 * Bulk create readings in both v1 and v2 collections
 */
export async function dualWriteBulkCreateReadings(
  readings: Partial<IReading>[],
  options: DualWriteOptions = {}
): Promise<{
  v1: { inserted: number; failed: number };
  v2: { inserted: number; failed: number };
  timestamp: Date;
}> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Bulk insert to v1
  const v1Result = { inserted: 0, failed: 0 };
  try {
    const v1Inserted = await Reading.insertMany(readings, { ordered: false });
    v1Result.inserted = v1Inserted.length;
    v1Result.failed = readings.length - v1Inserted.length;
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoBulkWriteError) {
      v1Result.inserted = error.insertedCount;
      v1Result.failed = readings.length - error.insertedCount;
    } else 
      v1Result.failed = readings.length;
    
  }

  // Map and bulk insert to v2
  const v2Readings = readings.map(r => mapReadingV1toV2(r as ReadingV1));
  let v2Result = { inserted: 0, failed: 0 };

  const v2Attempt = await withRetry(
    async () => {
      const inserted = await ReadingV2.insertMany(v2Readings, {
        ordered: false,
      });
      return {
        inserted: inserted.length,
        failed: readings.length - inserted.length,
      };
    },
    opts.maxRetries,
    opts.baseDelay,
    opts.maxDelay
  );

  if (v2Attempt.success && v2Attempt.data) 
    v2Result = v2Attempt.data;
   else 
    v2Result.failed = readings.length;
  

  if (opts.logging) 
    console.log(
      `[DualWrite] BULK CREATE readings | v1: ${v1Result.inserted}/${readings.length} | v2: ${v2Result.inserted}/${readings.length}`
    );
  

  return {
    v1: v1Result,
    v2: v2Result,
    timestamp: new Date(),
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if dual-write is healthy (both collections accessible)
 */
export async function checkDualWriteHealth(): Promise<{
  healthy: boolean;
  v1: boolean;
  v2: boolean;
}> {
  const [v1Health, v2Health] = await Promise.all([
    // Check v1
    Device.findOne()
      .lean()
      .then(() => true)
      .catch(() => false),
    // Check v2
    DeviceV2.findOne()
      .lean()
      .then(() => true)
      .catch(() => false),
  ]);

  return {
    healthy: v1Health && v2Health,
    v1: v1Health,
    v2: v2Health,
  };
}

/**
 * Get dual-write statistics (counts in each collection)
 */
export async function getDualWriteStats(): Promise<{
  devices: { v1: number; v2: number; diff: number };
  readings: { v1: number; v2: number; diff: number };
}> {
  const [devicesV1, devicesV2, readingsV1, readingsV2] = await Promise.all([
    Device.countDocuments(),
    DeviceV2.countDocuments({ 'audit.deleted_at': { $exists: false } }),
    Reading.countDocuments(),
    ReadingV2.countDocuments(),
  ]);

  return {
    devices: {
      v1: devicesV1,
      v2: devicesV2,
      diff: devicesV1 - devicesV2,
    },
    readings: {
      v1: readingsV1,
      v2: readingsV2,
      diff: readingsV1 - readingsV2,
    },
  };
}

// ============================================================================
// EXPORT
// ============================================================================

const dualWriteAdapter = {
  // Device operations
  dualWriteCreateDevice,
  dualWriteUpdateDevice,
  dualWriteDeleteDevice,
  // Reading operations
  dualWriteCreateReading,
  dualWriteBulkCreateReadings,
  // Utilities
  checkDualWriteHealth,
  getDualWriteStats,
};

export default dualWriteAdapter;
