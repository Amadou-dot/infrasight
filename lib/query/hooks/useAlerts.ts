import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import { useRealtimeConnection } from '@/lib/pusher-context';
import { queryKeys } from '../queryClient';
import type { QueryConfig, MutationConfig } from '../types';
import type { AlertV2Response, ListAlertsQueryParams } from '@/types/v2';

// ============================================================================
// REALTIME FALLBACK
// ============================================================================

/** Poll cadence used only while the Pusher socket is NOT delivering. */
export const REALTIME_FALLBACK_POLL_MS = 30 * 1000;

/**
 * `refetchInterval` for a query whose freshness normally comes from Pusher.
 *
 * Deliberately not an unconditional interval. While the socket is healthy every
 * update already arrives as an event, and a background timer on top of that
 * would put a request per alert surface per 30s on the API for no new
 * information — on a wall display, forever. The interval exists for the case
 * the socket cannot cover: a dropped connection, an unauthorized channel, or a
 * terminal Pusher close code (4004 quota, 4001 bad key) that never
 * auto-reconnects and would otherwise leave a screen reading "No open alerts."
 * indefinitely.
 */
function useRealtimeFallbackInterval(): number | false {
  const { connected } = useRealtimeConnection();
  return connected ? false : REALTIME_FALLBACK_POLL_MS;
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * List alerts.
 *
 * Short staleTime because the set changes on every ingest.
 *
 * How this list stays current: NOTHING patches rows into the cache. There is no
 * `setQueryData` anywhere in this subsystem. Consumers of the Pusher
 * `alert-event` (AlertToaster, TopNav) call `invalidateQueries` and React Query
 * refetches from `/api/v2/alerts`.
 *
 * That makes the invalidations load-bearing. Removing one because the rows
 * "arrive over the socket anyway" is the regression it looks like an
 * optimization: the socket carries the notification, never the row, and the
 * list would then only change when something else happened to invalidate it.
 * `refetchInterval` below is the fallback for when the socket is down, not a
 * substitute for the invalidations.
 */
export function useAlertsList(
  filters: ListAlertsQueryParams = {},
  config?: QueryConfig<AlertV2Response[]>
) {
  const refetchInterval = useRealtimeFallbackInterval();

  return useQuery({
    queryKey: queryKeys.alerts.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.alerts.list(filters);
      return response.data;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval,
    // Spread last so a caller can still override any of the above.
    ...config,
  });
}

export function useAlertDetail(
  id: string,
  options: { include_device?: boolean } = {},
  config?: QueryConfig<AlertV2Response>
) {
  return useQuery({
    queryKey: queryKeys.alerts.detail(id),
    queryFn: async () => {
      const response = await v2Api.alerts.getById(id, options);
      return response.data;
    },
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

/**
 * Count of open alerts, for the nav badge.
 *
 * Reads `pagination.total` off a one-row page rather than counting a fetched
 * array. Counting `data.length` would be wrong twice over: the API caps `limit`
 * at 100 (`lib/validations/common.validation.ts:17`), so a real storm would
 * display a frozen "100"; and TopNav renders on every route, so it would pull
 * 100 full alert documents on every navigation to render one number.
 */
export function useOpenAlertCount(config?: QueryConfig<number>) {
  const refetchInterval = useRealtimeFallbackInterval();

  return useQuery({
    queryKey: queryKeys.alerts.list({ count: true }),
    queryFn: async () => {
      // No `status` filter — the server defaults to open (firing + acknowledged).
      const response = await v2Api.alerts.list({ limit: 1 });
      return response.pagination.total;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    // The nav badge is the one alert surface visible on every route, so a
    // silently dead socket shows here first. See useRealtimeFallbackInterval.
    refetchInterval,
    // Spread last so a caller can still override any of the above.
    ...config,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useAcknowledgeAlert(
  config?: MutationConfig<AlertV2Response, { id: string; note?: string }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const response = await v2Api.alerts.acknowledge(id, note);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
    ...config,
  });
}

export function useResolveAlert(
  config?: MutationConfig<AlertV2Response, { id: string; note?: string }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const response = await v2Api.alerts.resolve(id, note);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
    ...config,
  });
}
