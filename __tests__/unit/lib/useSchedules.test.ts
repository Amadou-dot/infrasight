import { queryKeys } from '@/lib/query/queryClient';

// Track captured args for useQuery and useMutation
let capturedUseQueryArgs: Record<string, unknown> | null = null;
let capturedMutationArgs: Record<string, unknown> | null = null;
const mockInvalidateQueries = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useQuery: (args: Record<string, unknown>) => {
    capturedUseQueryArgs = args;
    return { data: undefined, isLoading: true, isError: false };
  },
  useMutation: (args: Record<string, unknown>) => {
    capturedMutationArgs = args;
    return { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false };
  },
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
  QueryClient: jest.fn().mockImplementation(() => ({})),
  keepPreviousData: Symbol('keepPreviousData'),
}));

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    schedules: {
      list: jest.fn().mockResolvedValue({
        success: true,
        data: [{ _id: 'sched_001', status: 'scheduled' }],
      }),
      getById: jest.fn().mockResolvedValue({
        success: true,
        data: { _id: 'sched_001', status: 'scheduled' },
      }),
      create: jest.fn().mockResolvedValue({
        success: true,
        data: { created: 1, schedules: [{ _id: 'sched_002' }] },
      }),
      update: jest.fn().mockResolvedValue({
        success: true,
        data: { _id: 'sched_001', status: 'scheduled' },
      }),
      complete: jest.fn().mockResolvedValue({
        success: true,
        data: { _id: 'sched_001', status: 'completed' },
      }),
      cancel: jest.fn().mockResolvedValue({
        success: true,
        data: { _id: 'sched_001', cancelled: true },
      }),
    },
  },
}));

import { v2Api } from '@/lib/api/v2-client';
import {
  useSchedulesList,
  useScheduleDetail,
  useCreateSchedule,
  useUpdateSchedule,
  useCompleteSchedule,
  useCancelSchedule,
} from '@/lib/query/hooks/useSchedules';

// ============================================================================
// QUERY KEY TESTS
// ============================================================================

describe('queryKeys.schedules', () => {
  it('should have all key', () => {
    expect(queryKeys.schedules.all).toEqual(['schedules']);
  });

  it('should generate list key without filters', () => {
    const key = queryKeys.schedules.list();
    expect(key).toEqual(['schedules', 'list', undefined]);
  });

  it('should generate list key with filters', () => {
    const key = queryKeys.schedules.list({ status: 'scheduled', service_type: 'calibration' });
    expect(key).toEqual([
      'schedules',
      'list',
      { status: 'scheduled', service_type: 'calibration' },
    ]);
  });

  it('should generate detail key', () => {
    const key = queryKeys.schedules.detail('sched_001');
    expect(key).toEqual(['schedules', 'detail', 'sched_001']);
  });
});

// ============================================================================
// useSchedulesList TESTS
// ============================================================================

describe('useSchedulesList', () => {
  beforeEach(() => {
    capturedUseQueryArgs = null;
    jest.clearAllMocks();
  });

  it('should call useQuery with correct queryKey for default filters', () => {
    useSchedulesList();

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.schedules.list({} as Record<string, unknown>)
    );
  });

  it('should call useQuery with correct queryKey for custom filters', () => {
    useSchedulesList({ status: 'scheduled', service_type: 'firmware_update' });

    expect(capturedUseQueryArgs!.queryKey).toEqual(
      queryKeys.schedules.list({
        status: 'scheduled',
        service_type: 'firmware_update',
      } as Record<string, unknown>)
    );
  });

  it('should provide a queryFn that calls v2Api.schedules.list', async () => {
    const filters = { status: 'scheduled' as const };
    useSchedulesList(filters);

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    const result = await queryFn();

    expect(v2Api.schedules.list).toHaveBeenCalledWith(filters);
    expect(result).toEqual([{ _id: 'sched_001', status: 'scheduled' }]);
  });

  it('should set staleTime to 2 minutes', () => {
    useSchedulesList();

    expect(capturedUseQueryArgs!.staleTime).toBe(2 * 60 * 1000);
  });

  it('should set gcTime to 5 minutes', () => {
    useSchedulesList();

    expect(capturedUseQueryArgs!.gcTime).toBe(5 * 60 * 1000);
  });

  it('should merge custom config into useQuery options', () => {
    useSchedulesList({}, { enabled: false });

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });
});

// ============================================================================
// useScheduleDetail TESTS
// ============================================================================

describe('useScheduleDetail', () => {
  beforeEach(() => {
    capturedUseQueryArgs = null;
    jest.clearAllMocks();
  });

  it('should call useQuery with correct queryKey', () => {
    useScheduleDetail('sched_001');

    expect(capturedUseQueryArgs).toBeDefined();
    expect(capturedUseQueryArgs!.queryKey).toEqual(queryKeys.schedules.detail('sched_001'));
  });

  it('should set enabled to true when id is provided', () => {
    useScheduleDetail('sched_001');

    expect(capturedUseQueryArgs!.enabled).toBe(true);
  });

  it('should set enabled to false when id is empty string', () => {
    useScheduleDetail('');

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });

  it('should provide a queryFn that calls v2Api.schedules.getById', async () => {
    useScheduleDetail('sched_001', { include_device: true });

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    const result = await queryFn();

    expect(v2Api.schedules.getById).toHaveBeenCalledWith('sched_001', { include_device: true });
    expect(result).toEqual({ _id: 'sched_001', status: 'scheduled' });
  });

  it('should pass empty options by default', async () => {
    useScheduleDetail('sched_001');

    const queryFn = capturedUseQueryArgs!.queryFn as () => Promise<unknown>;
    await queryFn();

    expect(v2Api.schedules.getById).toHaveBeenCalledWith('sched_001', {});
  });

  it('should set staleTime to 2 minutes', () => {
    useScheduleDetail('sched_001');

    expect(capturedUseQueryArgs!.staleTime).toBe(2 * 60 * 1000);
  });

  it('should set gcTime to 5 minutes', () => {
    useScheduleDetail('sched_001');

    expect(capturedUseQueryArgs!.gcTime).toBe(5 * 60 * 1000);
  });

  it('should merge custom config (overrides enabled)', () => {
    useScheduleDetail('sched_001', {}, { enabled: false });

    expect(capturedUseQueryArgs!.enabled).toBe(false);
  });
});

// ============================================================================
// useCreateSchedule TESTS
// ============================================================================

describe('useCreateSchedule', () => {
  beforeEach(() => {
    capturedMutationArgs = null;
    jest.clearAllMocks();
  });

  it('should provide a mutationFn that calls v2Api.schedules.create', async () => {
    useCreateSchedule();

    const mutationFn = capturedMutationArgs!.mutationFn as (data: unknown) => Promise<unknown>;
    const input = {
      device_ids: ['device_001'],
      service_type: 'calibration',
      scheduled_date: '2026-03-01T10:00:00Z',
    };
    const result = await mutationFn(input);

    expect(v2Api.schedules.create).toHaveBeenCalledWith(input);
    expect(result).toEqual({ created: 1, schedules: [{ _id: 'sched_002' }] });
  });

  it('should invalidate schedules.all on success', () => {
    useCreateSchedule();

    const onSuccess = capturedMutationArgs!.onSuccess as () => void;
    onSuccess();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.schedules.all,
    });
  });
});

// ============================================================================
// useUpdateSchedule TESTS
// ============================================================================

describe('useUpdateSchedule', () => {
  beforeEach(() => {
    capturedMutationArgs = null;
    jest.clearAllMocks();
  });

  it('should provide a mutationFn that calls v2Api.schedules.update', async () => {
    useUpdateSchedule();

    const mutationFn = capturedMutationArgs!.mutationFn as (data: unknown) => Promise<unknown>;
    const result = await mutationFn({
      id: 'sched_001',
      data: { notes: 'Updated notes' },
    });

    expect(v2Api.schedules.update).toHaveBeenCalledWith('sched_001', { notes: 'Updated notes' });
    expect(result).toEqual({ _id: 'sched_001', status: 'scheduled' });
  });

  it('should invalidate both detail and all on success', () => {
    useUpdateSchedule();

    const onSuccess = capturedMutationArgs!.onSuccess as (
      data: unknown,
      variables: { id: string }
    ) => void;
    onSuccess(undefined, { id: 'sched_001' });

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.schedules.detail('sched_001'),
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.schedules.all,
    });
  });
});

// ============================================================================
// useCompleteSchedule TESTS
// ============================================================================

describe('useCompleteSchedule', () => {
  beforeEach(() => {
    capturedMutationArgs = null;
    jest.clearAllMocks();
  });

  it('should provide a mutationFn that calls v2Api.schedules.complete', async () => {
    useCompleteSchedule();

    const mutationFn = capturedMutationArgs!.mutationFn as (id: string) => Promise<unknown>;
    const result = await mutationFn('sched_001');

    expect(v2Api.schedules.complete).toHaveBeenCalledWith('sched_001');
    expect(result).toEqual({ _id: 'sched_001', status: 'completed' });
  });

  it('should invalidate both detail and all on success', () => {
    useCompleteSchedule();

    const onSuccess = capturedMutationArgs!.onSuccess as (data: unknown, id: string) => void;
    onSuccess(undefined, 'sched_001');

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.schedules.detail('sched_001'),
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.schedules.all,
    });
  });
});

// ============================================================================
// useCancelSchedule TESTS
// ============================================================================

describe('useCancelSchedule', () => {
  beforeEach(() => {
    capturedMutationArgs = null;
    jest.clearAllMocks();
  });

  it('should provide a mutationFn that calls v2Api.schedules.cancel', async () => {
    useCancelSchedule();

    const mutationFn = capturedMutationArgs!.mutationFn as (id: string) => Promise<unknown>;
    const result = await mutationFn('sched_001');

    expect(v2Api.schedules.cancel).toHaveBeenCalledWith('sched_001');
    expect(result).toEqual({ _id: 'sched_001', cancelled: true });
  });

  it('should invalidate both detail and all on success', () => {
    useCancelSchedule();

    const onSuccess = capturedMutationArgs!.onSuccess as (data: unknown, id: string) => void;
    onSuccess(undefined, 'sched_001');

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.schedules.detail('sched_001'),
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.schedules.all,
    });
  });
});
