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
    devices: {
      list: jest.fn().mockResolvedValue({
        success: true,
        data: [{ _id: 'device_001', name: 'Test Device' }],
        pagination: { pages: 1, total: 1, page: 1, limit: 100 },
      }),
    },
  },
}));

import { v2Api } from '@/lib/api/v2-client';
import { useDevicesList } from '@/lib/query/hooks/useDevicesList';

describe('queryKeys.devices', () => {
  it('should generate list key without filters', () => {
    const key = queryKeys.devices.list();
    expect(key).toEqual(['devices', 'list', undefined]);
  });

  it('should generate list key with filters', () => {
    const key = queryKeys.devices.list({ status: 'active', floor: 2 });
    expect(key).toEqual(['devices', 'list', { status: 'active', floor: 2 }]);
  });

  it('should generate list key with empty object', () => {
    const key = queryKeys.devices.list({});
    expect(key).toEqual(['devices', 'list', {}]);
  });

  it('should generate detail key', () => {
    const key = queryKeys.devices.detail('device_001');
    expect(key).toEqual(['devices', 'detail', 'device_001']);
  });

  it('should have all key', () => {
    expect(queryKeys.devices.all).toEqual(['devices']);
  });
});

describe('useDevicesList', () => {
  beforeEach(() => {
    capturedUseQueryArgs = null;
    jest.clearAllMocks();
  });

  it('should call useQuery with correct queryKey for default filters', () => {
    useDevicesList();

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.devices.list({} as Record<string, unknown>)
    );
  });

  it('should call useQuery with correct queryKey for custom filters', () => {
    useDevicesList({ status: 'active', floor: 3 });

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.devices.list({ status: 'active', floor: 3 } as Record<string, unknown>)
    );
  });

  it('should set staleTime to 5 minutes', () => {
    useDevicesList();

    expect(capturedUseQueryArgs!.staleTime).toBe(5 * 60 * 1000);
  });

  it('should set gcTime to 10 minutes', () => {
    useDevicesList();

    expect(capturedUseQueryArgs!.gcTime).toBe(10 * 60 * 1000);
  });

  it('should provide a queryFn that fetches all pages when no pagination params', async () => {
    useDevicesList({ status: 'active' });

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    await queryFn();

    expect(v2Api.devices.list).toHaveBeenCalledWith({
      status: 'active',
      limit: 100,
      page: 1,
    });
  });

  it('should fetch multiple pages in parallel when totalPages > 1', async () => {
    (v2Api.devices.list as jest.Mock)
      .mockResolvedValueOnce({
        data: [{ _id: 'device_001' }],
        pagination: { pages: 3, total: 250 },
      })
      .mockResolvedValueOnce({
        data: [{ _id: 'device_101' }],
        pagination: { pages: 3, total: 250 },
      })
      .mockResolvedValueOnce({
        data: [{ _id: 'device_201' }],
        pagination: { pages: 3, total: 250 },
      });

    useDevicesList();

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    const result = await queryFn();

    expect(v2Api.devices.list).toHaveBeenCalledTimes(3);
    expect(v2Api.devices.list).toHaveBeenCalledWith({ limit: 100, page: 1 });
    expect(v2Api.devices.list).toHaveBeenCalledWith({ limit: 100, page: 2 });
    expect(v2Api.devices.list).toHaveBeenCalledWith({ limit: 100, page: 3 });
    expect(result).toEqual([
      { _id: 'device_001' },
      { _id: 'device_101' },
      { _id: 'device_201' },
    ]);
  });

  it('should do single page fetch when page param is provided', async () => {
    useDevicesList({ page: 2, limit: 50 });

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    await queryFn();

    expect(v2Api.devices.list).toHaveBeenCalledWith({ page: 2, limit: 50 });
  });

  it('should do single page fetch when limit param is provided', async () => {
    useDevicesList({ limit: 25 });

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    await queryFn();

    expect(v2Api.devices.list).toHaveBeenCalledWith({ limit: 25 });
  });

  it('should cap at 20 pages maximum', async () => {
    (v2Api.devices.list as jest.Mock).mockResolvedValue({
      data: [{ _id: 'device_001' }],
      pagination: { pages: 50, total: 5000 },
    });

    useDevicesList();

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    await queryFn();

    // 1 initial + 19 parallel = 20 total
    expect(v2Api.devices.list).toHaveBeenCalledTimes(20);
  });

  it('should merge custom config into useQuery options', () => {
    useDevicesList({}, { enabled: false });

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });

  it('should allow custom config to override staleTime', () => {
    useDevicesList({}, { staleTime: 1000 });

    expect(capturedUseQueryArgs!.staleTime).toBe(1000);
  });
});
