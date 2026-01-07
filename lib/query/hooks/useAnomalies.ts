import { useQuery } from '@tanstack/react-query';
import { v2Api, type AnomalyResponse } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig } from '../types';

interface UseAnomaliesParams {
  deviceId?: string;
  startDate?: string;
  endDate?: string;
  minScore?: number;
  limit?: number;
}

export function useAnomalies(
  params: UseAnomaliesParams = {},
  config?: QueryConfig<AnomalyResponse>
) {
  return useQuery({
    queryKey: queryKeys.analytics.anomalies(params as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.analytics.anomalies(params);
      return response.data;
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 3 * 60 * 1000, // 3 minutes
    ...config,
  });
}
