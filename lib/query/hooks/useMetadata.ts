import { useQuery } from '@tanstack/react-query';
import { v2Api, type MetadataResponse } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig } from '../types';

export function useMetadata(config?: QueryConfig<MetadataResponse>) {
  return useQuery({
    queryKey: queryKeys.metadata,
    queryFn: async () => {
      const response = await v2Api.metadata.get();
      return response.data;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes (metadata changes infrequently)
    gcTime: 30 * 60 * 1000, // 30 minutes
    ...config,
  });
}
