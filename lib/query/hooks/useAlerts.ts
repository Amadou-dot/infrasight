import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig, MutationConfig } from '../types';
import type { AlertV2Response, ListAlertsQueryParams } from '@/types/v2';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * List alerts. Short staleTime: the list changes on every ingest and is patched
 * live by usePusherAlerts, so React Query is the fallback rather than the driver.
 */
export function useAlertsList(
  filters: ListAlertsQueryParams = {},
  config?: QueryConfig<AlertV2Response[]>
) {
  return useQuery({
    queryKey: queryKeys.alerts.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.alerts.list(filters);
      return response.data;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
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
  return useQuery({
    queryKey: queryKeys.alerts.list({ count: true }),
    queryFn: async () => {
      // No `status` filter — the server defaults to open (firing + acknowledged).
      const response = await v2Api.alerts.list({ limit: 1 });
      return response.pagination.total;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
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
