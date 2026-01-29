import { useQuery, useQueryClient } from '@tanstack/react-query';
import { v2Api, type HealthMetrics } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig } from '../types';

interface UseHealthAnalyticsOptions {
  building_id?: string;
  floor?: number;
  department?: string;
}

export function useHealthAnalytics(
  options: UseHealthAnalyticsOptions = {},
  config?: QueryConfig<HealthMetrics>
) {
  return useQuery({
    queryKey: queryKeys.health(options as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.analytics.health(options);
      return response.data;
    },
    staleTime: 60 * 1000, // 1 minute (needs to be fairly fresh)
    gcTime: 3 * 60 * 1000, // 3 minutes
    ...config,
  });
}

/**
 * Invalidate health cache (call after device updates)
 */
export function useInvalidateHealth() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.health() });
}
