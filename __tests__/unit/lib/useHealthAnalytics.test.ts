/**
 * useHealthAnalytics Hook Tests
 *
 * Tests for the health analytics React Query hook, covering:
 * - Query key generation with typed options (fix in 927c35f)
 * - Hook passes correct queryKey, queryFn, and config to useQuery
 * - useInvalidateHealth returns an invalidation function
 */

import { queryKeys } from '@/lib/query/queryClient';

// Track what useQuery receives
let capturedUseQueryArgs: Record<string, unknown> | null = null;
const mockInvalidateQueries = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useQuery: (args: Record<string, unknown>) => {
    capturedUseQueryArgs = args;
    return { data: undefined, isLoading: true, isError: false };
  },
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
  QueryClient: jest.fn().mockImplementation(() => ({})),
  keepPreviousData: Symbol('keepPreviousData'),
}));

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    analytics: {
      health: jest.fn().mockResolvedValue({ success: true, data: {} }),
    },
  },
}));

import { v2Api } from '@/lib/api/v2-client';
import { useHealthAnalytics, useInvalidateHealth } from '@/lib/query/hooks/useHealthAnalytics';

describe('queryKeys.health', () => {
  it('should generate key without params', () => {
    const key = queryKeys.health();
    expect(key).toEqual(['analytics', 'health', undefined]);
  });

  it('should generate key with params', () => {
    const key = queryKeys.health({ floor: 1, building_id: 'b1' });
    expect(key).toEqual(['analytics', 'health', { floor: 1, building_id: 'b1' }]);
  });

  it('should generate key with empty object', () => {
    const key = queryKeys.health({});
    expect(key).toEqual(['analytics', 'health', {}]);
  });

  it('should accept typed options cast to Record<string, unknown>', () => {
    // This is the exact pattern from the fix (927c35f) — typed interface cast
    const options: { building_id?: string; floor?: number; department?: string } = {
      floor: 2,
      department: 'engineering',
    };
    const key = queryKeys.health(options as Record<string, unknown>);
    expect(key).toEqual(['analytics', 'health', { floor: 2, department: 'engineering' }]);
  });
});

describe('useHealthAnalytics', () => {
  beforeEach(() => {
    capturedUseQueryArgs = null;
    jest.clearAllMocks();
  });

  it('should call useQuery with correct queryKey for default options', () => {
    useHealthAnalytics();

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.health({} as Record<string, unknown>)
    );
  });

  it('should call useQuery with correct queryKey for custom options', () => {
    useHealthAnalytics({ floor: 3, building_id: 'bldg_1' });

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.health({ floor: 3, building_id: 'bldg_1' } as Record<string, unknown>)
    );
  });

  it('should call useQuery with correct queryKey for department filter', () => {
    useHealthAnalytics({ department: 'ops' });

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.health({ department: 'ops' } as Record<string, unknown>)
    );
  });

  it('should provide a queryFn that calls v2Api.analytics.health', async () => {
    useHealthAnalytics({ floor: 1 });

    expect(capturedUseQueryArgs).toBeDefined();
    expect(typeof capturedUseQueryArgs!.queryFn).toBe('function');

    // Execute the queryFn
    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    await queryFn();

    expect(v2Api.analytics.health).toHaveBeenCalledWith({ floor: 1 });
  });

  it('should set staleTime to 1 minute', () => {
    useHealthAnalytics();

    expect(capturedUseQueryArgs!.staleTime).toBe(60 * 1000);
  });

  it('should set gcTime to 3 minutes', () => {
    useHealthAnalytics();

    expect(capturedUseQueryArgs!.gcTime).toBe(3 * 60 * 1000);
  });

  it('should merge custom config into useQuery options', () => {
    useHealthAnalytics({}, { enabled: false });

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });

  it('should allow custom config to override staleTime', () => {
    useHealthAnalytics({}, { staleTime: 5000 });

    // Custom config is spread after defaults, so it should override
    expect(capturedUseQueryArgs!.staleTime).toBe(5000);
  });
});

describe('useInvalidateHealth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an invalidation function', () => {
    const invalidate = useInvalidateHealth();

    expect(typeof invalidate).toBe('function');
  });

  it('should call invalidateQueries with health queryKey when invoked', () => {
    const invalidate = useInvalidateHealth();
    invalidate();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.health(),
    });
  });
});
