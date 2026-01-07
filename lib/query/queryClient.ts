import { QueryClient, keepPreviousData } from '@tanstack/react-query';

/**
 * Global QueryClient configuration for consistent caching behavior
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time: How long data is considered fresh (no refetch)
      staleTime: 60 * 1000, // 1 minute default

      // Cache time: How long unused data stays in cache
      gcTime: 5 * 60 * 1000, // 5 minutes (renamed from cacheTime in v5)

      // Retry failed requests
      retry: 2,
      retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Refetch behavior
      refetchOnWindowFocus: false, // Don't refetch on tab focus (Pusher handles updates)
      refetchOnReconnect: true, // Refetch when network reconnects
      refetchOnMount: true, // Refetch on component mount if stale

      // Use previous data while refetching (prevents skeleton flicker)
      placeholderData: keepPreviousData,
    },
    mutations: {
      retry: 1,
    },
  },
});

/**
 * Query key factory for consistent cache keys
 */
export const queryKeys = {
  health: ['analytics', 'health'] as const,
  devices: {
    all: ['devices'] as const,
    list: (filters?: Record<string, unknown>) =>
      ['devices', 'list', filters] as const,
    detail: (id: string) => ['devices', 'detail', id] as const,
  },
  analytics: {
    maintenanceForecast: (params?: Record<string, unknown>) =>
      ['analytics', 'maintenance-forecast', params] as const,
    anomalies: (params?: Record<string, unknown>) =>
      ['analytics', 'anomalies', params] as const,
    energy: (params?: Record<string, unknown>) =>
      ['analytics', 'energy', params] as const,
    temperatureCorrelation: (params?: Record<string, unknown>) =>
      ['analytics', 'temperature-correlation', params] as const,
  },
  readings: {
    latest: (params?: Record<string, unknown>) =>
      ['readings', 'latest', params] as const,
    list: (params?: Record<string, unknown>) =>
      ['readings', 'list', params] as const,
  },
  metadata: ['metadata'] as const,
} as const;
