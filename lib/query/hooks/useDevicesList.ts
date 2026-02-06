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
        // Fetch first page to get total pages
        const firstResponse = await v2Api.devices.list({ ...filters, limit: 100, page: 1 });
        const allDevices: DeviceV2Response[] = [...firstResponse.data];
        const totalPages = Math.min(firstResponse.pagination?.pages ?? 1, 20);

        if (totalPages > 1) {
          // Fetch remaining pages in parallel
          const pagePromises = [];
          for (let p = 2; p <= totalPages; p++) {
            pagePromises.push(v2Api.devices.list({ ...filters, limit: 100, page: p }));
          }
          const results = await Promise.all(pagePromises);
          results.forEach(r => allDevices.push(...r.data));
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
