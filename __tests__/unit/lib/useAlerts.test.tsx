/**
 * useAlerts Hook Tests
 *
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
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
