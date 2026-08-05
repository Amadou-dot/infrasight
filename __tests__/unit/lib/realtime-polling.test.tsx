/**
 * Connection-state-aware poll fallback for the alert queries.
 *
 * The bug this covers is a screen that lies. When the Pusher socket dies —
 * especially on a terminal close code (4004 quota, 4001 bad key) that never
 * auto-reconnects — nothing refetches, `refetchOnWindowFocus` is false, and a
 * wall display sits on "No open alerts." indefinitely while the building is on
 * fire.
 *
 * The fix is deliberately NOT an unconditional interval, and both halves of
 * that matter, so both are asserted here:
 *   - socket down  -> poll, or the screen goes stale forever;
 *   - socket up    -> do NOT poll, or every alert surface adds a request per
 *                     30s that can only ever return what the socket already
 *                     delivered.
 *
 * `useRealtimeConnection` is mocked because the point under test is the wiring
 * between connection state and React Query, not how the state is computed —
 * that lives in pusher-alerts.test.tsx.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAlertsList,
  useOpenAlertCount,
  REALTIME_FALLBACK_POLL_MS,
} from '@/lib/query/hooks/useAlerts';
import { useRealtimeConnection } from '@/lib/pusher-context';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    alerts: { list: jest.fn() },
  },
}));

jest.mock('@/lib/pusher-context', () => ({
  useRealtimeConnection: jest.fn(),
}));

const mockConnection = useRealtimeConnection as jest.Mock;

function setConnected(connected: boolean) {
  mockConnection.mockReturnValue({
    connected,
    state: connected ? 'connected' : 'reconnecting',
    degraded: !connected,
    message: connected ? null : 'Lost the real-time connection.',
    terminal: false,
  });
}

/** Fresh client per render so cached data never leaks between rows. */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

/** The refetchInterval React Query actually resolved for the only live query. */
function resolvedInterval(client: QueryClient): number | false | undefined {
  const query = client.getQueryCache().getAll()[0];
  return query?.observers[0]?.options.refetchInterval as number | false | undefined;
}

beforeEach(() => {
  (v2Api.alerts.list as jest.Mock).mockResolvedValue({
    data: [{ _id: 'a1' }],
    pagination: { total: 1 },
  });
});

describe('useAlertsList poll fallback', () => {
  it('polls while the realtime connection is DOWN', async () => {
    setConnected(false);
    const { client, wrapper } = makeWrapper();

    const { result } = renderHook(() => useAlertsList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(resolvedInterval(client)).toBe(REALTIME_FALLBACK_POLL_MS);
  });

  it('does NOT poll while the realtime connection is UP', async () => {
    setConnected(true);
    const { client, wrapper } = makeWrapper();

    const { result } = renderHook(() => useAlertsList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(resolvedInterval(client)).toBe(false);
  });

  it('starts polling when a live connection drops', async () => {
    setConnected(true);
    const { client, wrapper } = makeWrapper();

    const { result, rerender } = renderHook(() => useAlertsList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(resolvedInterval(client)).toBe(false);

    setConnected(false);
    rerender();

    expect(resolvedInterval(client)).toBe(REALTIME_FALLBACK_POLL_MS);
  });

  it('lets a caller override the interval, because config spreads last', async () => {
    setConnected(false);
    const { client, wrapper } = makeWrapper();

    const { result } = renderHook(() => useAlertsList({}, { refetchInterval: 1234 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(resolvedInterval(client)).toBe(1234);
  });
});

describe('useOpenAlertCount poll fallback', () => {
  it('polls while the realtime connection is DOWN', async () => {
    setConnected(false);
    const { client, wrapper } = makeWrapper();

    const { result } = renderHook(() => useOpenAlertCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(resolvedInterval(client)).toBe(REALTIME_FALLBACK_POLL_MS);
  });

  it('does NOT poll while the realtime connection is UP', async () => {
    setConnected(true);
    const { client, wrapper } = makeWrapper();

    const { result } = renderHook(() => useOpenAlertCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(resolvedInterval(client)).toBe(false);
  });
});

/**
 * The rows above read the option React Query resolved; this one proves the
 * option is actually wired to a timer that fires. A configuration assertion
 * alone would pass against a `refetchInterval` React Query ignored.
 */
describe('poll fallback actually refetches', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('refetches after the interval elapses while disconnected', async () => {
    setConnected(false);
    const { wrapper } = makeWrapper();

    renderHook(() => useAlertsList(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(v2Api.alerts.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(REALTIME_FALLBACK_POLL_MS + 100);
      await Promise.resolve();
    });

    expect((v2Api.alerts.list as jest.Mock).mock.calls.length).toBeGreaterThan(1);
  });

  it('does not refetch on a timer while connected', async () => {
    setConnected(true);
    const { wrapper } = makeWrapper();

    renderHook(() => useAlertsList(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(v2Api.alerts.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(REALTIME_FALLBACK_POLL_MS * 4);
      await Promise.resolve();
    });

    expect(v2Api.alerts.list).toHaveBeenCalledTimes(1);
  });
});
