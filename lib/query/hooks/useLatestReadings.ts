import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLatestReadingsBatched, type LatestReadings } from '@/lib/api/latest-readings';
import { usePusherReadings, type PusherReading } from '@/lib/pusher-context';
import { queryKeys } from '../queryClient';

type Snapshot = {
  readings: LatestReadings;
} & ({ state: 'complete'; completedAt: number } | { state: 'partial' | 'failed' });

const EMPTY_READINGS: LatestReadings = {};
const FRESH_MS = 10_000;

function mergeReadings({
  current = EMPTY_READINGS,
  incoming,
}: {
  current?: LatestReadings;
  incoming: LatestReadings;
}): LatestReadings {
  const merged = { ...current };
  for (const [id, reading] of Object.entries(incoming))
    if (!merged[id] || Date.parse(reading.timestamp) > Date.parse(merged[id].timestamp))
      merged[id] = reading;
  return merged;
}

export function useLatestReadings(deviceIds: string[]) {
  const client = useQueryClient();
  // Selections have independent request/freshness state, but a device has one
  // timestamp history. Observe this cache while the page is open to retain it.
  const values = useQuery<LatestReadings>({
    queryKey: queryKeys.readings.values,
    enabled: false,
    initialData: EMPTY_READINGS,
    gcTime: 5 * 60 * 1000,
  });
  const remember = useCallback(
    (incoming: LatestReadings) => {
      client.setQueryData<LatestReadings>(queryKeys.readings.values, current =>
        mergeReadings({ current, incoming })
      );
    },
    [client]
  );
  const ids = useMemo(() => [...new Set(deviceIds)].sort(), [deviceIds]);
  const selectedIds = useMemo(() => new Set(ids), [ids]);
  const queryKey = useMemo(() => queryKeys.readings.latest({ device_ids: ids }), [ids]);
  const query = useQuery<Snapshot>({
    queryKey,
    enabled: ids.length > 0,
    placeholderData: undefined,
    gcTime: 5 * 60 * 1000,
    staleTime: query => {
      const completedAt = query.state.data?.state === 'complete' ? query.state.data.completedAt : 0;
      return completedAt ? Math.max(0, completedAt + FRESH_MS - query.state.dataUpdatedAt) : 0;
    },
    queryFn: async ({ signal }): Promise<Snapshot> => {
      try {
        const readings = await fetchLatestReadingsBatched(ids, {
          signal,
          onBatch: incoming => {
            remember(incoming);
            client.setQueryData<Snapshot>(queryKey, previous => ({
              readings: mergeReadings({ current: previous?.readings, incoming }),
              state: 'partial',
            }));
          },
        });
        signal.throwIfAborted();
        return { readings, state: 'complete', completedAt: Date.now() };
      } catch (error) {
        if (!signal.aborted)
          client.setQueryData<Snapshot>(queryKey, previous => ({
            readings: previous?.readings ?? EMPTY_READINGS,
            state: 'failed',
          }));
        throw error;
      }
    },
    // TanStack calls this for both query completion and setQueryData. Its API
    // erases the generic here; both values belong to this Snapshot-only key.
    structuralSharing: (oldData, newData) => {
      const previous = oldData as Snapshot | undefined;
      const incoming = newData as Snapshot;
      return {
        ...incoming,
        readings: mergeReadings({ current: previous?.readings, incoming: incoming.readings }),
      };
    },
  });

  // Seed from retained snapshots too if the shared cache was collected first.
  useEffect(() => {
    if (query.data) remember(query.data.readings);
  }, [query.data, remember]);

  usePusherReadings(
    useCallback(
      (readings: PusherReading[]) => {
        const incoming: LatestReadings = {};
        for (const reading of readings) {
          const id = reading.metadata.device_id;
          if (!selectedIds.has(id)) continue;
          const candidate = {
            _id: id,
            value: reading.value,
            timestamp: reading.timestamp,
            type: reading.metadata.type,
          };
          if (!incoming[id] || Date.parse(candidate.timestamp) > Date.parse(incoming[id].timestamp))
            incoming[id] = candidate;
        }
        if (Object.keys(incoming).length === 0) return;
        remember(incoming);
        client.setQueryData<Snapshot>(queryKey, previous => ({
          ...(previous ?? { state: 'partial' }),
          readings: mergeReadings({ current: previous?.readings, incoming }),
        }));
      },
      [client, queryKey, selectedIds, remember]
    )
  );

  const visibleReadings = useMemo(() => {
    const newest = mergeReadings({ current: query.data?.readings, incoming: values.data });
    const visible: LatestReadings = {};
    for (const id of ids) if (newest[id]) visible[id] = newest[id];
    return visible;
  }, [ids, query.data, values.data]);

  return {
    ...query,
    data: visibleReadings,
    isError: query.isError || query.data?.state === 'failed',
  };
}
