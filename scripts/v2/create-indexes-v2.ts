/**
 * Create Database Indexes for V2 Collections
 *
 * This script creates all necessary indexes for the devices_v2 and readings_v2 collections
 * to optimize query performance.
 *
 * Usage: pnpm run create-indexes-v2
 *
 * This script is IDEMPOTENT - safe to run multiple times.
 * MongoDB's createIndex will not recreate existing indexes.
 */

import mongoose from 'mongoose';
import dbConnect from '../../lib/db';

// ============================================================================
// INDEX DEFINITIONS
// ============================================================================

// Index specification type
type IndexSpec = Record<string, 1 | -1>;

interface IndexDefinition {
  name: string;
  spec: IndexSpec;
  options: { unique?: boolean; sparse?: boolean; background?: boolean };
  description: string;
}

/**
 * DeviceV2 Index Definitions
 *
 * These indexes optimize:
 * - Device lookups by serial number (unique constraint)
 * - Floor plan queries (building + floor)
 * - Status filtering
 * - Offline device detection (last_seen)
 * - Soft delete queries (deleted_at)
 */
const DEVICE_V2_INDEXES: IndexDefinition[] = [
  {
    name: 'serial_number_unique',
    spec: { serial_number: 1 } as IndexSpec,
    options: { unique: true, background: true },
    description: 'Unique index on serial_number for device lookups',
  },
  {
    name: 'location_building_floor',
    spec: { 'location.building_id': 1, 'location.floor': 1 } as IndexSpec,
    options: { background: true },
    description: 'Compound index for floor plan queries',
  },
  {
    name: 'status',
    spec: { status: 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for filtering devices by operational status',
  },
  {
    name: 'health_last_seen',
    spec: { 'health.last_seen': -1 } as IndexSpec,
    options: { background: true },
    description: 'Descending index for finding offline/stale devices',
  },
  {
    name: 'audit_deleted_at_sparse',
    spec: { 'audit.deleted_at': 1 } as IndexSpec,
    options: { sparse: true, background: true },
    description: 'Sparse index for soft delete queries (only indexes non-null values)',
  },
  {
    name: 'type',
    spec: { type: 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for filtering devices by type',
  },
  {
    name: 'metadata_department',
    spec: { 'metadata.department': 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for filtering devices by department',
  },
  {
    name: 'metadata_tags',
    spec: { 'metadata.tags': 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for filtering devices by tags (multikey)',
  },
  {
    name: 'manufacturer',
    spec: { manufacturer: 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for filtering devices by manufacturer',
  },
];

/**
 * ReadingV2 Index Definitions
 *
 * These indexes optimize:
 * - Time-series queries (device_id + timestamp)
 * - Anomaly detection queries
 * - Source filtering
 *
 * Note: The primary compound index on metadata.device_id + timestamp is
 * critical for timeseries read performance.
 */
const READING_V2_INDEXES: IndexDefinition[] = [
  {
    name: 'metadata_device_timestamp',
    spec: { 'metadata.device_id': 1, timestamp: -1 } as IndexSpec,
    options: { background: true },
    description: 'Critical compound index for device time-series queries',
  },
  {
    name: 'quality_is_anomaly',
    spec: { 'quality.is_anomaly': 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for fast anomaly queries',
  },
  {
    name: 'metadata_source',
    spec: { 'metadata.source': 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for filtering readings by data source',
  },
  {
    name: 'metadata_type',
    spec: { 'metadata.type': 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for filtering readings by measurement type',
  },
  {
    name: 'quality_is_valid',
    spec: { 'quality.is_valid': 1 } as IndexSpec,
    options: { background: true },
    description: 'Index for filtering valid/invalid readings',
  },
  {
    name: 'timestamp_desc',
    spec: { timestamp: -1 } as IndexSpec,
    options: { background: true },
    description: 'Descending timestamp index for latest readings queries',
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create indexes for a collection with logging
 */
async function createCollectionIndexes(
  collectionName: string,
  indexes: IndexDefinition[]
): Promise<{ success: number; skipped: number; failed: number }> {
  const collection = mongoose.connection.collection(collectionName);
  const stats = { success: 0, skipped: 0, failed: 0 };

  // Get existing indexes
  const existingIndexes = await collection.indexes();
  const existingIndexNames = new Set(existingIndexes.map((idx) => idx.name));

  console.log(`\n📦 Collection: ${collectionName}`);
  console.log(`   Existing indexes: ${existingIndexNames.size}`);
  console.log('─'.repeat(60));

  for (const index of indexes) {
    try {
      // Check if index already exists
      if (existingIndexNames.has(index.name)) {
        console.log(`   ⏭️  [SKIP] ${index.name} - already exists`);
        stats.skipped++;
        continue;
      }

      // Create the index
      const startTime = Date.now();
      await collection.createIndex(index.spec, {
        unique: index.options.unique,
        sparse: index.options.sparse,
        background: index.options.background,
        name: index.name,
      });
      const duration = Date.now() - startTime;

      console.log(`   ✅ [CREATE] ${index.name} (${duration}ms)`);
      console.log(`      └─ ${index.description}`);
      stats.success++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ [FAIL] ${index.name}: ${errorMessage}`);
      stats.failed++;
    }
  }

  return stats;
}

/**
 * Verify indexes after creation
 */
async function verifyIndexes(collectionName: string): Promise<void> {
  const collection = mongoose.connection.collection(collectionName);
  const indexes = await collection.indexes();

  console.log(`\n📋 Final indexes for ${collectionName}:`);
  indexes.forEach((idx) => {
    const keys = Object.entries(idx.key)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    console.log(`   • ${idx.name}: { ${keys} }`);
  });
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function createIndexes(): Promise<void> {
  const startTime = Date.now();

  console.log('═'.repeat(60));
  console.log('🔧 V2 Index Creation Script');
  console.log('═'.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    // Connect to database
    console.log('\n🔌 Connecting to MongoDB...');
    await dbConnect();
    console.log('   Connected successfully.');

    // Check if collections exist
    const collections = await mongoose.connection.db!.listCollections().toArray();
    const collectionNames = new Set(collections.map((c) => c.name));

    const hasDevicesV2 = collectionNames.has('devices_v2');
    const hasReadingsV2 = collectionNames.has('readings_v2');

    if (!hasDevicesV2) {
      console.log(
        '\n⚠️  Collection devices_v2 does not exist yet. Creating indexes will create the collection.'
      );
    }

    if (!hasReadingsV2) {
      console.log(
        '\n⚠️  Collection readings_v2 does not exist yet. Creating indexes will create the collection.'
      );
    }

    // Create indexes for devices_v2
    const deviceStats = await createCollectionIndexes(
      'devices_v2',
      DEVICE_V2_INDEXES
    );

    // Create indexes for readings_v2
    const readingStats = await createCollectionIndexes(
      'readings_v2',
      READING_V2_INDEXES
    );

    // Verify indexes
    await verifyIndexes('devices_v2');
    await verifyIndexes('readings_v2');

    // Summary
    const totalSuccess = deviceStats.success + readingStats.success;
    const totalSkipped = deviceStats.skipped + readingStats.skipped;
    const totalFailed = deviceStats.failed + readingStats.failed;
    const duration = Date.now() - startTime;

    console.log('\n' + '═'.repeat(60));
    console.log('📊 Summary');
    console.log('═'.repeat(60));
    console.log(`   ✅ Created: ${totalSuccess} indexes`);
    console.log(`   ⏭️  Skipped: ${totalSkipped} indexes (already existed)`);
    console.log(`   ❌ Failed:  ${totalFailed} indexes`);
    console.log(`   ⏱️  Duration: ${duration}ms`);
    console.log('═'.repeat(60));

    if (totalFailed > 0) {
      console.log('\n⚠️  Some indexes failed to create. Please check the errors above.');
      process.exit(1);
    }

    console.log('\n✅ Index creation completed successfully!');
  } catch (error) {
    console.error('\n❌ Fatal error during index creation:');
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB.');
  }
}

// Run the script
createIndexes();
