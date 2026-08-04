/**
 * Verify V2 Collection Indexes
 *
 * Lists all indexes on v2 collections and verifies expected indexes exist.
 * Also checks index usage statistics.
 *
 * Usage: npx tsx scripts/v2/verify-indexes.ts
 */

import mongoose from 'mongoose';
import 'dotenv/config';

// Import models to ensure schemas are registered
import '../../models/v2/DeviceV2';
import '../../models/v2/ReadingV2';
import '../../models/v2/AlertRuleV2';
import '../../models/v2/AlertV2';

import { checkIndexExists, type ExpectedIndex, type IndexInfo } from './index-shape';

// ============================================================================
// EXPECTED INDEXES
// ============================================================================

const EXPECTED_DEVICE_INDEXES: ExpectedIndex[] = [
  { name: 'serial_number', fields: { serial_number: 1 }, unique: true },
  { name: 'location', fields: { 'location.building_id': 1, 'location.floor': 1 } },
  { name: 'status', fields: { status: 1 } },
  { name: 'last_seen', fields: { 'health.last_seen': 1 } },
  { name: 'deleted_at', fields: { 'audit.deleted_at': 1 } },
  { name: 'department', fields: { 'metadata.department': 1 } },
  { name: 'manufacturer', fields: { manufacturer: 1 } },
  { name: 'type', fields: { type: 1 } },
  { name: 'status_type', fields: { status: 1, type: 1 } },
];

const EXPECTED_READING_INDEXES: ExpectedIndex[] = [
  // Note: Timeseries collections have automatic indexes on timeField and metaField
  { name: 'device_timestamp', fields: { 'metadata.device_id': 1, timestamp: 1 } },
  { name: 'is_anomaly', fields: { 'quality.is_anomaly': 1 } },
  { name: 'source', fields: { 'metadata.source': 1 } },
];

const EXPECTED_ALERT_RULE_INDEXES: ExpectedIndex[] = [
  { name: 'enabled_deleted_at', fields: { enabled: 1, 'audit.deleted_at': 1 } },
  { name: 'audit_created_at_desc', fields: { 'audit.created_at': -1 } },
];

const EXPECTED_ALERT_INDEXES: ExpectedIndex[] = [
  {
    name: 'rule_device_open_unique',
    fields: { rule_id: 1, device_id: 1 },
    unique: true,
    // The partial filter is the entire dedup mechanism: it is what allows unlimited
    // *resolved* episodes per (rule, device) while permitting only one *open* one.
    // A plain unique index on the same two fields has identical keys and is also
    // unique — without this, the verifier cannot tell them apart, and a plain
    // unique index silently blocks every episode after the first for that pair.
    partialFilterExpression: { is_open: true },
  },
  {
    name: 'rule_device_resolved_at',
    fields: { rule_id: 1, device_id: 1, 'audit.resolved_at': -1 },
  },
  { name: 'status_created_at', fields: { status: 1, 'audit.created_at': -1 } },
  { name: 'device_created_at', fields: { device_id: 1, 'audit.created_at': -1 } },
  { name: 'severity_status', fields: { severity: 1, status: 1 } },
  { name: 'is_open_last_observed_at', fields: { is_open: 1, last_observed_at: 1 } },
];

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

async function getCollectionIndexes(collectionName: string): Promise<IndexInfo[]> {
  const collection = mongoose.connection.collection(collectionName);
  const indexes = await collection.listIndexes().toArray();
  return indexes.map(idx => ({
    name: idx.name,
    key: idx.key as Record<string, number>,
    unique: idx.unique,
    partialFilterExpression: idx.partialFilterExpression as Record<string, unknown> | undefined,
  }));
}

function formatIndexKey(key: Record<string, number>): string {
  return Object.entries(key)
    .map(([field, order]) => `${field}: ${order}`)
    .join(', ');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('Error: MONGODB_URI environment variable is not set');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected successfully\n');

  // ---- DeviceV2 Indexes ----
  console.log('═'.repeat(60));
  console.log(' DeviceV2 Collection Indexes');
  console.log('═'.repeat(60));

  let deviceIndexes: IndexInfo[] = [];
  try {
    deviceIndexes = await getCollectionIndexes('devices_v2');

    console.log('\nCurrent indexes:');
    for (const idx of deviceIndexes) {
      const uniqueStr = idx.unique ? ' (unique)' : '';
      console.log(`  • ${idx.name}${uniqueStr}`);
      console.log(`    Fields: { ${formatIndexKey(idx.key)} }`);
    }

    console.log('\nExpected indexes:');
    let allDeviceIndexesPresent = true;
    for (const expected of EXPECTED_DEVICE_INDEXES) {
      const exists = checkIndexExists(deviceIndexes, expected);
      const status = exists ? '✓' : '✗';
      const color = exists ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(`  ${color}${status}${reset} ${expected.name}`);
      if (!exists) {
        allDeviceIndexesPresent = false;
        console.log(`    Missing: { ${formatIndexKey(expected.fields)} }`);
      }
    }

    if (allDeviceIndexesPresent) console.log('\n  \x1b[32m✓ All expected indexes present\x1b[0m');
    else console.log('\n  \x1b[33m⚠ Some indexes are missing - run create-indexes-v2.ts\x1b[0m');
  } catch (error) {
    console.error('Error checking DeviceV2 indexes:', error);
  }

  // ---- ReadingV2 Indexes ----
  console.log('\n' + '═'.repeat(60));
  console.log(' ReadingV2 Collection Indexes');
  console.log('═'.repeat(60));

  try {
    // Timeseries collections have a system collection name format
    const readingCollectionNames = ['readings_v2', 'system.buckets.readings_v2'];

    let readingIndexes: IndexInfo[] = [];
    for (const collName of readingCollectionNames)
      try {
        const indexes = await getCollectionIndexes(collName);
        readingIndexes = [...readingIndexes, ...indexes];
      } catch {
        // Collection may not exist
      }

    console.log('\nCurrent indexes:');
    if (readingIndexes.length === 0)
      console.log('  No indexes found (collection may not exist yet)');
    else
      for (const idx of readingIndexes) {
        console.log(`  • ${idx.name}`);
        console.log(`    Fields: { ${formatIndexKey(idx.key)} }`);
      }

    console.log('\nExpected indexes:');
    let allReadingIndexesPresent = true;
    for (const expected of EXPECTED_READING_INDEXES) {
      const exists = checkIndexExists(readingIndexes, expected);
      const status = exists ? '✓' : '✗';
      const color = exists ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(`  ${color}${status}${reset} ${expected.name}`);
      if (!exists) {
        allReadingIndexesPresent = false;
        console.log(`    Missing: { ${formatIndexKey(expected.fields)} }`);
      }
    }

    if (allReadingIndexesPresent) console.log('\n  \x1b[32m✓ All expected indexes present\x1b[0m');
    else console.log('\n  \x1b[33m⚠ Some indexes are missing - run create-indexes-v2.ts\x1b[0m');
  } catch (error) {
    console.error('Error checking ReadingV2 indexes:', error);
  }

  // ---- AlertRuleV2 Indexes ----
  console.log('\n' + '═'.repeat(60));
  console.log(' AlertRuleV2 Collection Indexes');
  console.log('═'.repeat(60));

  try {
    const alertRuleIndexes = await getCollectionIndexes('alert_rules_v2');

    console.log('\nCurrent indexes:');
    for (const idx of alertRuleIndexes) {
      const uniqueStr = idx.unique ? ' (unique)' : '';
      console.log(`  • ${idx.name}${uniqueStr}`);
      console.log(`    Fields: { ${formatIndexKey(idx.key)} }`);
    }

    console.log('\nExpected indexes:');
    let allAlertRuleIndexesPresent = true;
    for (const expected of EXPECTED_ALERT_RULE_INDEXES) {
      const exists = checkIndexExists(alertRuleIndexes, expected);
      const status = exists ? '✓' : '✗';
      const color = exists ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(`  ${color}${status}${reset} ${expected.name}`);
      if (!exists) {
        allAlertRuleIndexesPresent = false;
        console.log(`    Missing: { ${formatIndexKey(expected.fields)} }`);
      }
    }

    if (allAlertRuleIndexesPresent)
      console.log('\n  \x1b[32m✓ All expected indexes present\x1b[0m');
    else console.log('\n  \x1b[33m⚠ Some indexes are missing - run create-indexes-v2.ts\x1b[0m');
  } catch (error) {
    console.error('Error checking AlertRuleV2 indexes:', error);
  }

  // ---- AlertV2 Indexes ----
  console.log('\n' + '═'.repeat(60));
  console.log(' AlertV2 Collection Indexes');
  console.log('═'.repeat(60));

  try {
    const alertIndexes = await getCollectionIndexes('alerts_v2');

    console.log('\nCurrent indexes:');
    for (const idx of alertIndexes) {
      const uniqueStr = idx.unique ? ' (unique)' : '';
      console.log(`  • ${idx.name}${uniqueStr}`);
      console.log(`    Fields: { ${formatIndexKey(idx.key)} }`);
    }

    console.log('\nExpected indexes:');
    let allAlertIndexesPresent = true;
    for (const expected of EXPECTED_ALERT_INDEXES) {
      const exists = checkIndexExists(alertIndexes, expected);
      const status = exists ? '✓' : '✗';
      const color = exists ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(`  ${color}${status}${reset} ${expected.name}`);
      if (!exists) {
        allAlertIndexesPresent = false;
        console.log(`    Missing: { ${formatIndexKey(expected.fields)} }`);
      }
    }

    if (allAlertIndexesPresent) console.log('\n  \x1b[32m✓ All expected indexes present\x1b[0m');
    else console.log('\n  \x1b[33m⚠ Some indexes are missing - run create-indexes-v2.ts\x1b[0m');
  } catch (error) {
    console.error('Error checking AlertV2 indexes:', error);
  }

  // ---- Collection Stats ----
  console.log('\n' + '═'.repeat(60));
  console.log(' Collection Statistics');
  console.log('═'.repeat(60));

  try {
    const db = mongoose.connection.db;
    if (db) {
      const deviceCount = await db.collection('devices_v2').estimatedDocumentCount();
      console.log('\ndevices_v2:');
      console.log(`  Documents: ${deviceCount.toLocaleString()}`);
    }
  } catch {
    console.log('\ndevices_v2: Collection does not exist or is empty');
  }

  try {
    const db = mongoose.connection.db;
    if (db) {
      const readingCount = await db.collection('readings_v2').estimatedDocumentCount();
      console.log('\nreadings_v2:');
      console.log(`  Documents: ${readingCount.toLocaleString()}`);
    }
  } catch {
    console.log('\nreadings_v2: Collection does not exist or is empty');
  }

  try {
    const db = mongoose.connection.db;
    if (db) {
      const alertRuleCount = await db.collection('alert_rules_v2').estimatedDocumentCount();
      console.log('\nalert_rules_v2:');
      console.log(`  Documents: ${alertRuleCount.toLocaleString()}`);
    }
  } catch {
    console.log('\nalert_rules_v2: Collection does not exist or is empty');
  }

  try {
    const db = mongoose.connection.db;
    if (db) {
      const alertCount = await db.collection('alerts_v2').estimatedDocumentCount();
      console.log('\nalerts_v2:');
      console.log(`  Documents: ${alertCount.toLocaleString()}`);
    }
  } catch {
    console.log('\nalerts_v2: Collection does not exist or is empty');
  }

  console.log('\n' + '═'.repeat(60));
  console.log(' Done');
  console.log('═'.repeat(60));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
