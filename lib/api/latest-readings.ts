import { ApiClientError } from './v2-client';

/** Batch size chosen to keep GET URLs comfortably under proxy limits. */
const BATCH_SIZE = 50;
const CONCURRENCY = 3;

export interface LatestReading {
  _id: string; // device_id
  value: number;
  timestamp: string;
  type: string;
}

export type LatestReadings = Record<string, LatestReading>;

interface FetchLatestReadingsOptions {
  signal?: AbortSignal;
  onBatch?: (readings: LatestReadings) => void;
}

interface LatestReadingsResponse {
  success: boolean;
  data?: { readings: { device_id: string; value: number; timestamp: string; type: string }[] };
  error?: { code?: string; message?: string };
}

/**
 * Latest reading per device, fetched in batches of 50 ids per request so a
 * full-fleet call does not overflow URL length limits.
 */
export async function fetchLatestReadingsBatched(
  deviceIds: string[],
  { signal, onBatch }: FetchLatestReadingsOptions = {}
): Promise<LatestReadings> {
  const ids = [...new Set(deviceIds)];
  const allReadings: LatestReadings = {};
  let nextIndex = 0;
  let stopped = false;

  const worker = async () => {
    while (!stopped && nextIndex < ids.length) {
      signal?.throwIfAborted();
      const batch = ids.slice(nextIndex, nextIndex + BATCH_SIZE);
      nextIndex += BATCH_SIZE;
      const params = new URLSearchParams();
      batch.forEach(id => params.append('device_ids', id));

      try {
        const res = await fetch(`/api/v2/readings/latest?${params.toString()}`, { signal });
        signal?.throwIfAborted();
        const data: LatestReadingsResponse = await res.json();
        signal?.throwIfAborted();
        if (stopped) return;

        if (!res.ok || !data.success || !Array.isArray(data.data?.readings))
          throw new ApiClientError(
            res.status,
            data.error?.code || 'READINGS_FETCH_FAILED',
            data.error?.message || 'Unable to load latest readings'
          );

        const readings: LatestReadings = {};
        for (const reading of data.data.readings)
          readings[reading.device_id] = {
            _id: reading.device_id,
            value: reading.value,
            timestamp: reading.timestamp,
            type: reading.type,
          };

        Object.assign(allReadings, readings);
        onBatch?.(readings);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, Math.ceil(ids.length / BATCH_SIZE)) }, worker)
  );
  return allReadings;
}
