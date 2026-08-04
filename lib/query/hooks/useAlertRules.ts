import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig, MutationConfig } from '../types';
import type {
  AlertRuleV2Response,
  ListAlertRulesQueryParams,
  CreateAlertRuleBody,
  UpdateAlertRuleBody,
} from '@/types/v2';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * List alert rules. Long staleTime: rules are admin-authored configuration
 * that changes almost never, unlike alerts which change on every ingest.
 */
export function useAlertRulesList(
  filters: ListAlertRulesQueryParams = {},
  config?: QueryConfig<AlertRuleV2Response[]>
) {
  return useQuery({
    queryKey: queryKeys.alertRules.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.alertRules.list(filters);
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

export function useAlertRuleDetail(id: string, config?: QueryConfig<AlertRuleV2Response>) {
  return useQuery({
    queryKey: queryKeys.alertRules.detail(id),
    queryFn: async () => {
      const response = await v2Api.alertRules.getById(id);
      return response.data;
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateAlertRule(
  config?: MutationConfig<AlertRuleV2Response, CreateAlertRuleBody>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAlertRuleBody) => {
      const response = await v2Api.alertRules.create(data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alertRules.all });
    },
    ...config,
  });
}

export function useUpdateAlertRule(
  config?: MutationConfig<AlertRuleV2Response, { id: string; data: UpdateAlertRuleBody }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAlertRuleBody }) => {
      const response = await v2Api.alertRules.update(id, data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alertRules.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.alertRules.all });
    },
    ...config,
  });
}

export function useDeleteAlertRule(
  config?: MutationConfig<{ _id: string; deleted: boolean; deleted_at?: string }, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await v2Api.alertRules.delete(id);
      return response.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alertRules.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.alertRules.all });
    },
    ...config,
  });
}
