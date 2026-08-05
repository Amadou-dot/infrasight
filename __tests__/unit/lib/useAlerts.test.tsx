/**
 * useAlerts Hook Tests
 *
 * @jest-environment jsdom
 *
 * The `mutations refresh the mounted alert surfaces` block below exists because
 * the invalidations in `useAcknowledgeAlert` / `useResolveAlert` are the ONLY
 * thing that moves a new row onto the screen. Nothing in this subsystem calls
 * `setQueryData`; the Pusher `alert-event` carries a notification, never the
 * row. Delete an `invalidateQueries` line and the acknowledged alert keeps
 * rendering as "firing" until something unrelated happens to refetch.
 *
 * Those tests deliberately do NOT spy on `queryClient.invalidateQueries` and
 * assert it was called with `queryKeys.alerts.all`. That assertion is
 * tautological — the test and the hook read the same constant, so it passes
 * whether or not invalidating that key achieves anything. Instead a real
 * `QueryClient` holds a real, mounted, observed list query; the fake API is
 * backed by mutable server state; and the assertion is that the rendered rows
 * and the nav-badge count actually changed to what the server now returns.
 *
 * Two things are pinned so an observed refetch cannot be an accident:
 *  - `useRealtimeConnection` is mocked as connected, which resolves
 *    `refetchInterval` to `false` — no timer can refetch anything here.
 *  - `does not refetch on its own while nothing invalidates it` is the control:
 *    it proves the call-count increases in the other tests are caused by the
 *    mutation and not by React Query refetching in the background.
 *
 * Note that each mutation hook invalidates `alerts.detail(id)` AND
 * `alerts.all`, and today the second makes the first redundant — `alerts.all`
 * is a key PREFIX of `alerts.detail(id)`. That coupling lives in
 * `lib/query/queryClient.ts` and is guarded by
 * `__tests__/unit/lib/queryClient-alert-keys.test.ts`, not here.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useAlertsList,
  useAlertDetail,
  useAcknowledgeAlert,
  useResolveAlert,
  useOpenAlertCount,
} from '@/lib/query/hooks/useAlerts';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    alerts: {
      list: jest.fn(),
      getById: jest.fn(),
      acknowledge: jest.fn(),
      resolve: jest.fn(),
    },
  },
}));

/**
 * Connected => `useRealtimeFallbackInterval()` returns false, so every alert
 * query resolves `refetchInterval: false`. Any refetch these tests observe can
 * only have come from an explicit invalidation, never from the poll fallback.
 */
jest.mock('@/lib/pusher-context', () => ({
  useRealtimeConnection: () => ({
    connected: true,
    state: 'connected',
    degraded: false,
    message: null,
    terminal: false,
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useAlertsList', () => {
  it('should return the alerts array', async () => {
    (v2Api.alerts.list as jest.Mock).mockResolvedValue({ data: [{ _id: 'a1', status: 'firing' }] });

    const { result } = renderHook(() => useAlertsList({ status: 'firing' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ _id: 'a1', status: 'firing' }]);
    expect(v2Api.alerts.list).toHaveBeenCalledWith({ status: 'firing' });
  });

  it('should surface an error', async () => {
    (v2Api.alerts.list as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useAlertsList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useAlertDetail', () => {
  it('should be disabled without an id', () => {
    const { result } = renderHook(() => useAlertDetail(''), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(v2Api.alerts.getById).not.toHaveBeenCalled();
  });
});

describe('mutations', () => {
  it('should acknowledge', async () => {
    (v2Api.alerts.acknowledge as jest.Mock).mockResolvedValue({ data: { _id: 'a1', status: 'acknowledged' } });

    const { result } = renderHook(() => useAcknowledgeAlert(), { wrapper });
    result.current.mutate({ id: 'a1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alerts.acknowledge).toHaveBeenCalledWith('a1', undefined);
  });

  it('should resolve with a note', async () => {
    (v2Api.alerts.resolve as jest.Mock).mockResolvedValue({ data: { _id: 'a1', status: 'resolved' } });

    const { result } = renderHook(() => useResolveAlert(), { wrapper });
    result.current.mutate({ id: 'a1', note: 'fixed' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alerts.resolve).toHaveBeenCalledWith('a1', 'fixed');
  });
});

describe('useOpenAlertCount', () => {
  it('should read pagination.total, not the row count', async () => {
    (v2Api.alerts.list as jest.Mock).mockResolvedValue({
      data: [{ _id: 'a1' }],     // one row...
      pagination: { total: 143 }, // ...but 143 open alerts
    });

    const { result } = renderHook(() => useOpenAlertCount(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(143);
  });

  it('should request a single row rather than a full page', async () => {
    (v2Api.alerts.list as jest.Mock).mockResolvedValue({
      data: [],
      pagination: { total: 0 },
    });

    const { result } = renderHook(() => useOpenAlertCount(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alerts.list).toHaveBeenCalledWith({ limit: 1 });
  });
});

// ============================================================================
// D1 — the invalidations are load-bearing
// ============================================================================

type FakeAlert = { _id: string; status: string };

/**
 * A stand-in alerts API backed by mutable state, so a test can act out "the
 * server now says something different" — which is the only way to tell a real
 * refetch from a cache read.
 *
 * `open` is what `GET /api/v2/alerts` returns (firing + acknowledged) and backs
 * both the list and the nav badge, exactly as the real endpoint does. `store`
 * is separate because a resolved alert leaves the open list while remaining
 * perfectly fetchable by id — that asymmetry is the whole point of the
 * "dropping the resolved row" test.
 */
function seedAlertServer(initial: { open: FakeAlert[]; total: number }) {
  const store: Record<string, FakeAlert> = {};
  for (const row of initial.open) store[row._id] = row;

  const server = { open: initial.open, total: initial.total, store };

  (v2Api.alerts.list as jest.Mock).mockImplementation(async (params?: { limit?: number }) => ({
    data: params?.limit === 1 ? server.open.slice(0, 1) : server.open,
    pagination: { total: server.total },
  }));
  (v2Api.alerts.getById as jest.Mock).mockImplementation(async (id: string) => ({
    data: server.store[id],
  }));

  return server;
}

/** One real QueryClient shared by every hook in the render, as in the app. */
function makeSharedWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const sharedWrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper: sharedWrapper };
}

/**
 * Every alert surface a user has open at once: the list, the nav badge, the
 * detail pane, and the two action buttons. Mounting them together is the point
 * — React Query only refetches queries that have a live observer, so a test
 * that mounts the mutation alone can never see the invalidation do anything.
 */
function useAlertSurfaces() {
  return {
    list: useAlertsList({ status: 'firing' }),
    count: useOpenAlertCount(),
    detail: useAlertDetail('a1'),
    acknowledge: useAcknowledgeAlert(),
    resolve: useResolveAlert(),
  };
}

function listCalls() {
  return (v2Api.alerts.list as jest.Mock).mock.calls.length;
}

function detailCalls() {
  return (v2Api.alerts.getById as jest.Mock).mock.calls.length;
}

describe('mutations refresh the mounted alert surfaces', () => {
  async function mountSettled() {
    const { wrapper: sharedWrapper } = makeSharedWrapper();
    const { result } = renderHook(() => useAlertSurfaces(), { wrapper: sharedWrapper });

    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.count.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
    });

    return result;
  }

  /**
   * The control. Without it, an increased call count elsewhere in this block
   * could just be React Query refetching on its own, and every assertion below
   * would be measuring nothing.
   */
  it('should not refetch on its own while nothing invalidates it', async () => {
    seedAlertServer({ open: [{ _id: 'a1', status: 'firing' }], total: 3 });

    const result = await mountSettled();
    const before = listCalls();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(listCalls()).toBe(before);
    expect(result.current.list.data).toEqual([{ _id: 'a1', status: 'firing' }]);
  });

  it('should refetch the alert list after acknowledging, showing the new server rows', async () => {
    const server = seedAlertServer({ open: [{ _id: 'a1', status: 'firing' }], total: 3 });
    (v2Api.alerts.acknowledge as jest.Mock).mockImplementation(async (id: string) => {
      server.open = [{ _id: id, status: 'acknowledged' }];
      server.store[id] = server.open[0];
      server.total = 2;
      return { data: server.open[0] };
    });

    const result = await mountSettled();
    const before = listCalls();
    expect(result.current.list.data).toEqual([{ _id: 'a1', status: 'firing' }]);

    await act(async () => {
      result.current.acknowledge.mutate({ id: 'a1' });
    });
    await waitFor(() => expect(result.current.acknowledge.isSuccess).toBe(true));

    await waitFor(() =>
      expect(result.current.list.data).toEqual([{ _id: 'a1', status: 'acknowledged' }])
    );
    expect(listCalls()).toBeGreaterThan(before);
  });

  it('should refetch the open-alert badge count after acknowledging', async () => {
    const server = seedAlertServer({ open: [{ _id: 'a1', status: 'firing' }], total: 3 });
    (v2Api.alerts.acknowledge as jest.Mock).mockImplementation(async (id: string) => {
      server.total = 2;
      return { data: { _id: id, status: 'acknowledged' } };
    });

    const result = await mountSettled();
    expect(result.current.count.data).toBe(3);

    await act(async () => {
      result.current.acknowledge.mutate({ id: 'a1' });
    });
    await waitFor(() => expect(result.current.acknowledge.isSuccess).toBe(true));

    await waitFor(() => expect(result.current.count.data).toBe(2));
  });

  it('should refetch the open alert detail after acknowledging', async () => {
    const server = seedAlertServer({ open: [{ _id: 'a1', status: 'firing' }], total: 3 });
    (v2Api.alerts.acknowledge as jest.Mock).mockImplementation(async (id: string) => {
      server.store[id] = { _id: id, status: 'acknowledged' };
      return { data: server.store[id] };
    });

    const result = await mountSettled();
    const before = detailCalls();
    expect(result.current.detail.data).toEqual({ _id: 'a1', status: 'firing' });

    await act(async () => {
      result.current.acknowledge.mutate({ id: 'a1' });
    });
    await waitFor(() => expect(result.current.acknowledge.isSuccess).toBe(true));

    await waitFor(() =>
      expect(result.current.detail.data).toEqual({ _id: 'a1', status: 'acknowledged' })
    );
    expect(detailCalls()).toBeGreaterThan(before);
  });

  it('should refetch the alert list after resolving, dropping the resolved row', async () => {
    const server = seedAlertServer({ open: [{ _id: 'a1', status: 'firing' }], total: 3 });
    (v2Api.alerts.resolve as jest.Mock).mockImplementation(async (id: string) => {
      // Resolved alerts leave the default (open) list entirely.
      server.open = [];
      server.store[id] = { _id: id, status: 'resolved' };
      server.total = 2;
      return { data: server.store[id] };
    });

    const result = await mountSettled();
    const before = listCalls();
    expect(result.current.list.data).toEqual([{ _id: 'a1', status: 'firing' }]);

    await act(async () => {
      result.current.resolve.mutate({ id: 'a1', note: 'fixed' });
    });
    await waitFor(() => expect(result.current.resolve.isSuccess).toBe(true));

    await waitFor(() => expect(result.current.list.data).toEqual([]));
    expect(listCalls()).toBeGreaterThan(before);
  });

  it('should refetch the open-alert badge count after resolving', async () => {
    const server = seedAlertServer({ open: [{ _id: 'a1', status: 'firing' }], total: 3 });
    (v2Api.alerts.resolve as jest.Mock).mockImplementation(async (id: string) => {
      server.total = 2;
      return { data: { _id: id, status: 'resolved' } };
    });

    const result = await mountSettled();
    expect(result.current.count.data).toBe(3);

    await act(async () => {
      result.current.resolve.mutate({ id: 'a1' });
    });
    await waitFor(() => expect(result.current.resolve.isSuccess).toBe(true));

    await waitFor(() => expect(result.current.count.data).toBe(2));
  });

  it('should refetch the open alert detail after resolving', async () => {
    const server = seedAlertServer({ open: [{ _id: 'a1', status: 'firing' }], total: 3 });
    (v2Api.alerts.resolve as jest.Mock).mockImplementation(async (id: string) => {
      server.store[id] = { _id: id, status: 'resolved' };
      return { data: server.store[id] };
    });

    const result = await mountSettled();
    const before = detailCalls();
    expect(result.current.detail.data).toEqual({ _id: 'a1', status: 'firing' });

    await act(async () => {
      result.current.resolve.mutate({ id: 'a1' });
    });
    await waitFor(() => expect(result.current.resolve.isSuccess).toBe(true));

    await waitFor(() =>
      expect(result.current.detail.data).toEqual({ _id: 'a1', status: 'resolved' })
    );
    expect(detailCalls()).toBeGreaterThan(before);
  });
});
