/**
 * useAlertRules Hook Tests
 *
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useAlertRulesList,
  useAlertRuleDetail,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
} from '@/lib/query/hooks/useAlertRules';
import { v2Api } from '@/lib/api/v2-client';
import type { CreateAlertRuleBody } from '@/types/v2';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    alertRules: {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useAlertRulesList', () => {
  it('should return the rules array', async () => {
    (v2Api.alertRules.list as jest.Mock).mockResolvedValue({
      data: [{ _id: 'r1', name: 'High temp' }],
    });

    const { result } = renderHook(() => useAlertRulesList({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ _id: 'r1', name: 'High temp' }]);
    expect(v2Api.alertRules.list).toHaveBeenCalledWith({ enabled: true });
  });

  it('should surface an error', async () => {
    (v2Api.alertRules.list as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useAlertRulesList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useAlertRuleDetail', () => {
  it('should be disabled without an id', () => {
    const { result } = renderHook(() => useAlertRuleDetail(''), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(v2Api.alertRules.getById).not.toHaveBeenCalled();
  });

  it('should load a rule by id', async () => {
    (v2Api.alertRules.getById as jest.Mock).mockResolvedValue({
      data: { _id: 'r1', name: 'High temp' },
    });

    const { result } = renderHook(() => useAlertRuleDetail('r1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ _id: 'r1', name: 'High temp' });
    expect(v2Api.alertRules.getById).toHaveBeenCalledWith('r1');
  });
});

describe('mutations', () => {
  it('should create a rule', async () => {
    (v2Api.alertRules.create as jest.Mock).mockResolvedValue({ data: { _id: 'r2' } });

    const { result } = renderHook(() => useCreateAlertRule(), { wrapper });
    const body: CreateAlertRuleBody = {
      name: 'R',
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      severity: 'warning',
      selector: { types: ['temperature'] },
    };
    result.current.mutate(body);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alertRules.create).toHaveBeenCalledWith(body);
  });

  it('should update a rule with {id, data}', async () => {
    (v2Api.alertRules.update as jest.Mock).mockResolvedValue({ data: { _id: 'r1', name: 'New' } });

    const { result } = renderHook(() => useUpdateAlertRule(), { wrapper });
    result.current.mutate({ id: 'r1', data: { name: 'New' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alertRules.update).toHaveBeenCalledWith('r1', { name: 'New' });
  });

  it('should delete a rule by bare id, not an object', async () => {
    (v2Api.alertRules.delete as jest.Mock).mockResolvedValue({
      data: { _id: 'r1', deleted: true },
    });

    const { result } = renderHook(() => useDeleteAlertRule(), { wrapper });
    result.current.mutate('r1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alertRules.delete).toHaveBeenCalledWith('r1');
  });
});
