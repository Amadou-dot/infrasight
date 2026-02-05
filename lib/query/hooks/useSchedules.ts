import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig, MutationConfig } from '../types';
import type {
  ScheduleV2Response,
  ListSchedulesQuery,
  CreateScheduleInput,
  UpdateScheduleInput,
  BulkCreateScheduleResponse,
} from '@/types/v2';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Hook to fetch a list of schedules with optional filters
 */
export function useSchedulesList(
  filters: ListSchedulesQuery = {},
  config?: QueryConfig<ScheduleV2Response[]>
) {
  return useQuery({
    queryKey: queryKeys.schedules.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.schedules.list(filters);
      return response.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes (schedules change more frequently)
    gcTime: 5 * 60 * 1000, // 5 minutes
    ...config,
  });
}

/**
 * Hook to fetch a single schedule by ID
 */
export function useScheduleDetail(
  id: string,
  options: { include_device?: boolean } = {},
  config?: QueryConfig<ScheduleV2Response>
) {
  return useQuery({
    queryKey: queryKeys.schedules.detail(id),
    queryFn: async () => {
      const response = await v2Api.schedules.getById(id, options);
      return response.data;
    },
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Hook to create new schedule(s)
 */
export function useCreateSchedule(
  config?: MutationConfig<BulkCreateScheduleResponse, CreateScheduleInput>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateScheduleInput) => {
      const response = await v2Api.schedules.create(data);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate schedules list to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
    },
    ...config,
  });
}

/**
 * Hook to update a schedule
 */
export function useUpdateSchedule(
  config?: MutationConfig<ScheduleV2Response, { id: string; data: UpdateScheduleInput }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateScheduleInput }) => {
      const response = await v2Api.schedules.update(id, data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      // Invalidate specific schedule and list
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
    },
    ...config,
  });
}

/**
 * Hook to mark a schedule as completed
 */
export function useCompleteSchedule(
  config?: MutationConfig<ScheduleV2Response, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await v2Api.schedules.complete(id);
      return response.data;
    },
    onSuccess: (_, id) => {
      // Invalidate specific schedule and list
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
    },
    ...config,
  });
}

/**
 * Hook to cancel a schedule
 */
export function useCancelSchedule(
  config?: MutationConfig<{ _id: string; cancelled: boolean; cancelled_at?: string }, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await v2Api.schedules.cancel(id);
      return response.data;
    },
    onSuccess: (_, id) => {
      // Invalidate specific schedule and list
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
    },
    ...config,
  });
}
