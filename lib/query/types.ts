import type { UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';

/**
 * Helper types for query hooks
 */
export type QueryConfig<TData, TError = Error> = Omit<
  UseQueryOptions<TData, TError>,
  'queryKey' | 'queryFn'
>;

export type MutationConfig<TData, TVariables, TError = Error> = Omit<
  UseMutationOptions<TData, TError, TVariables>,
  'mutationFn'
>;

/** List page plus the server's authoritative total for that filter. */
export interface PagedResult<T> {
  items: T[];
  total: number;
}
