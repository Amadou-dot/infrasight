/**
 * verify-indexes.ts (the actual CLI, run as a subprocess) must not create the
 * index it is checking for.
 *
 * `verify-indexes-autoindex.integration.test.ts` proves the underlying
 * mechanism — that connecting with autoIndex left at its default builds a
 * shadow index and fools `checkIndexExists`, and that `autoIndex: false`
 * prevents both. That file is deliberately kept as-is; this file exists because
 * proving the mechanism is not the same as proving the shipped script uses it.
 * Those two tests construct their own Mongoose connections with hand-chosen
 * `autoIndex` values — they never import, execute, or otherwise touch
 * `verify-indexes.ts`, so a regression that reverted the fix in that file would
 * not fail either of them.
 *
 * `verify-indexes.ts` cannot be `import`ed to close that gap: it calls
 * `main()` unconditionally at module scope and `main()` calls `process.exit()`,
 * so importing it in-process would kill the Jest worker. Instead this test runs
 * it exactly as `pnpm verify-indexes` does — as a real child process, `npx tsx
 * scripts/v2/verify-indexes.ts`, pointed at the shared mongodb-memory-server via
 * the inherited `MONGODB_URI` — against a database seeded with the catastrophic
 * misconfiguration this whole task targets: a plain unique index on
 * `{rule_id, device_id}` under the real name `rule_device_open_unique`, no
 * `partialFilterExpression`. This is the actual file, actually executed, with
 * no exported seam to route around.
 *
 * Reverting `scripts/v2/verify-indexes.ts`'s `mongoose.connect(uri, { autoIndex:
 * false })` back to `mongoose.connect(uri)` must fail this test: the script
 * would build a correctly-shaped shadow index under an auto-generated name,
 * report success for `rule_device_open_unique`, and leave that index exactly as
 * broken as it was.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

const execFileAsync = promisify(execFile);

const COLLECTION = 'alerts_v2';
const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Resets alerts_v2 to hold exactly one non-_id_ index: the catastrophic
 * misconfiguration this whole task targets.
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

async function getLiveAlertIndexNames(): Promise<string[]> {
  const collection = mongoose.connection.collection(COLLECTION);
  const indexes = await collection.listIndexes().toArray();
  return indexes.map(idx => idx.name as string).sort();
}

/** Strips ANSI color codes so the CLI's colorized ✓/✗ output can be matched with plain text. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('verify-indexes CLI (subprocess): must not create the index it checks for', () => {
  it('running the actual script against a broken dedup index reports failure and creates no shadow index', async () => {
    await seedOnlyTheBrokenDedupIndex();

    const { stdout } = await execFileAsync('npx', ['tsx', 'scripts/v2/verify-indexes.ts'], {
      cwd: REPO_ROOT,
      env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI },
      timeout: 25000,
    });

    const plainOutput = stripAnsi(stdout);
    const alertSection = plainOutput.slice(plainOutput.indexOf('AlertV2 Collection Indexes'));

    // The script must report the broken index as missing/failing...
    expect(alertSection).toContain('✗ rule_device_open_unique');
    expect(alertSection).not.toContain('✓ rule_device_open_unique');

    // ...and must not have silently built the index it was checking for as a
    // side effect of connecting. If this fails, the database has a
    // rule_id_1_device_id_1 (or similarly auto-named) shadow index in it.
    const indexNames = await getLiveAlertIndexNames();
    expect(indexNames).toEqual(['_id_', 'rule_device_open_unique']);
  }, 30000);
});
