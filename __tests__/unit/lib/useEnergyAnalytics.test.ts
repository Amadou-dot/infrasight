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
      energy: jest.fn().mockResolvedValue({ success: true, data: { total: 1000 } }),
    },
  },
}));

import { v2Api } from '@/lib/api/v2-client';
import { useEnergyAnalytics } from '@/lib/query/hooks/useEnergyAnalytics';

describe('queryKeys.analytics.energy', () => {
  it('should generate key without params', () => {
    const key = queryKeys.analytics.energy();
    expect(key).toEqual(['analytics', 'energy', undefined]);
  });

  it('should generate key with params', () => {
    const key = queryKeys.analytics.energy({ aggregation: 'sum', granularity: 'hour' });
    expect(key).toEqual(['analytics', 'energy', { aggregation: 'sum', granularity: 'hour' }]);
  });

  it('should generate key with empty object', () => {
    const key = queryKeys.analytics.energy({});
    expect(key).toEqual(['analytics', 'energy', {}]);
  });
});

describe('useEnergyAnalytics', () => {
  beforeEach(() => {
    capturedUseQueryArgs = null;
    jest.clearAllMocks();
  });

  it('should call useQuery with correct queryKey for default params', () => {
    useEnergyAnalytics();

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.analytics.energy({} as Record<string, unknown>)
    );
  });

  it('should call useQuery with correct queryKey for custom params', () => {
    useEnergyAnalytics({ aggregation: 'avg', device_id: 'device_001' });

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.analytics.energy({
        aggregation: 'avg',
        device_id: 'device_001',
      } as Record<string, unknown>)
    );
  });

  it('should provide a queryFn that calls v2Api.analytics.energy', async () => {
    const params = { aggregation: 'sum' as const, granularity: 'hour' as const };
    useEnergyAnalytics(params);

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    const result = await queryFn();

    expect(v2Api.analytics.energy).toHaveBeenCalledWith(params);
    expect(result).toEqual({ total: 1000 });
  });

  it('should set staleTime to 2 minutes', () => {
    useEnergyAnalytics();

    expect(capturedUseQueryArgs!.staleTime).toBe(2 * 60 * 1000);
  });

  it('should set gcTime to 5 minutes', () => {
    useEnergyAnalytics();

    expect(capturedUseQueryArgs!.gcTime).toBe(5 * 60 * 1000);
  });

  it('should merge custom config into useQuery options', () => {
    useEnergyAnalytics({}, { enabled: false });

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });

  it('should allow custom config to override staleTime', () => {
    useEnergyAnalytics({}, { staleTime: 30000 });

    expect(capturedUseQueryArgs!.staleTime).toBe(30000);
  });
});
