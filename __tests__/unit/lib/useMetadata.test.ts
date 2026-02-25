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
    metadata: {
      get: jest.fn().mockResolvedValue({
        success: true,
        data: {
          types: ['temperature', 'humidity'],
          buildings: ['main-hq'],
          floors: [1, 2, 3],
        },
      }),
    },
  },
}));

import { v2Api } from '@/lib/api/v2-client';
import { useMetadata } from '@/lib/query/hooks/useMetadata';

describe('queryKeys.metadata', () => {
  it('should be a static array key', () => {
    expect(queryKeys.metadata).toEqual(['metadata']);
  });
});

describe('useMetadata', () => {
  beforeEach(() => {
    capturedUseQueryArgs = null;
    jest.clearAllMocks();
  });

  it('should call useQuery with correct queryKey', () => {
    useMetadata();

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(queryKeys.metadata);
  });

  it('should provide a queryFn that calls v2Api.metadata.get', async () => {
    useMetadata();

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    const result = await queryFn();

    expect(v2Api.metadata.get).toHaveBeenCalled();
    expect(result).toEqual({
      types: ['temperature', 'humidity'],
      buildings: ['main-hq'],
      floors: [1, 2, 3],
    });
  });

  it('should set staleTime to 10 minutes', () => {
    useMetadata();

    expect(capturedUseQueryArgs!.staleTime).toBe(10 * 60 * 1000);
  });

  it('should set gcTime to 30 minutes', () => {
    useMetadata();

    expect(capturedUseQueryArgs!.gcTime).toBe(30 * 60 * 1000);
  });

  it('should merge custom config into useQuery options', () => {
    useMetadata({ enabled: false });

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });

  it('should allow custom config to override staleTime', () => {
    useMetadata({ staleTime: 5000 });

    expect(capturedUseQueryArgs!.staleTime).toBe(5000);
  });
});
