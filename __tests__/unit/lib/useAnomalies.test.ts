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
      anomalies: jest.fn().mockResolvedValue({
        success: true,
        data: { anomalies: [], total: 0 },
      }),
    },
  },
}));

import { v2Api } from '@/lib/api/v2-client';
import { useAnomalies } from '@/lib/query/hooks/useAnomalies';

describe('queryKeys.analytics.anomalies', () => {
  it('should generate key without params', () => {
    const key = queryKeys.analytics.anomalies();
    expect(key).toEqual(['analytics', 'anomalies', undefined]);
  });

  it('should generate key with params', () => {
    const key = queryKeys.analytics.anomalies({ minScore: 0.7, deviceId: 'device_001' });
    expect(key).toEqual([
      'analytics',
      'anomalies',
      { minScore: 0.7, deviceId: 'device_001' },
    ]);
  });

  it('should generate key with empty object', () => {
    const key = queryKeys.analytics.anomalies({});
    expect(key).toEqual(['analytics', 'anomalies', {}]);
  });
});

describe('useAnomalies', () => {
  beforeEach(() => {
    capturedUseQueryArgs = null;
    jest.clearAllMocks();
  });

  it('should call useQuery with correct queryKey for default params', () => {
    useAnomalies();

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.analytics.anomalies({} as Record<string, unknown>)
    );
  });

  it('should call useQuery with correct queryKey for custom params', () => {
    useAnomalies({ minScore: 0.8, deviceId: 'device_005', limit: 50 });

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.analytics.anomalies({
        minScore: 0.8,
        deviceId: 'device_005',
        limit: 50,
      } as Record<string, unknown>)
    );
  });

  it('should call useQuery with correct queryKey for date range params', () => {
    useAnomalies({ startDate: '2025-01-01', endDate: '2025-01-31' });

    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.analytics.anomalies({
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      } as Record<string, unknown>)
    );
  });

  it('should provide a queryFn that calls v2Api.analytics.anomalies', async () => {
    const params = { minScore: 0.7, limit: 25 };
    useAnomalies(params);

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    const result = await queryFn();

    expect(v2Api.analytics.anomalies).toHaveBeenCalledWith(params);
    expect(result).toEqual({ anomalies: [], total: 0 });
  });

  it('should set staleTime to 1 minute', () => {
    useAnomalies();

    expect(capturedUseQueryArgs!.staleTime).toBe(60 * 1000);
  });

  it('should set gcTime to 3 minutes', () => {
    useAnomalies();

    expect(capturedUseQueryArgs!.gcTime).toBe(3 * 60 * 1000);
  });

  it('should merge custom config into useQuery options', () => {
    useAnomalies({}, { enabled: false });

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });

  it('should allow custom config to override staleTime', () => {
    useAnomalies({}, { staleTime: 10000 });

    expect(capturedUseQueryArgs!.staleTime).toBe(10000);
  });
});
