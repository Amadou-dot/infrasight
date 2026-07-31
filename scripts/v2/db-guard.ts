/**
 * Guard for destructive database scripts.
 *
 * `pnpm seed` loads `.env.local`, whose `MONGODB_URI` points at the hosted cluster
 * serving the public demo. Without a guard, running the seed script wipes production
 * with no prompt. These helpers make a destructive run against anything other than a
 * local database require an explicit `--force`.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Extract the host from a MongoDB connection string, ignoring any credentials.
 *
 * Returns null when the URI cannot be parsed, so callers can fail closed.
 */
function getHost(uri: string): string | null {
  if (!uri) return null;

  try {
    // Node's URL parser handles arbitrary schemes, including mongodb+srv://. Parsing
    // rather than string-matching means a password containing "localhost" cannot be
    // mistaken for a local host.
    const { hostname } = new URL(uri);
    return hostname || null;
  } catch {
    return null;
  }
}

/**
 * Whether the connection string points at a database on this machine.
 *
 * Fails closed: anything unparseable is treated as remote.
 */
export function isLocalDatabase(uri: string): boolean {
  const host = getHost(uri);
  if (!host) return false;

  return LOCAL_HOSTS.has(host);
}

/**
 * A description of the connection target that is safe to print.
 *
 * Connection strings embed credentials, so only the host is ever surfaced.
 */
export function describeTarget(uri: string): string {
  return getHost(uri) ?? '<unparseable connection string>';
}

/**
 * Throw unless it is safe to destroy the data in the target database.
 *
 * @throws when the target is not local and `force` was not explicitly given.
 */
export function assertSafeToWipe(uri: string, options: { force: boolean }): void {
  if (options.force || isLocalDatabase(uri)) return;

  throw new Error(
    `Refusing to wipe a non-local database.\n\n` +
      `  Target: ${describeTarget(uri)}\n\n` +
      `This script deletes every document in devices_v2 and readings_v2. The host above ` +
      `is not local, so this may be the database serving the live demo.\n\n` +
      `If you are certain, re-run with --force.`
  );
}
