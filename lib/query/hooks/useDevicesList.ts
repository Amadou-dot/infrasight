import { useQuery } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig } from '../types';
import type { ListDevicesQuery, DeviceV2Response } from '@/types/v2';

export function useDevicesList(
  filters: ListDevicesQuery = {},
  config?: QueryConfig<DeviceV2Response[]>
) {
  return useQuery({
    queryKey: queryKeys.devices.list(filters as Record<string, unknown>),
    queryFn: async () => {
      // Fetch all pages if no pagination params provided
      if (!filters.page && !filters.limit) {
        const allDevices: DeviceV2Response[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore && page <= 20) {
          const response = await v2Api.devices.list({ ...filters, limit: 100, page });
          allDevices.push(...response.data);
          hasMore = response.pagination?.hasNext ?? false;
          page++;
        }

        return allDevices;
      }

      // Single page fetch
      const response = await v2Api.devices.list(filters);
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (changes infrequently)
    gcTime: 10 * 60 * 1000, // 10 minutes
    ...config,
  });
}
