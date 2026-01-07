import { useQuery } from '@tanstack/react-query';
import { v2Api, type EnergyAnalyticsQuery } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig } from '../types';

export function useEnergyAnalytics(
  params: EnergyAnalyticsQuery = {},
  config?: QueryConfig<unknown>
) {
  return useQuery({
    queryKey: queryKeys.analytics.energy(params as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.analytics.energy(params);
      return response.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    ...config,
  });
}
