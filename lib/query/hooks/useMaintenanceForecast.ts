import { useQuery } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig } from '../types';
import type { MaintenanceForecastQuery, MaintenanceForecastResponse } from '@/types/v2';

export function useMaintenanceForecast(
  params: MaintenanceForecastQuery = {},
  config?: QueryConfig<MaintenanceForecastResponse>
) {
  return useQuery({
    queryKey: queryKeys.analytics.maintenanceForecast(params as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.analytics.maintenanceForecast(params);
      return response.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    ...config,
  });
}
