/**
 * create-indexes-v2.ts (the actual CLI, run as a subprocess) must not crash
 * when a target collection has never been created.
 *
 * `alerts_v2` only comes into existence once an alert episode has actually
 * fired — the normal state of a fresh database, since the seed deliberately
 * never touches `alerts_v2` (see `scripts/v2/seed-v2.ts`). Before this fix,
 * `createCollectionIndexes()`'s first operation was an unguarded
 * `collection.indexes()`, which MongoDB answers with `NamespaceNotFound` for a
 * collection that has never been created. That aborted the whole script
 * (exit 1) before it ever reached `alerts_v2`'s own `createIndex` calls —
 * which is exactly what would have created the collection and its indexes.
 * Since `create-indexes-v2.ts` imports no model files, nothing in its own
 * process can auto-vivify `alerts_v2` ahead of that call, so the crash was
 * fully deterministic on a fresh database, not a race.
 *
 * `create-indexes-v2.ts` cannot be `import`ed to close that gap in-process:
 * like `verify-indexes.ts`, it calls its main function unconditionally at
 * module scope, and that function calls `process.exit()` on several paths, so
 * importing it would kill the Jest worker. Instead this test runs it exactly
 * as `pnpm create-indexes-v2` does — a real child process, `npx tsx
 * scripts/v2/create-indexes-v2.ts`, pointed at the shared
 * mongodb-memory-server via the inherited `MONGODB_URI` — against a database
 * where `alerts_v2` has been dropped so it genuinely does not exist, the
 * exact scenario this bug targets.
 *
 * Reverting the try/catch around `collection.indexes()` in
 * `createCollectionIndexes()` must fail this test: `alerts_v2` would still
 * have only its default `_id_` index, never having reached the six AlertV2
 * `createIndex` calls - proven below via live index state, not stdout/stderr
 * text or the subprocess's exit code.
 *
 * This file also covers a second, related bug (fix round 2): every index this
 * script wants to create is ALSO declared directly on its Mongoose schema via
 * an unnamed `Schema.index({...})` call, so Mongoose's `autoIndex` (the
 * default — `lib/db.ts`'s `dbConnect()` does not disable it, and neither does
 * `pnpm seed`'s plain `mongoose.connect()`) builds each one under MongoDB's
 * own generated name the first time that model initializes, before this
 * script ever runs. MongoDB then refuses this script's attempt at the
 * identical key pattern under its own custom name outright, which the
 * no-name-match code path caught and reported as a bare `[FAIL]` — even
 * though the auto-built index is perfectly correct, just differently named.
 * The fix scans ALL existing indexes (not just the name-matched one) for a
 * full shape match — key pattern, `unique`, and `partialFilterExpression`, all
 * exact — before attempting to create, and treats that as `[SKIP]`. The
 * danger such a fix must not introduce: a plain unique index on
 * `{rule_id, device_id}` has the identical key pattern to the alert dedup
 * index but lacks its `partialFilterExpression`, silently permitting only one
 * alert document ever per (rule, device) pair — that must still be reported
 * as loudly as a same-name mismatch, never accepted as a skip just because
 * its name happens to differ too.
 *
 * A note on this file's own test isolation: importing `@/models/v2/AlertV2`
 * below (needed to reproduce a real autoIndex build) registers that schema on
 * the shared default mongoose connection used by every test in this Jest
 * project, which independently races to auto-build the same six indexes in
 * the background. That race is real and not fully controllable from a test —
 * so the first test below deliberately verifies by SHAPE (do all six expected
 * shapes exist, six indexes total), not by exact name, since which of "this
 * subprocess" or "the shared connection's own background autoIndex" wins the
 * naming race for any given index is exactly the non-determinism the fix
 * exists to tolerate correctly rather than to eliminate.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import AlertV2 from '@/models/v2/AlertV2';
import { checkIndexExists, type IndexInfo } from '@/scripts/v2/index-shape';

const execFileAsync = promisify(execFile);

const COLLECTION = 'alerts_v2';
const REPO_ROOT = path.resolve(__dirname, '../../..');

// Mirrors ALERT_V2_INDEXES in scripts/v2/create-indexes-v2.ts exactly.
const EXPECTED_ALERT_SHAPES: {
  fields: Record<string, number>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}[] = [
  { fields: { rule_id: 1, device_id: 1 }, unique: true, partialFilterExpression: { is_open: true } },
  { fields: { rule_id: 1, device_id: 1, 'audit.resolved_at': -1 } },
  { fields: { status: 1, 'audit.created_at': -1 } },
  { fields: { device_id: 1, 'audit.created_at': -1 } },
  { fields: { severity: 1, status: 1 } },
  { fields: { is_open: 1, last_observed_at: 1 } },
];

/** Drops alerts_v2 entirely, tolerating it already not existing. */
async function ensureCollectionDoesNotExist(name: string): Promise<void> {
  try {
    await mongoose.connection.collection(name).drop();
  } catch (error) {
    // NamespaceNotFound (26): already gone, which is the state this test wants.
    if ((error as { code?: number }).code !== 26) throw error;
  }
}

async function getLiveIndexInfos(name: string): Promise<IndexInfo[]> {
  const indexes = await mongoose.connection.collection(name).listIndexes().toArray();
  return indexes.map(idx => ({
    name: idx.name as string,
    key: idx.key as Record<string, number>,
    unique: idx.unique as boolean | undefined,
    partialFilterExpression: idx.partialFilterExpression as Record<string, unknown> | undefined,
  }));
}

/**
 * Runs the real CLI as a subprocess and returns stdout and stderr COMBINED
 * into one string, whether the process exits 0 or not.
 *
 * This combination matters: `[SKIP]`/`[CREATE]` go to stdout, but
 * `[MISMATCH]`/`[FAIL]` go to stderr (`console.error`) - a test that only
 * inspects stdout can never observe a mismatch or failure at all, which would
 * make an assertion like `expect(stdout).not.toContain('[MISMATCH] ...')`
 * vacuously true regardless of what the script actually did.
 */
async function runCreateIndexesV2(): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('npx', ['tsx', 'scripts/v2/create-indexes-v2.ts'], {
      cwd: REPO_ROOT,
      env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI },
      timeout: 25000,
    });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    // The script can exit non-zero for reasons entirely unrelated to whatever
    // this test set up on alerts_v2 (e.g. devices_v2/readings_v2/alert_rules_v2
    // indexes auto-built under different names by whichever test happened to
    // use those models earlier against this shared mongodb-memory-server).
    // Every test below scopes its assertions to alerts_v2-specific text
    // (index names unique to this collection's definitions) and to alerts_v2's
    // own live index state, not the process's overall exit code.
    const err = error as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
  }
}

describe('create-indexes-v2 CLI (subprocess): must not crash when alerts_v2 has never been created', () => {
  it('running the actual script against a database with no alerts_v2 collection creates all six AlertV2 indexes instead of aborting', async () => {
    await ensureCollectionDoesNotExist(COLLECTION);

    const output = await runCreateIndexesV2();

    // The specific crash this test targets: an unhandled NamespaceNotFound
    // aborts the run before it ever reaches alerts_v2's own createIndex calls.
    expect(output).not.toContain('Fatal error during index creation');
    expect(output).not.toContain('ns does not exist');

    // The real proof: every one of the six AlertV2 index shapes is now
    // satisfied by some live index, and there are exactly six (not by exact
    // name - see the file header on why that would be flaky here).
    const indexInfos = await getLiveIndexInfos(COLLECTION);
    for (const shape of EXPECTED_ALERT_SHAPES) expect(checkIndexExists(indexInfos, shape)).toBe(true);
    expect(indexInfos.filter(idx => idx.name !== '_id_')).toHaveLength(6);
  }, 30000);
});

describe('create-indexes-v2 CLI (subprocess): a same-shape index under a different name is satisfied, a same-key different-shape index is not', () => {
  it('an index autoIndex already built under a different name, with the identical shape, is skipped rather than reported as a failure', async () => {
    await ensureCollectionDoesNotExist(COLLECTION);

    // Reproduces exactly what happens the first time anything touches the
    // AlertV2 model with Mongoose's default autoIndex (true) - a scoped
    // connection that registers the real schema, mirroring the technique in
    // verify-indexes-autoindex.integration.test.ts. AlertV2Schema declares all
    // six indexes with no explicit name, so this builds all six under
    // MongoDB's own generated names, dedup index included - straight from the
    // schema, so it is correctly shaped (unique + partialFilterExpression).
    const conn = mongoose.createConnection(process.env.MONGODB_URI!);
    try {
      await conn.asPromise();
      const ScopedAlertV2 = conn.model('AlertV2', AlertV2.schema);
      await ScopedAlertV2.init(); // waits for the auto-built indexes to finish
    } finally {
      await conn.close();
    }

    // Confirm the setup actually produced auto-generated names, not this
    // script's own - otherwise this test would exercise the unchanged
    // name-matched branch instead of the new shape-scan branch.
    const beforeInfos = await getLiveIndexInfos(COLLECTION);
    expect(beforeInfos.map(idx => idx.name)).not.toContain('rule_device_open_unique');
    expect(beforeInfos.filter(idx => idx.name !== '_id_')).toHaveLength(6);
    for (const shape of EXPECTED_ALERT_SHAPES) expect(checkIndexExists(beforeInfos, shape)).toBe(true);

    const output = await runCreateIndexesV2();

    // The autoIndex-built dedup index (unique + partialFilterExpression,
    // straight from the schema) must be recognized as already satisfied...
    expect(output).toMatch(/\[SKIP\] rule_device_open_unique - already exists as/);
    // ...and never reported as a failure or mismatch just because its name differs.
    expect(output).not.toContain('[FAIL] rule_device_open_unique');
    expect(output).not.toContain('[MISMATCH] rule_device_open_unique');

    // No duplicate custom-named index was created alongside the shadow - the
    // auto-named one is still the only one satisfying that shape, six total.
    const afterInfos = await getLiveIndexInfos(COLLECTION);
    expect(afterInfos.map(idx => idx.name)).not.toContain('rule_device_open_unique');
    expect(afterInfos.filter(idx => idx.name !== '_id_')).toHaveLength(6);
  }, 30000);

  it('an index with the same key pattern but a different unique/partialFilterExpression shape is still reported as a loud mismatch, never silently skipped', async () => {
    await ensureCollectionDoesNotExist(COLLECTION);

    // The exact danger this guards: a PLAIN unique index on the dedup index's
    // key pattern, missing partialFilterExpression, under a name that matches
    // neither this script's custom name nor a real autoIndex-generated one.
    // This would silently permit only one alert document ever per
    // (rule, device) pair if it were ever accepted as "already satisfied".
    await mongoose.connection
      .collection(COLLECTION)
      .createIndex({ rule_id: 1, device_id: 1 }, { name: 'dangerous_plain_unique', unique: true });

    const output = await runCreateIndexesV2();

    // This is the Critical this test guards: a plain unique index must never
    // be silently accepted as satisfying the partial-unique dedup index.
    expect(output).toContain('[MISMATCH] rule_device_open_unique');
    expect(output).toContain('dangerous_plain_unique');
    expect(output).not.toContain('[SKIP] rule_device_open_unique');

    // The dangerous index must be left exactly as it was: not dropped, not
    // "fixed" in place, and no new index created to sit alongside it under the
    // dedup index's own name - specifically no rule_device_open_unique. The
    // OTHER five alert index definitions have nothing blocking them (this test
    // seeded only the one dangerous index), so they are created normally; the
    // mismatch is scoped to the one index it actually concerns.
    const indexInfos = await getLiveIndexInfos(COLLECTION);
    const indexNames = indexInfos.map(idx => idx.name);
    expect(indexNames).not.toContain('rule_device_open_unique');
    expect(indexNames.sort()).toEqual(
      [
        '_id_',
        'dangerous_plain_unique',
        'rule_device_resolved_at',
        'status_created_at',
        'device_created_at',
        'severity_status',
        'is_open_last_observed_at',
      ].sort()
    );

    const dangerous = indexInfos.find(idx => idx.name === 'dangerous_plain_unique');
    expect(dangerous?.unique).toBe(true);
    expect(dangerous?.partialFilterExpression).toBeUndefined(); // still missing, untouched
  }, 30000);
});
