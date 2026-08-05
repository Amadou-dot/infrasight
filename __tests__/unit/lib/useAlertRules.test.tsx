/**
 * useAlertRules Hook Tests
 *
 * @jest-environment jsdom
 *
 * The `mutations refresh the mounted rule surfaces` block below protects the
 * `invalidateQueries` calls in the three rule mutations. Nothing patches the
 * rule list into the cache — create/update/delete change the server and the
 * invalidation is the only reason the open rules table re-reads it. Delete one
 * and a just-created rule does not appear until a full remount.
 *
 * These tests deliberately do NOT spy on `queryClient.invalidateQueries` and
 * assert the key. That assertion is tautological: the hook and the test read
 * the same `queryKeys.alertRules.all` constant, so it passes even if
 * invalidating that key refetches nothing. Instead a real `QueryClient` holds a
 * real, mounted, observed list query, the fake API is backed by mutable server
 * state, and the assertion is that the rendered rules actually changed.
 *
 * `useAlertRulesList` has a 5-minute `staleTime` and no `refetchInterval`, so a
 * refetch inside a sub-second test cannot come from anywhere else. The control
 * test (`does not refetch on its own...`) pins that down rather than assuming
 * it.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useAlertRulesList,
  useAlertRuleDetail,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
} from '@/lib/query/hooks/useAlertRules';
import { useAlertsList } from '@/lib/query/hooks/useAlerts';
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
    alerts: {
      list: jest.fn(),
      getById: jest.fn(),
    },
  },
}));

/**
 * Connected => `useRealtimeFallbackInterval()` returns false, so `useAlertsList`
 * resolves `refetchInterval: false`. Any alert-list refetch the block at the
 * bottom of this file observes can only have come from an invalidation, never
 * from the poll fallback.
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

// ============================================================================
// D1 — the invalidations are load-bearing
// ============================================================================

type FakeRule = { _id: string; name: string; enabled: boolean };

/**
 * A stand-in alert-rules API backed by mutable state, so a test can act out
 * "the server now says something different" — the only way to tell a real
 * refetch from a cache read.
 *
 * `getById` REJECTS for an id that is no longer there, mirroring the 404 a
 * soft-deleted rule returns. That makes "the detail pane refetched" observable
 * as `isError` rather than as a silently stale success.
 */
function seedRuleServer(initial: FakeRule[]) {
  const server = { rules: initial };

  (v2Api.alertRules.list as jest.Mock).mockImplementation(async () => ({
    data: server.rules,
  }));
  (v2Api.alertRules.getById as jest.Mock).mockImplementation(async (id: string) => {
    const rule = server.rules.find(candidate => candidate._id === id);
    if (!rule) throw new Error('Alert rule not found');
    return { data: rule };
  });

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
 * The rules admin screen: the table, the detail pane, and the three actions.
 * Mounted together because React Query only refetches queries that have a live
 * observer — a test that mounts a mutation alone can never see the
 * invalidation do anything at all.
 */
function useRuleSurfaces() {
  return {
    list: useAlertRulesList(),
    detail: useAlertRuleDetail('r1'),
    create: useCreateAlertRule(),
    update: useUpdateAlertRule(),
    remove: useDeleteAlertRule(),
  };
}

function listCalls() {
  return (v2Api.alertRules.list as jest.Mock).mock.calls.length;
}

function detailCalls() {
  return (v2Api.alertRules.getById as jest.Mock).mock.calls.length;
}

const RULE_ONE: FakeRule = { _id: 'r1', name: 'High temp', enabled: true };

describe('mutations refresh the mounted rule surfaces', () => {
  async function mountSettled() {
    const { wrapper: sharedWrapper } = makeSharedWrapper();
    const { result } = renderHook(() => useRuleSurfaces(), { wrapper: sharedWrapper });

    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
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
    seedRuleServer([{ ...RULE_ONE }]);

    const result = await mountSettled();
    const before = listCalls();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(listCalls()).toBe(before);
    expect(result.current.list.data).toEqual([RULE_ONE]);
  });

  it('should refetch the rules list after creating, showing the new rule', async () => {
    const server = seedRuleServer([{ ...RULE_ONE }]);
    (v2Api.alertRules.create as jest.Mock).mockImplementation(async (body: CreateAlertRuleBody) => {
      const created = { _id: 'r2', name: body.name, enabled: body.enabled !== false };
      server.rules = [...server.rules, created];
      return { data: created };
    });

    const result = await mountSettled();
    const before = listCalls();
    expect(result.current.list.data).toEqual([RULE_ONE]);

    await act(async () => {
      result.current.create.mutate({
        name: 'Low battery',
        metric: 'battery_level',
        comparison: 'lt',
        threshold: 15,
        severity: 'warning',
      });
    });
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    await waitFor(() =>
      expect(result.current.list.data).toEqual([
        RULE_ONE,
        { _id: 'r2', name: 'Low battery', enabled: true },
      ])
    );
    expect(listCalls()).toBeGreaterThan(before);
  });

  it('should refetch the rules list after updating, showing the new name', async () => {
    const server = seedRuleServer([{ ...RULE_ONE }]);
    (v2Api.alertRules.update as jest.Mock).mockImplementation(
      async (id: string, data: { name?: string }) => {
        server.rules = server.rules.map(rule =>
          rule._id === id ? { ...rule, ...data } : rule
        );
        return { data: server.rules.find(rule => rule._id === id) };
      }
    );

    const result = await mountSettled();
    const before = listCalls();
    expect(result.current.list.data).toEqual([RULE_ONE]);

    await act(async () => {
      result.current.update.mutate({ id: 'r1', data: { name: 'Very high temp' } });
    });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));

    await waitFor(() =>
      expect(result.current.list.data).toEqual([
        { _id: 'r1', name: 'Very high temp', enabled: true },
      ])
    );
    expect(listCalls()).toBeGreaterThan(before);
  });

  it('should refetch the rule detail after updating, showing the new name', async () => {
    const server = seedRuleServer([{ ...RULE_ONE }]);
    (v2Api.alertRules.update as jest.Mock).mockImplementation(
      async (id: string, data: { name?: string }) => {
        server.rules = server.rules.map(rule =>
          rule._id === id ? { ...rule, ...data } : rule
        );
        return { data: server.rules.find(rule => rule._id === id) };
      }
    );

    const result = await mountSettled();
    const before = detailCalls();
    expect(result.current.detail.data).toEqual(RULE_ONE);

    await act(async () => {
      result.current.update.mutate({ id: 'r1', data: { name: 'Very high temp' } });
    });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));

    await waitFor(() =>
      expect(result.current.detail.data).toEqual({
        _id: 'r1',
        name: 'Very high temp',
        enabled: true,
      })
    );
    expect(detailCalls()).toBeGreaterThan(before);
  });

  it('should refetch the rules list after deleting, dropping the deleted rule', async () => {
    const server = seedRuleServer([{ ...RULE_ONE }, { _id: 'r2', name: 'CO2', enabled: true }]);
    (v2Api.alertRules.delete as jest.Mock).mockImplementation(async (id: string) => {
      server.rules = server.rules.filter(rule => rule._id !== id);
      return { data: { _id: id, deleted: true } };
    });

    const result = await mountSettled();
    const before = listCalls();
    expect(result.current.list.data).toHaveLength(2);

    await act(async () => {
      result.current.remove.mutate('r2');
    });
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));

    await waitFor(() => expect(result.current.list.data).toEqual([RULE_ONE]));
    expect(listCalls()).toBeGreaterThan(before);
  });

  it('should refetch the rule detail after deleting, so it stops showing a gone rule', async () => {
    const server = seedRuleServer([{ ...RULE_ONE }]);
    (v2Api.alertRules.delete as jest.Mock).mockImplementation(async (id: string) => {
      server.rules = server.rules.filter(rule => rule._id !== id);
      return { data: { _id: id, deleted: true } };
    });

    const result = await mountSettled();
    const before = detailCalls();
    expect(result.current.detail.data).toEqual(RULE_ONE);

    await act(async () => {
      result.current.remove.mutate('r1');
    });
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));

    await waitFor(() => expect(result.current.detail.isError).toBe(true));
    expect(detailCalls()).toBeGreaterThan(before);
  });
});

// ============================================================================
// Editing a rule's condition closes alerts, so the ALERT surfaces must refresh
// ============================================================================
//
// `PATCH /api/v2/alert-rules/[id]` does not only edit the rule. When
// metric/comparison/threshold change, every open episode carrying the now-false
// snapshot is closed in the database
// (`closeEpisodesOrphanedByConditionChange`). Nothing patches alert rows into
// this cache, `refetchOnWindowFocus` is off, and `useAlertsList` has no
// unconditional `refetchInterval` — so an admin who raises a threshold and
// closes twelve episodes keeps watching all twelve render as firing until
// something else invalidates them. Hence `queryKeys.alerts.all` in
// `useUpdateAlertRule`.
//
// Built to the same bar as the block above and for the same reason: asserting
// `invalidateQueries` was called with `queryKeys.alerts.all` would be
// tautological, since the hook and the test would be reading the same constant
// and the assertion would pass even if invalidating that key refetched nothing.
// So a real QueryClient holds a real, mounted, observed ALERTS list; the fake
// alerts API is backed by mutable server state that the rule update mutates the
// way the route does; and the assertion is that the rendered alerts changed.

type FakeAlert = { _id: string; rule_id: string; status: 'firing' | 'resolved' };

/**
 * A stand-in alerts API over mutable state. `list` serves only OPEN episodes,
 * which is what `GET /api/v2/alerts` defaults to — so an episode the rule edit
 * closed disappears from the list exactly as it would in the app.
 */
function seedAlertServer(initial: FakeAlert[]) {
  const server = { alerts: initial };

  (v2Api.alerts.list as jest.Mock).mockImplementation(async () => {
    const open = server.alerts.filter(alert => alert.status !== 'resolved');
    return { data: open, pagination: { total: open.length } };
  });

  return server;
}

/**
 * The rule edit as the server actually performs it: the rule changes AND every
 * open episode of that rule closes. Wiring only the rule half would make the
 * alerts list unable to change, and the test would prove nothing.
 */
function seedConditionChangingUpdate(ruleServer: { rules: FakeRule[] }, alertServer: { alerts: FakeAlert[] }) {
  (v2Api.alertRules.update as jest.Mock).mockImplementation(
    async (id: string, data: Record<string, unknown>) => {
      ruleServer.rules = ruleServer.rules.map(rule =>
        rule._id === id ? { ...rule, ...data } : rule
      );
      alertServer.alerts = alertServer.alerts.map(alert =>
        alert.rule_id === id && alert.status !== 'resolved'
          ? { ...alert, status: 'resolved' as const }
          : alert
      );
      return { data: ruleServer.rules.find(rule => rule._id === id) };
    }
  );
}

function useAlertAndRuleSurfaces() {
  return {
    alerts: useAlertsList(),
    rules: useAlertRulesList(),
    update: useUpdateAlertRule(),
  };
}

function alertListCalls() {
  return (v2Api.alerts.list as jest.Mock).mock.calls.length;
}

describe('updating a rule refreshes the mounted alert surfaces', () => {
  const OPEN_EPISODES: FakeAlert[] = [
    { _id: 'a1', rule_id: 'r1', status: 'firing' },
    { _id: 'a2', rule_id: 'r1', status: 'firing' },
  ];

  async function mountSettled() {
    const { wrapper: sharedWrapper } = makeSharedWrapper();
    const { result } = renderHook(() => useAlertAndRuleSurfaces(), { wrapper: sharedWrapper });

    await waitFor(() => {
      expect(result.current.rules.isSuccess).toBe(true);
      expect(result.current.alerts.isSuccess).toBe(true);
    });

    return result;
  }

  /**
   * The control. `useAlertsList` has a 30s staleTime and, with the socket
   * mocked as connected, no `refetchInterval` — so without this an increased
   * call count below could just be React Query refetching on its own.
   */
  it('should not refetch the alerts list on its own while nothing invalidates it', async () => {
    seedRuleServer([{ ...RULE_ONE }]);
    seedAlertServer(OPEN_EPISODES.map(alert => ({ ...alert })));

    const result = await mountSettled();
    const before = alertListCalls();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(alertListCalls()).toBe(before);
    expect(result.current.alerts.data).toHaveLength(2);
  });

  it('should refetch the alerts list after a rule update, dropping the episodes it closed', async () => {
    const ruleServer = seedRuleServer([{ ...RULE_ONE }]);
    const alertServer = seedAlertServer(OPEN_EPISODES.map(alert => ({ ...alert })));
    seedConditionChangingUpdate(ruleServer, alertServer);

    const result = await mountSettled();
    const before = alertListCalls();
    expect(result.current.alerts.data).toHaveLength(2);

    await act(async () => {
      result.current.update.mutate({
        id: 'r1',
        data: {
          metric: 'value',
          comparison: 'gt',
          threshold: 99,
          selector: { types: ['temperature'] },
        },
      });
    });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));

    await waitFor(() => expect(result.current.alerts.data).toEqual([]));
    expect(alertListCalls()).toBeGreaterThan(before);
  });
});
