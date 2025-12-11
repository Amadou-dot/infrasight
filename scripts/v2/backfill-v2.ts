/**
 * V1 to V2 Backfill Migration Script
 *
 * One-time migration script to populate v2 collections from v1 data.
 *
 * Features:
 * - Batch processing for efficient memory usage
 * - Progress tracking and logging
 * - Idempotent (safe to run multiple times)
 * - Graceful error handling (doesn't stop on individual failures)
 *
 * Usage: pnpm run backfill-v2
 */

import mongoose from 'mongoose';
import dbConnect from '../../lib/db';
import Device, { type IDevice } from '../../models/Device';
import Reading, { type IReading } from '../../models/Reading';
import DeviceV2 from '../../models/v2/DeviceV2';
import ReadingV2 from '../../models/v2/ReadingV2';
import {
  mapDeviceV1toV2,
  mapReadingV1toV2,
  validateDeviceV1ForMigration,
  validateReadingV1ForMigration,
} from '../../lib/migration/v1-to-v2-mapper';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  /** Batch size for device migration */
  deviceBatchSize: 100,
  /** Batch size for reading migration */
  readingBatchSize: 1000,
  /** Progress log interval */
  logInterval: 100,
  /** User identifier for audit trail */
  migratedBy: 'sys-migration-agent',
  /** Whether to skip existing v2 records (idempotent) */
  skipExisting: true,
  /** Maximum days of readings to migrate (null = all) */
  readingDaysLimit: 90,
};

// ============================================================================
// TYPES
// ============================================================================

interface MigrationStats {
  devices: {
    total: number;
    migrated: number;
    skipped: number;
    failed: number;
    errors: string[];
  };
  readings: {
    total: number;
    migrated: number;
    skipped: number;
    failed: number;
    errors: string[];
  };
  startTime: Date;
  endTime?: Date;
  duration?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Log progress bar
 */
function logProgress(current: number, total: number, label: string): void {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const barLength = 30;
  const filledLength = Math.round((percentage / 100) * barLength);
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

  process.stdout.write(`\r   [${bar}] ${percentage}% (${current}/${total}) ${label}    `);
}

/**
 * Get existing v2 device IDs for idempotent migration
 */
async function getExistingV2DeviceIds(): Promise<Set<string>> {
  const devices = await DeviceV2.find({}, { _id: 1 }).lean();
  return new Set(devices.map((d) => d._id as string));
}

/**
 * Get existing v2 reading keys for deduplication
 * Key format: `${device_id}_${timestamp.toISOString()}`
 */
async function getExistingV2ReadingKeys(): Promise<Set<string>> {
  console.log('   Fetching existing v2 reading keys for deduplication...');

  // This could be memory-intensive for large datasets
  // For production, consider using cursor-based iteration
  const readings = await ReadingV2.find(
    {},
    { 'metadata.device_id': 1, timestamp: 1 }
  )
    .lean()
    .limit(1000000); // Cap at 1M for memory safety

  const keys = new Set<string>();
  for (const r of readings) {
    const key = `${r.metadata.device_id}_${new Date(r.timestamp).toISOString()}`;
    keys.add(key);
  }

  console.log(`   Found ${keys.size} existing v2 readings`);
  return keys;
}

// ============================================================================
// DEVICE MIGRATION
// ============================================================================

/**
 * Migrate all devices from v1 to v2
 */
async function migrateDevices(stats: MigrationStats): Promise<void> {
  console.log('\n📦 Migrating Devices...');
  console.log('─'.repeat(60));

  // Get total count
  stats.devices.total = await Device.countDocuments();
  console.log(`   Total v1 devices: ${stats.devices.total}`);

  if (stats.devices.total === 0) {
    console.log('   No devices to migrate.');
    return;
  }

  // Get existing v2 IDs for idempotent migration
  const existingIds = CONFIG.skipExisting
    ? await getExistingV2DeviceIds()
    : new Set<string>();
  console.log(`   Existing v2 devices: ${existingIds.size}`);

  // Process in batches using cursor
  let processed = 0;
  const cursor = Device.find().lean().cursor();

  const batch: IDevice[] = [];

  for await (const device of cursor) {
    batch.push(device);

    if (batch.length >= CONFIG.deviceBatchSize) {
      await processDeviceBatch(batch, existingIds, stats);
      processed += batch.length;
      logProgress(processed, stats.devices.total, 'devices');
      batch.length = 0; // Clear batch
    }
  }

  // Process remaining devices
  if (batch.length > 0) {
    await processDeviceBatch(batch, existingIds, stats);
    processed += batch.length;
    logProgress(processed, stats.devices.total, 'devices');
  }

  console.log('\n');
}

/**
 * Process a batch of devices
 */
async function processDeviceBatch(
  devices: IDevice[],
  existingIds: Set<string>,
  stats: MigrationStats
): Promise<void> {
  const toInsert = [];

  for (const device of devices) {
    // Skip if already exists in v2
    if (existingIds.has(device._id)) {
      stats.devices.skipped++;
      continue;
    }

    // Validate device
    const validation = validateDeviceV1ForMigration(device);
    if (!validation.valid) {
      stats.devices.failed++;
      stats.devices.errors.push(
        `Device ${device._id}: ${validation.errors.join(', ')}`
      );
      continue;
    }

    // Map to v2 format
    try {
      const v2Device = mapDeviceV1toV2(device, {
        created_by: CONFIG.migratedBy,
      });
      toInsert.push(v2Device);
    } catch (error) {
      stats.devices.failed++;
      stats.devices.errors.push(
        `Device ${device._id}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Bulk insert
  if (toInsert.length > 0) {
    try {
      await DeviceV2.insertMany(toInsert, { ordered: false });
      stats.devices.migrated += toInsert.length;
    } catch (error) {
      if (error instanceof mongoose.mongo.MongoBulkWriteError) {
        // Some succeeded, some failed
        stats.devices.migrated += error.insertedCount;
        stats.devices.failed += toInsert.length - error.insertedCount;

        // Log duplicate key errors (expected for idempotent migration)
        const writeErrors = Array.isArray(error.writeErrors)
          ? error.writeErrors
          : error.writeErrors
            ? [error.writeErrors]
            : [];
        for (const writeError of writeErrors) {
          if (writeError.code !== 11000) {
            // Not a duplicate key error
            stats.devices.errors.push(`Bulk insert error: ${writeError.errmsg}`);
          }
        }
      } else {
        stats.devices.failed += toInsert.length;
        stats.devices.errors.push(
          `Bulk insert failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }
}

// ============================================================================
// READING MIGRATION
// ============================================================================

/**
 * Migrate readings from v1 to v2
 */
async function migrateReadings(stats: MigrationStats): Promise<void> {
  console.log('\n📊 Migrating Readings...');
  console.log('─'.repeat(60));

  // Build date filter
  const dateFilter: Record<string, unknown> = {};
  if (CONFIG.readingDaysLimit) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.readingDaysLimit);
    dateFilter.timestamp = { $gte: cutoffDate };
    console.log(`   Filtering readings from last ${CONFIG.readingDaysLimit} days`);
  }

  // Get total count
  stats.readings.total = await Reading.countDocuments(dateFilter);
  console.log(`   Total v1 readings to migrate: ${stats.readings.total}`);

  if (stats.readings.total === 0) {
    console.log('   No readings to migrate.');
    return;
  }

  // For very large datasets, we skip the existing key check
  // and rely on the timestamp+device_id compound index for deduplication
  let existingKeys: Set<string> | null = null;
  if (stats.readings.total < 500000 && CONFIG.skipExisting) {
    existingKeys = await getExistingV2ReadingKeys();
  } else {
    console.log('   Skipping deduplication check (large dataset)');
  }

  // Process in batches using cursor
  let processed = 0;
  const cursor = Reading.find(dateFilter).lean().cursor();

  const batch: IReading[] = [];

  for await (const reading of cursor) {
    batch.push(reading);

    if (batch.length >= CONFIG.readingBatchSize) {
      await processReadingBatch(batch, existingKeys, stats);
      processed += batch.length;

      if (processed % (CONFIG.readingBatchSize * CONFIG.logInterval) === 0) {
        logProgress(processed, stats.readings.total, 'readings');
      }

      batch.length = 0; // Clear batch
    }
  }

  // Process remaining readings
  if (batch.length > 0) {
    await processReadingBatch(batch, existingKeys, stats);
    processed += batch.length;
    logProgress(processed, stats.readings.total, 'readings');
  }

  console.log('\n');
}

/**
 * Process a batch of readings
 */
async function processReadingBatch(
  readings: IReading[],
  existingKeys: Set<string> | null,
  stats: MigrationStats
): Promise<void> {
  const toInsert = [];

  for (const reading of readings) {
    // Check for existing if we have the keys
    if (existingKeys) {
      const key = `${reading.metadata.device_id}_${new Date(reading.timestamp).toISOString()}`;
      if (existingKeys.has(key)) {
        stats.readings.skipped++;
        continue;
      }
    }

    // Validate reading
    const validation = validateReadingV1ForMigration(reading);
    if (!validation.valid) {
      stats.readings.failed++;
      if (stats.readings.errors.length < 100) {
        // Cap error messages
        stats.readings.errors.push(
          `Reading for ${reading.metadata?.device_id}: ${validation.errors.join(', ')}`
        );
      }
      continue;
    }

    // Map to v2 format
    try {
      const v2Reading = mapReadingV1toV2(reading, {
        source: 'sensor',
      });
      toInsert.push(v2Reading);
    } catch (error) {
      stats.readings.failed++;
      if (stats.readings.errors.length < 100) {
        stats.readings.errors.push(
          `Reading mapping error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  // Bulk insert
  if (toInsert.length > 0) {
    try {
      await ReadingV2.insertMany(toInsert, { ordered: false });
      stats.readings.migrated += toInsert.length;
    } catch (error) {
      if (error instanceof mongoose.mongo.MongoBulkWriteError) {
        stats.readings.migrated += error.insertedCount;
        stats.readings.failed += toInsert.length - error.insertedCount;
      } else {
        stats.readings.failed += toInsert.length;
        if (stats.readings.errors.length < 100) {
          stats.readings.errors.push(
            `Bulk insert failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    }
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runMigration(): Promise<void> {
  const stats: MigrationStats = {
    devices: {
      total: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    },
    readings: {
      total: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    },
    startTime: new Date(),
  };

  console.log('═'.repeat(60));
  console.log('🔄 V1 to V2 Backfill Migration');
  console.log('═'.repeat(60));
  console.log(`Started at: ${stats.startTime.toISOString()}`);
  console.log(`Configuration:`);
  console.log(`   - Device batch size: ${CONFIG.deviceBatchSize}`);
  console.log(`   - Reading batch size: ${CONFIG.readingBatchSize}`);
  console.log(`   - Skip existing: ${CONFIG.skipExisting}`);
  console.log(`   - Reading days limit: ${CONFIG.readingDaysLimit || 'All'}`);

  try {
    // Connect to database
    console.log('\n🔌 Connecting to MongoDB...');
    await dbConnect();
    console.log('   Connected successfully.');

    // Run migrations
    await migrateDevices(stats);
    await migrateReadings(stats);

    // Finalize stats
    stats.endTime = new Date();
    stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

    // Print summary
    console.log('═'.repeat(60));
    console.log('📊 Migration Summary');
    console.log('═'.repeat(60));

    console.log('\nDevices:');
    console.log(`   ✅ Migrated: ${stats.devices.migrated}`);
    console.log(`   ⏭️  Skipped:  ${stats.devices.skipped}`);
    console.log(`   ❌ Failed:   ${stats.devices.failed}`);
    console.log(`   📦 Total:    ${stats.devices.total}`);

    console.log('\nReadings:');
    console.log(`   ✅ Migrated: ${stats.readings.migrated}`);
    console.log(`   ⏭️  Skipped:  ${stats.readings.skipped}`);
    console.log(`   ❌ Failed:   ${stats.readings.failed}`);
    console.log(`   📊 Total:    ${stats.readings.total}`);

    console.log(`\n⏱️  Duration: ${formatDuration(stats.duration)}`);

    // Print errors if any
    if (stats.devices.errors.length > 0 || stats.readings.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      if (stats.devices.errors.length > 0) {
        console.log('\n   Device errors:');
        stats.devices.errors.slice(0, 10).forEach((err) => {
          console.log(`   - ${err}`);
        });
        if (stats.devices.errors.length > 10) {
          console.log(`   ... and ${stats.devices.errors.length - 10} more`);
        }
      }
      if (stats.readings.errors.length > 0) {
        console.log('\n   Reading errors:');
        stats.readings.errors.slice(0, 10).forEach((err) => {
          console.log(`   - ${err}`);
        });
        if (stats.readings.errors.length > 10) {
          console.log(`   ... and ${stats.readings.errors.length - 10} more`);
        }
      }
    }

    console.log('\n' + '═'.repeat(60));

    // Determine exit code
    const hasFailures =
      stats.devices.failed > 0 || stats.readings.failed > 0;
    if (hasFailures) {
      console.log('⚠️  Migration completed with some failures.');
      process.exitCode = 1;
    } else {
      console.log('✅ Migration completed successfully!');
    }
  } catch (error) {
    console.error('\n❌ Fatal error during migration:');
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB.');
  }
}

// Run the migration
runMigration();
