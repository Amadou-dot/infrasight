import type { JSONSerialized } from 'mongoose';
import dbConnect from '@/lib/db';
import { getOrSet } from '@/lib/cache';
import type { ReadCacheScope } from '@/lib/cache/keys';

const DATABASE_DEADLINE_MS = 5_000;

export interface ReadContext extends ReadCacheScope {
  readonly signal: AbortSignal;
}

/** Called after authorization. The v2 collections belong to the deployment. */
export async function createReadContext(
  orgId: string,
  requestSignal: AbortSignal
): Promise<ReadContext> {
  requestSignal.throwIfAborted();
  const { connection } = await dbConnect();
  requestSignal.throwIfAborted();

  // Existing GET routes also run on deployments without an assistant pilot.
  // Identify that database without including credentials in the cache namespace.
  const { srvHost, hosts } = connection.getClient().options;
  const datasetId =
    process.env.ASSISTANT_DATASET_ID?.trim() ||
    JSON.stringify([srvHost ?? hosts.map(host => host.toString()).sort(), connection.name]);
  return { orgId, datasetId, signal: requestSignal };
}

export function readOptions({ signal }: ReadContext) {
  signal.throwIfAborted();
  return {
    maxTimeMS: DATABASE_DEADLINE_MS,
    signal: AbortSignal.any([signal, AbortSignal.timeout(DATABASE_DEADLINE_MS)]),
  };
}

export function fieldProjection(fields?: string[]): Record<string, 1> | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(fields.map(field => [field, 1 as const]));
}

export interface Snapshot<T> {
  data: T;
  computedAt: string | null;
  retrievedAt: string;
}

export async function readCachedSnapshot<T>(
  key: string,
  ttl: number,
  { signal }: ReadContext,
  compute: (asOf: Date) => Promise<T>
): Promise<Snapshot<JSONSerialized<T>>> {
  signal.throwIfAborted();
  const result = await getOrSet(
    key,
    async () => {
      signal.throwIfAborted();
      const asOf = new Date();
      const data = await compute(asOf);
      signal.throwIfAborted();
      // First reads and Redis hits must expose the same JSON dates and BSON IDs.
      const serialized: JSONSerialized<T> = JSON.parse(JSON.stringify(data));
      return { data: serialized, computedAt: asOf.toISOString() };
    },
    { ttl }
  );
  signal.throwIfAborted();
  return { ...result, retrievedAt: new Date().toISOString() };
}
