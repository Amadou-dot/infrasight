import { useQuery } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import type { FloorPlanDeviceFilters } from '@/types/v2';
import { queryKeys } from '../queryClient';

export function useFloorPlanDevices(
  filters: FloorPlanDeviceFilters,
  { enabled }: { enabled: boolean }
) {
  return useQuery({
    queryKey: queryKeys.devices.list({ ...filters, view: 'floor-plan' }),
    enabled,
    placeholderData: undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const first = await v2Api.devices.listFloorPlan({ filters, page: 1, signal });
      const devices = [...first.data];
      const totalPages = first.pagination?.totalPages ?? 1;
      // Bound large All Buildings requests without silently truncating the fleet.
      for (let page = 2; page <= totalPages; page += 3) {
        signal.throwIfAborted();
        const pages = await Promise.all(
          Array.from({ length: Math.min(3, totalPages - page + 1) }, (_, offset) =>
            v2Api.devices.listFloorPlan({ filters, page: page + offset, signal })
          )
        );
        pages.forEach(result => devices.push(...result.data));
      }
      return devices;
    },
  });
}
