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
import { indexShapeMatches } from './index-shape';

// ============================================================================
// INDEX DEFINITIONS
// ============================================================================

// Index specification type
type IndexSpec = Record<string, 1 | -1>;

interface IndexDefinition {
  name: string;
  spec: IndexSpec;
  options: {
    unique?: boolean;
    sparse?: boolean;
    background?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  };
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
  {
    name: 'status_type_compound',
    spec: { status: 1, type: 1 } as IndexSpec,
    options: { background: true },
    description: 'Compound index for combined status+type filtering',
  },
  {
    name: 'battery_floor_compound',
    spec: { 'health.battery_level': -1, 'location.floor': 1 } as IndexSpec,
    options: { background: true },
    description: 'Compound index for low battery analytics by floor',
  },
  {
    name: 'deleted_last_seen_compound',
    spec: { 'audit.deleted_at': 1, 'health.last_seen': 1 } as IndexSpec,
    options: { background: true },
    description: 'Compound index for offline device detection with soft-delete filtering',
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

/**
 * AlertRuleV2 Index Definitions
 *
 * These indexes optimize:
 * - The evaluator's rule-cache load predicate (enabled + not soft-deleted)
 * - The default list sort
 */
const ALERT_RULE_V2_INDEXES: IndexDefinition[] = [
  {
    name: 'enabled_deleted_at',
    spec: { enabled: 1, 'audit.deleted_at': 1 } as IndexSpec,
    options: { background: true },
    description:
      'Rule cache load predicate: { enabled: true, audit.deleted_at: { $exists: false } }',
  },
  {
    name: 'audit_created_at_desc',
    spec: { 'audit.created_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Default sort for GET /api/v2/alert-rules',
  },
];

/**
 * AlertV2 Index Definitions
 *
 * The partial unique index is the deduplication mechanism in full — at most one
 * open episode per (rule, device) pair, enforced by MongoDB. It uses an equality
 * predicate on `is_open` (supported since MongoDB 3.2) rather than a status
 * `$in` (which would require 6.0+).
 */
const ALERT_V2_INDEXES: IndexDefinition[] = [
  {
    name: 'rule_device_open_unique',
    spec: { rule_id: 1, device_id: 1 } as IndexSpec,
    options: { unique: true, background: true, partialFilterExpression: { is_open: true } },
    description: 'Partial unique index enforcing one open episode per (rule, device)',
  },
  {
    name: 'rule_device_resolved_at',
    spec: { rule_id: 1, device_id: 1, 'audit.resolved_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Cooldown lookback over resolved episodes',
  },
  {
    name: 'status_created_at',
    spec: { status: 1, 'audit.created_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Active alert list, the default view',
  },
  {
    name: 'device_created_at',
    spec: { device_id: 1, 'audit.created_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Alerts for a single device',
  },
  {
    name: 'severity_status',
    spec: { severity: 1, status: 1 } as IndexSpec,
    options: { background: true },
    description: 'Severity filter on the alert list',
  },
  {
    name: 'is_open_last_observed_at',
    spec: { is_open: 1, last_observed_at: 1 } as IndexSpec,
    options: { background: true },
    description: 'Staleness sweep',
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Render an index's shape for the mismatch report — compact and exact, not pretty. */
function describeShape(shape: {
  fields: Record<string, number>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}): string {
  const parts = [`spec: ${JSON.stringify(shape.fields)}`, `unique: ${Boolean(shape.unique)}`];
  parts.push(
    `partialFilterExpression: ${
      shape.partialFilterExpression ? JSON.stringify(shape.partialFilterExpression) : 'none'
    }`
  );
  return parts.join(', ');
}

/**
 * Create indexes for a collection with logging.
 *
 * When a live index already has the expected name but its shape (keys, `unique`, or
 * `partialFilterExpression`) has drifted from what this script would create, this
 * does NOT drop or modify it. Silently accepting a same-name/different-shape index —
 * or worse, auto-dropping and recreating it — is exactly how a unique index can end
 * up quietly missing its `partialFilterExpression`. Dropping a unique index against
 * production data is not a decision a script should make unattended, so a mismatch
 * is reported loudly and the run is marked as failed instead.
 */
async function createCollectionIndexes(
  collectionName: string,
  indexes: IndexDefinition[]
): Promise<{ success: number; skipped: number; mismatched: number; failed: number }> {
  const collection = mongoose.connection.collection(collectionName);
  const stats = { success: 0, skipped: 0, mismatched: 0, failed: 0 };

  // Get existing indexes, keyed by name, so a name match can be shape-checked below.
  const existingIndexes = await collection.indexes();
  const existingIndexByName = new Map(existingIndexes.map(idx => [idx.name, idx]));

  console.log(`\n📦 Collection: ${collectionName}`);
  console.log(`   Existing indexes: ${existingIndexByName.size}`);
  console.log('─'.repeat(60));

  for (const index of indexes)
    try {
      const existing = existingIndexByName.get(index.name);
      if (existing) {
        const matches = indexShapeMatches(
          {
            key: existing.key as Record<string, number>,
            unique: existing.unique,
            partialFilterExpression: existing.partialFilterExpression as
              | Record<string, unknown>
              | undefined,
          },
          {
            fields: index.spec,
            unique: index.options.unique,
            partialFilterExpression: index.options.partialFilterExpression,
          }
        );

        if (matches) {
          console.log(`   ⏭️  [SKIP] ${index.name} - already exists`);
          stats.skipped++;
          continue;
        }

        console.error(
          `   🛑 [MISMATCH] ${index.name} - existing index shape differs from expected`
        );
        console.error(
          `      Expected: { ${describeShape({
            fields: index.spec,
            unique: index.options.unique,
            partialFilterExpression: index.options.partialFilterExpression,
          })} }`
        );
        console.error(
          `      Actual:   { ${describeShape({
            fields: existing.key as Record<string, number>,
            unique: existing.unique,
            partialFilterExpression: existing.partialFilterExpression as
              | Record<string, unknown>
              | undefined,
          })} }`
        );
        console.error(
          `      Refusing to drop or modify an existing index automatically. If the ` +
            `existing shape is wrong, drop it yourself and re-run this script:`
        );
        console.error(`        db.${collectionName}.dropIndex(${JSON.stringify(index.name)})`);
        console.error(`        pnpm create-indexes-v2`);
        stats.mismatched++;
        continue;
      }

      // Create the index
      const startTime = Date.now();
      // Only include options that are explicitly set
      const indexOptions: Record<string, unknown> = { name: index.name };
      if (index.options.unique !== undefined) indexOptions.unique = index.options.unique;
      if (index.options.sparse !== undefined) indexOptions.sparse = index.options.sparse;
      if (index.options.background !== undefined)
        indexOptions.background = index.options.background;
      if (index.options.partialFilterExpression !== undefined)
        indexOptions.partialFilterExpression = index.options.partialFilterExpression;

      await collection.createIndex(index.spec, indexOptions);
      const duration = Date.now() - startTime;

      console.log(`   ✅ [CREATE] ${index.name} (${duration}ms)`);
      console.log(`      └─ ${index.description}`);
      stats.success++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ [FAIL] ${index.name}: ${errorMessage}`);
      stats.failed++;
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
  indexes.forEach(idx => {
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
    const collectionNames = new Set(collections.map(c => c.name));

    const hasDevicesV2 = collectionNames.has('devices_v2');
    const hasReadingsV2 = collectionNames.has('readings_v2');
    const hasAlertRulesV2 = collectionNames.has('alert_rules_v2');
    const hasAlertsV2 = collectionNames.has('alerts_v2');

    if (!hasDevicesV2)
      console.log(
        '\n⚠️  Collection devices_v2 does not exist yet. Creating indexes will create the collection.'
      );

    if (!hasReadingsV2)
      console.log(
        '\n⚠️  Collection readings_v2 does not exist yet. Creating indexes will create the collection.'
      );

    if (!hasAlertRulesV2)
      console.log(
        '\n⚠️  Collection alert_rules_v2 does not exist yet. Creating indexes will create the collection.'
      );

    if (!hasAlertsV2)
      console.log(
        '\n⚠️  Collection alerts_v2 does not exist yet. Creating indexes will create the collection.'
      );

    // Create indexes for devices_v2
    const deviceStats = await createCollectionIndexes('devices_v2', DEVICE_V2_INDEXES);

    // Create indexes for readings_v2
    const readingStats = await createCollectionIndexes('readings_v2', READING_V2_INDEXES);

    // Create indexes for alert_rules_v2
    const alertRuleStats = await createCollectionIndexes('alert_rules_v2', ALERT_RULE_V2_INDEXES);

    // Create indexes for alerts_v2
    const alertStats = await createCollectionIndexes('alerts_v2', ALERT_V2_INDEXES);

    // Verify indexes
    await verifyIndexes('devices_v2');
    await verifyIndexes('readings_v2');
    await verifyIndexes('alert_rules_v2');
    await verifyIndexes('alerts_v2');

    // Summary
    const totalSuccess =
      deviceStats.success + readingStats.success + alertRuleStats.success + alertStats.success;
    const totalSkipped =
      deviceStats.skipped + readingStats.skipped + alertRuleStats.skipped + alertStats.skipped;
    const totalMismatched =
      deviceStats.mismatched +
      readingStats.mismatched +
      alertRuleStats.mismatched +
      alertStats.mismatched;
    const totalFailed =
      deviceStats.failed + readingStats.failed + alertRuleStats.failed + alertStats.failed;
    const duration = Date.now() - startTime;

    console.log('\n' + '═'.repeat(60));
    console.log('📊 Summary');
    console.log('═'.repeat(60));
    console.log(`   ✅ Created:    ${totalSuccess} indexes`);
    console.log(`   ⏭️  Skipped:    ${totalSkipped} indexes (already existed)`);
    console.log(
      `   🛑 Mismatched: ${totalMismatched} indexes (existing shape differs - see above)`
    );
    console.log(`   ❌ Failed:     ${totalFailed} indexes`);
    console.log(`   ⏱️  Duration: ${duration}ms`);
    console.log('═'.repeat(60));

    if (totalMismatched > 0) {
      console.log(
        '\n⚠️  Some existing indexes do not match their expected shape. This script will ' +
          'not drop or modify them automatically - see the [MISMATCH] entries above for the ' +
          'exact dropIndex command to run before re-running this script.'
      );
      process.exit(1);
    }

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
