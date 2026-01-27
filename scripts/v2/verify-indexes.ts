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

// ============================================================================
// EXPECTED INDEXES
// ============================================================================

interface ExpectedIndex {
  name: string;
  fields: Record<string, number>;
  unique?: boolean;
}

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

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

interface IndexInfo {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
}

async function getCollectionIndexes(collectionName: string): Promise<IndexInfo[]> {
  const collection = mongoose.connection.collection(collectionName);
  const indexes = await collection.listIndexes().toArray();
  return indexes.map(idx => ({
    name: idx.name,
    key: idx.key as Record<string, number>,
    unique: idx.unique,
  }));
}

function formatIndexKey(key: Record<string, number>): string {
  return Object.entries(key)
    .map(([field, order]) => `${field}: ${order}`)
    .join(', ');
}

function checkIndexExists(
  indexes: IndexInfo[],
  expected: { fields: Record<string, number>; unique?: boolean }
): boolean {
  return indexes.some(idx => {
    const fieldsMatch = Object.entries(expected.fields).every(
      ([field, order]) => idx.key[field] === order
    );
    const uniqueMatch = expected.unique ? idx.unique === true : true;
    return fieldsMatch && uniqueMatch;
  });
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
