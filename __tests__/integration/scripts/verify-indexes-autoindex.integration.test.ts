/**
 * verify-indexes.ts must not create the index it is checking for.
 *
 * `verify-indexes.ts` imports every v2 model to register their schemas
 * (`import '../../models/v2/AlertV2'`, etc.), then connects with Mongoose.
 * AlertV2's dedup index is declared on the schema with no explicit name
 * (`AlertV2Schema.index({ rule_id: 1, device_id: 1 }, { unique: true,
 * partialFilterExpression: { is_open: true } })`), so if Mongoose's `autoIndex`
 * is left at its default (`true`), connecting builds that index under an
 * auto-generated name (`rule_id_1_device_id_1`) alongside whatever is already on
 * disk. `checkIndexExists` is name-agnostic — it asks "does *some* index satisfy
 * this shape" — so in exactly the catastrophic scenario Task 7 targets (a plain,
 * non-partial unique index already sitting under the name
 * `rule_device_open_unique`), connecting would cause the script to build the
 * correctly-shaped index it was about to look for, then report success having
 * verified its own handiwork. The broken, differently-named index — the one
 * MongoDB is actually enforcing on every write — is left exactly as broken as it
 * was, silently.
 *
 * The fix is to connect with `autoIndex: false`, so the script observes the
 * database as it actually is instead of as connecting to it would leave it.
 *
 * This test proves the mechanism directly against a real MongoDB (the shared
 * mongodb-memory-server instance; see __tests__/setup/globalSetup.ts) rather than
 * asserting on connection options: it seeds the exact broken index, opens a
 * connection exactly as verify-indexes.ts's pre-fix code did (schema registered,
 * autoIndex left at its default), and shows both that a shadow index gets built
 * AND that checkIndexExists is fooled by it — then repeats with autoIndex: false
 * and shows neither happens.
 *
 * Note on timing: manually driving the real `verify-indexes.ts` CLI against a
 * live database (see the task report) showed this bug is actually RACY — the
 * script's own `mongoose.connect(uri)` call resolves as soon as the socket is up,
 * not once Mongoose's background autoIndex build finishes, so a single run can
 * get lucky and read the collection before the shadow index lands. This test does
 * not rely on that race: it explicitly awaits `Model.init()`, Mongoose's own
 * documented way to wait for a model's index build to finish, which is what makes
 * the "before" case below deterministic instead of intermittent — the shadow
 * index is real either way, whether or not any particular run happens to observe
 * it before it lands.
 */

import mongoose from 'mongoose';
import AlertV2 from '@/models/v2/AlertV2';
import { checkIndexExists, type IndexInfo } from '@/scripts/v2/index-shape';

const COLLECTION = 'alerts_v2';

// The exact expectation verify-indexes.ts declares for the AlertV2 dedup index
// (EXPECTED_ALERT_INDEXES's rule_device_open_unique entry).
const RULE_DEVICE_OPEN_UNIQUE_EXPECTATION = {
  fields: { rule_id: 1, device_id: 1 },
  unique: true,
  partialFilterExpression: { is_open: true },
};

/**
 * Resets alerts_v2 to hold exactly one non-_id_ index: the catastrophic
 * misconfiguration this whole task targets — a PLAIN unique index on
 * {rule_id, device_id}, no partialFilterExpression, under the real index's name.
 */
async function seedOnlyTheBrokenDedupIndex(): Promise<void> {
  const collection = mongoose.connection.collection(COLLECTION);
  const existing = await collection.indexes().catch(() => []);
  for (const idx of existing) if (idx.name !== '_id_') await collection.dropIndex(idx.name!);

  await collection.createIndex(
    { rule_id: 1, device_id: 1 },
    { name: 'rule_device_open_unique', unique: true }
  );
}

async function getLiveAlertIndexes(): Promise<IndexInfo[]> {
  const collection = mongoose.connection.collection(COLLECTION);
  const indexes = await collection.listIndexes().toArray();
  return indexes.map(idx => ({
    name: idx.name,
    key: idx.key as Record<string, number>,
    unique: idx.unique,
    partialFilterExpression: idx.partialFilterExpression as Record<string, unknown> | undefined,
  }));
}

describe('verify-indexes: connecting must not create the index it is checking for', () => {
  const openConnections: mongoose.Connection[] = [];

  afterEach(async () => {
    await Promise.all(openConnections.splice(0).map(conn => conn.close()));
  });

  it('[the hole, reproduced] without autoIndex: false, connecting builds a shadow index and checkIndexExists reports a false success', async () => {
    await seedOnlyTheBrokenDedupIndex();

    // Mirrors exactly what verify-indexes.ts did before this fix: a connection
    // that registers the AlertV2 schema with Mongoose's default autoIndex (true).
    const conn = mongoose.createConnection(process.env.MONGODB_URI!);
    openConnections.push(conn);
    await conn.asPromise();
    const ScopedAlertV2 = conn.model('AlertV2', AlertV2.schema);
    await ScopedAlertV2.init(); // waits for the (mis-)auto-built indexes to finish

    const liveIndexes = await getLiveAlertIndexes();

    // AlertV2Schema declares six indexes, none with an explicit name, so
    // connecting with autoIndex enabled builds all six under auto-generated
    // names. Find the specific shadow that matches the dedup index's shape —
    // that's the one that fools checkIndexExists below — not just any extra
    // index.
    const shadow = liveIndexes.find(
      idx =>
        idx.name !== 'rule_device_open_unique' &&
        idx.unique === true &&
        idx.partialFilterExpression !== undefined
    );
    expect(shadow).toBeDefined();
    expect(shadow?.name).not.toBe('rule_device_open_unique'); // a different name...
    expect(shadow?.key).toEqual({ rule_id: 1, device_id: 1 }); // ...same key...
    expect(shadow?.partialFilterExpression).toEqual({ is_open: true }); // ...correct filter.

    // The actual danger: checkIndexExists (name-agnostic — "does *some* index
    // satisfy this shape") now reports success...
    expect(checkIndexExists(liveIndexes, RULE_DEVICE_OPEN_UNIQUE_EXPECTATION)).toBe(true);

    // ...while the index MongoDB is actually enforcing under the real name is
    // still exactly as broken as it was. This is the false green.
    const broken = liveIndexes.find(idx => idx.name === 'rule_device_open_unique');
    expect(broken?.partialFilterExpression).toBeUndefined();
  });

  it('[the fix, verified] with autoIndex: false, connecting creates no shadow index and checkIndexExists correctly reports failure', async () => {
    await seedOnlyTheBrokenDedupIndex();

    const conn = mongoose.createConnection(process.env.MONGODB_URI!, { autoIndex: false });
    openConnections.push(conn);
    await conn.asPromise();
    const ScopedAlertV2 = conn.model('AlertV2', AlertV2.schema);
    await ScopedAlertV2.init(); // no index build to wait for; autoIndex is off

    const liveIndexes = await getLiveAlertIndexes();

    // The database was only observed, not mutated: still just _id_ and the
    // deliberately broken index, nothing else.
    expect(liveIndexes.map(idx => idx.name).sort()).toEqual(['_id_', 'rule_device_open_unique']);

    // checkIndexExists now correctly reports failure, because there is genuinely
    // nothing in the database that satisfies the expected shape.
    expect(checkIndexExists(liveIndexes, RULE_DEVICE_OPEN_UNIQUE_EXPECTATION)).toBe(false);
  });
});
