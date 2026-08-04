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
 * `createCollectionIndexes()` must fail this test: the subprocess's stdout
 * would contain "Fatal error during index creation" and `alerts_v2` would
 * still have only its default `_id_` index, never having reached the six
 * AlertV2 `createIndex` calls.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

const execFileAsync = promisify(execFile);

const COLLECTION = 'alerts_v2';
const REPO_ROOT = path.resolve(__dirname, '../../..');

const EXPECTED_ALERT_INDEX_NAMES = [
  '_id_',
  'rule_device_open_unique',
  'rule_device_resolved_at',
  'status_created_at',
  'device_created_at',
  'severity_status',
  'is_open_last_observed_at',
].sort();

/** Drops alerts_v2 entirely, tolerating it already not existing. */
async function ensureCollectionDoesNotExist(name: string): Promise<void> {
  try {
    await mongoose.connection.collection(name).drop();
  } catch (error) {
    // NamespaceNotFound (26): already gone, which is the state this test wants.
    if ((error as { code?: number }).code !== 26) throw error;
  }
}

async function getLiveIndexNames(name: string): Promise<string[]> {
  const indexes = await mongoose.connection.collection(name).listIndexes().toArray();
  return indexes.map(idx => idx.name as string).sort();
}

describe('create-indexes-v2 CLI (subprocess): must not crash when alerts_v2 has never been created', () => {
  it('running the actual script against a database with no alerts_v2 collection creates all six AlertV2 indexes instead of aborting', async () => {
    await ensureCollectionDoesNotExist(COLLECTION);

    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('npx', ['tsx', 'scripts/v2/create-indexes-v2.ts'], {
        cwd: REPO_ROOT,
        env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI },
        timeout: 25000,
      }));
    } catch (error) {
      // The script can still exit non-zero for reasons entirely unrelated to
      // alerts_v2 (e.g. devices_v2/readings_v2/alert_rules_v2 indexes that are
      // also declared directly on their Mongoose schemas, auto-built under
      // different names by whichever test happened to use those models earlier
      // against this shared mongodb-memory-server). What this test verifies is
      // specifically whether alerts_v2 crashed the whole run - checked below
      // via stdout content and, definitively, live index state - not the
      // subprocess's overall exit code.
      stdout = (error as { stdout?: string }).stdout ?? '';
    }

    // The specific crash this test targets: an unhandled NamespaceNotFound
    // aborts the run before it ever reaches alerts_v2's own createIndex calls.
    expect(stdout).not.toContain('Fatal error during index creation');
    expect(stdout).not.toContain('ns does not exist');

    // The real proof: the collection now exists with all six named indexes it
    // never had a chance to get while the script was crashing.
    const indexNames = await getLiveIndexNames(COLLECTION);
    expect(indexNames).toEqual(EXPECTED_ALERT_INDEX_NAMES);
  }, 30000);
});
