import { queryKeys } from '@/lib/query/queryClient';

let capturedUseQueryArgs: Record<string, unknown> | null = null;

jest.mock('@tanstack/react-query', () => ({
  useQuery: (args: Record<string, unknown>) => {
    capturedUseQueryArgs = args;
    return { data: undefined, isLoading: true, isError: false };
  },
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
  QueryClient: jest.fn().mockImplementation(() => ({})),
  keepPreviousData: Symbol('keepPreviousData'),
}));

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    analytics: {
      maintenanceForecast: jest.fn().mockResolvedValue({
        success: true,
        data: { forecasts: [], summary: {} },
      }),
    },
  },
}));

import { v2Api } from '@/lib/api/v2-client';
import { useMaintenanceForecast } from '@/lib/query/hooks/useMaintenanceForecast';

describe('queryKeys.analytics.maintenanceForecast', () => {
  it('should generate key without params', () => {
    const key = queryKeys.analytics.maintenanceForecast();
    expect(key).toEqual(['analytics', 'maintenance-forecast', undefined]);
  });

  it('should generate key with params', () => {
    const key = queryKeys.analytics.maintenanceForecast({ building_id: 'b1', floor: 2 });
    expect(key).toEqual([
      'analytics',
      'maintenance-forecast',
      { building_id: 'b1', floor: 2 },
    ]);
  });

  it('should generate key with empty object', () => {
    const key = queryKeys.analytics.maintenanceForecast({});
    expect(key).toEqual(['analytics', 'maintenance-forecast', {}]);
  });
});

describe('useMaintenanceForecast', () => {
  beforeEach(() => {
    capturedUseQueryArgs = null;
    jest.clearAllMocks();
  });

  it('should call useQuery with correct queryKey for default params', () => {
    useMaintenanceForecast();

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.analytics.maintenanceForecast({} as Record<string, unknown>)
    );
  });

  it('should call useQuery with correct queryKey for custom params', () => {
    useMaintenanceForecast({ building_id: 'main-hq', floor: 5 });

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.analytics.maintenanceForecast({
        building_id: 'main-hq',
        floor: 5,
      } as Record<string, unknown>)
    );
  });

  it('should provide a queryFn that calls v2Api.analytics.maintenanceForecast', async () => {
    const params = { building_id: 'b1' };
    useMaintenanceForecast(params);

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    const result = await queryFn();

    expect(v2Api.analytics.maintenanceForecast).toHaveBeenCalledWith(params);
    expect(result).toEqual({ forecasts: [], summary: {} });
  });

  it('should set staleTime to 2 minutes', () => {
    useMaintenanceForecast();

    expect(capturedUseQueryArgs!.staleTime).toBe(2 * 60 * 1000);
  });

  it('should set gcTime to 5 minutes', () => {
    useMaintenanceForecast();

    expect(capturedUseQueryArgs!.gcTime).toBe(5 * 60 * 1000);
  });

  it('should merge custom config into useQuery options', () => {
    useMaintenanceForecast({}, { enabled: false });

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });

  it('should allow custom config to override staleTime', () => {
    useMaintenanceForecast({}, { staleTime: 5000 });

    expect(capturedUseQueryArgs!.staleTime).toBe(5000);
  });
});
