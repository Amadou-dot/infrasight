### Task 12: API client, React Query hooks, and a correct severity sort

**Files:**
- Modify: `app/api/v2/alerts/route.ts` (Step 0 — make `sortBy=severity` order by urgency)
- Modify: `__tests__/integration/api/alerts.integration.test.ts` (Step 0 — replace the test that pins the lexical order)
- Modify: `lib/api/v2-client.ts`
- Modify: `lib/query/queryClient.ts`
- Create: `lib/query/hooks/useAlerts.ts`
- Create: `lib/query/hooks/useAlertRules.ts`
- Modify: `lib/query/hooks/index.ts`
- Test: `__tests__/unit/lib/v2-client-alerts.test.ts`
- Test: `__tests__/unit/lib/useAlerts.test.tsx` — **`.tsx`, not `.ts`** (see Step 6)

**Interfaces:**
- Consumes: wire types from `@/types/v2` (Task 3); the routes from Tasks 10–11.
- Produces:
  - `v2Api.alerts.list(query)`, `.getById(id, options)`, `.acknowledge(id, note?)`, `.resolve(id, note?)`
  - `v2Api.alertRules.list(query)`, `.getById(id)`, `.create(data)`, `.update(id, data)`, `.delete(id)`
  - `queryKeys.alerts.all` / `.list(filters)` / `.detail(id)`; `queryKeys.alertRules.all` / `.list(filters)` / `.detail(id)`
  - `useAlertsList(filters, config)`, `useAlertDetail(id, options, config)`, `useOpenAlertCount()`, `useAcknowledgeAlert()`, `useResolveAlert()`
  - `useAlertRulesList(filters, config)`, `useAlertRuleDetail(id, config)`, `useCreateAlertRule()`, `useUpdateAlertRule()`, `useDeleteAlertRule()`

- [ ] **Step 0: Make `sortBy=severity` order by urgency**

`SORT_FIELD_MAP.severity` maps to the raw string field (`app/api/v2/alerts/route.ts:43`), so Mongo sorts it **lexically**: `critical` < `info` < `warning`. Descending — what a caller means by "most severe first" — therefore returns **warning → info → critical**, with critical dead last. Task 18's dashboard widget asks for exactly this sort, and Task 12 is where the client first exposes `sortBy: 'severity'` to callers, so the contract is made true here, before anything depends on it. Human ruling: fix the API rather than work around it in one component.

Keep `.find()` for every other sort field; branch only for `severity`:

```typescript
/** Urgency rank. Mongo sorts the raw string lexically, which puts `critical` last. */
const SEVERITY_RANK = {
  $switch: {
    branches: [
      { case: { $eq: ['$severity', 'critical'] }, then: 3 },
      { case: { $eq: ['$severity', 'warning'] }, then: 2 },
    ],
    default: 1, // info
  },
};
```

```typescript
    const direction: 1 | -1 = query.sortDirection === 'asc' ? 1 : -1;

    const alertsQuery =
      query.sortBy === 'severity'
        ? AlertV2.aggregate([
            { $match: filter },
            { $addFields: { _severity_rank: SEVERITY_RANK } },
            // fired_at breaks ties so paging is stable within a severity band.
            { $sort: { _severity_rank: direction, fired_at: -1 } },
            { $skip: pagination.skip },
            { $limit: pagination.limit },
            { $project: { __v: 0, _severity_rank: 0 } },
          ])
        : AlertV2.find(filter)
            .select('-__v')
            .sort(sort)
            .skip(pagination.skip)
            .limit(pagination.limit)
            .lean();

    const [alerts, total] = await Promise.all([alertsQuery, AlertV2.countDocuments(filter)]);
```

`aggregate()` already returns plain objects, so the response shape is identical to the `.lean()` path — no other part of the handler changes.

**Replace the test that pins the old behaviour.** `__tests__/integration/api/alerts.integration.test.ts` has `it('should sort by severity, not silently fall back to created_at')`, whose comment documents the lexical order as "an oddity, not a bug to fix here". It is being fixed here, so update the assertion **and** that comment. Keep the fixture's most valuable property: its three `audit.created_at` values are chosen so a collapsed `SORT_FIELD_MAP` falling back to `created_at` could not coincidentally satisfy the assertion. That still holds after the change —

| Order | Result |
| --- | --- |
| severity desc (**the fix**) | `device_crit`, `device_warn`, `device_info` |
| created_at desc (fallback) | `device_info`, `device_crit`, `device_warn` |
| created_at asc (fallback) | `device_warn`, `device_crit`, `device_info` |

— so change the expectation to `['device_crit', 'device_warn', 'device_info']` and keep the three distinct timestamps. Add one more case asserting `sortDirection: 'asc'` returns `['device_info', 'device_warn', 'device_crit']`, so the rank is proven to be ordered rather than merely different from lexical.

- [ ] **Step 1: Add the query keys**

In `lib/query/queryClient.ts`, add to the `queryKeys` object:

```typescript
  alerts: {
    all: ['alerts'] as const,
    list: (filters?: Record<string, unknown>) => ['alerts', 'list', filters] as const,
    detail: (id: string) => ['alerts', 'detail', id] as const,
  },
  alertRules: {
    all: ['alert-rules'] as const,
    list: (filters?: Record<string, unknown>) => ['alert-rules', 'list', filters] as const,
    detail: (id: string) => ['alert-rules', 'detail', id] as const,
  },
```

- [ ] **Step 2: Write the failing client test**

Create `__tests__/unit/lib/v2-client-alerts.test.ts`:

```typescript
/**
 * V2 API Client — Alerts and Alert Rules
 */

import { alertsApi, alertRulesApi } from '@/lib/api/v2-client';

const originalFetch = global.fetch;

function mockJson(data: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => ({ success: status < 400, data, timestamp: new Date().toISOString() }),
  }) as unknown as typeof fetch;
}

function calledUrl(): string {
  return (global.fetch as jest.Mock).mock.calls[0][0] as string;
}

function calledInit(): RequestInit {
  return (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('alertsApi', () => {
  it('should build the list URL with filters', async () => {
    mockJson([]);
    await alertsApi.list({ status: 'firing', severity: 'critical', limit: 10 });

    const url = calledUrl();
    expect(url).toContain('/api/v2/alerts?');
    expect(url).toContain('status=firing');
    expect(url).toContain('severity=critical');
    expect(url).toContain('limit=10');
  });

  it('should request a single alert with include_device', async () => {
    mockJson({});
    await alertsApi.getById('507f1f77bcf86cd799439011', { include_device: true });

    expect(calledUrl()).toBe('/api/v2/alerts/507f1f77bcf86cd799439011?include_device=true');
  });

  it('should PATCH acknowledged', async () => {
    mockJson({});
    await alertsApi.acknowledge('507f1f77bcf86cd799439011');

    expect(calledInit().method).toBe('PATCH');
    expect(JSON.parse(calledInit().body as string)).toEqual({ status: 'acknowledged' });
  });

  it('should PATCH resolved with a note', async () => {
    mockJson({});
    await alertsApi.resolve('507f1f77bcf86cd799439011', 'Swapped sensor');

    expect(JSON.parse(calledInit().body as string)).toEqual({
      status: 'resolved',
      note: 'Swapped sensor',
    });
  });
});

describe('alertRulesApi', () => {
  it('should POST a new rule', async () => {
    mockJson({});
    await alertRulesApi.create({
      name: 'R',
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      severity: 'warning',
      selector: { types: ['temperature'] },
    });

    expect(calledUrl()).toBe('/api/v2/alert-rules');
    expect(calledInit().method).toBe('POST');
  });

  it('should DELETE a rule', async () => {
    mockJson({});
    await alertRulesApi.delete('507f1f77bcf86cd799439011');

    expect(calledUrl()).toBe('/api/v2/alert-rules/507f1f77bcf86cd799439011');
    expect(calledInit().method).toBe('DELETE');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/v2-client-alerts.test.ts`
Expected: FAIL — `alertsApi` is not exported.

- [ ] **Step 4: Add the client namespaces**

In `lib/api/v2-client.ts`, add the alert types to the existing `@/types/v2` import block (`AlertV2Response`, `AlertRuleV2Response`, `ListAlertsQueryParams`, `ListAlertRulesQueryParams`, `CreateAlertRuleBody`, `UpdateAlertRuleBody`), then add before the final `v2Api` object:

```typescript
// ============================================================================
// ALERTS API
// ============================================================================

export const alertsApi = {
  /**
   * List alerts. Defaults server-side to open alerts (firing + acknowledged);
   * `pending` is internal and is never returned.
   */
  async list(query: ListAlertsQueryParams = {}): Promise<PaginatedResponse<AlertV2Response>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/alerts${queryString}`);
  },

  async getById(
    id: string,
    options: { include_device?: boolean } = {}
  ): Promise<ApiSuccessResponse<AlertV2Response>> {
    const queryString = buildQueryString(options as Record<string, unknown>);
    return apiCall(`/api/v2/alerts/${id}${queryString}`);
  },

  async acknowledge(id: string, note?: string): Promise<ApiSuccessResponse<AlertV2Response>> {
    return apiCall(`/api/v2/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'acknowledged', ...(note ? { note } : {}) }),
    });
  },

  async resolve(id: string, note?: string): Promise<ApiSuccessResponse<AlertV2Response>> {
    return apiCall(`/api/v2/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', ...(note ? { note } : {}) }),
    });
  },
};

// ============================================================================
// ALERT RULES API
// ============================================================================

export const alertRulesApi = {
  async list(
    query: ListAlertRulesQueryParams = {}
  ): Promise<PaginatedResponse<AlertRuleV2Response>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/alert-rules${queryString}`);
  },

  async getById(id: string): Promise<ApiSuccessResponse<AlertRuleV2Response>> {
    return apiCall(`/api/v2/alert-rules/${id}`);
  },

  async create(data: CreateAlertRuleBody): Promise<ApiSuccessResponse<AlertRuleV2Response>> {
    return apiCall('/api/v2/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async update(
    id: string,
    data: UpdateAlertRuleBody
  ): Promise<ApiSuccessResponse<AlertRuleV2Response>> {
    return apiCall(`/api/v2/alert-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async delete(
    id: string
  ): Promise<ApiSuccessResponse<{ _id: string; deleted: boolean; deleted_at?: string }>> {
    return apiCall(`/api/v2/alert-rules/${id}`, { method: 'DELETE' });
  },
};
```

Add `alerts: alertsApi,` and `alertRules: alertRulesApi,` to the exported `v2Api` object.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/v2-client-alerts.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the failing hooks test**

Create `__tests__/unit/lib/useAlerts.test.tsx`.

**The `.tsx` extension is load-bearing, not cosmetic.** `jest.config.js` routes `**/__tests__/**/*.test.ts` to the **node** project and `**/__tests__/**/*.test.tsx` to the **jsdom** project. `renderHook` needs a DOM, so naming this file `.ts` puts it in node and it fails with no `document`.

Model it on `__tests__/unit/lib/useDeviceDetail.test.tsx` — the repo's precedent for a hook test with a real `QueryClient`. It opens with a `/** @jest-environment jsdom */` docblock; that is redundant once the extension is `.tsx`, but harmless and consistent, so keep it.

Do **not** model this on `__tests__/unit/lib/useSchedules.test.ts`, despite the sibling naming. That file has no `QueryClientProvider` at all — it replaces `@tanstack/react-query` wholesale with a mock that captures the arguments handed to `useQuery`/`useMutation`. That asserts what you passed React Query, not what React Query does with it, and cannot catch a broken `enabled` guard or a mis-wired `onSuccess`. Use a real `QueryClient` here.

```typescript
/**
 * useAlerts Hook Tests
 *
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAlertsList, useAlertDetail, useAcknowledgeAlert, useResolveAlert } from '@/lib/query/hooks/useAlerts';
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
```

Add a `useOpenAlertCount` block too. It must assert the two properties that make the hook worth having, or it is only testing React Query:

```typescript
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
```

The first case is the one that matters: `data.length` is 1 and `total` is 143, so a hook that counted the array would return 1 and fail. Do not make them equal — that is exactly the shape of test that passes for the wrong reason.

- [ ] **Step 7: Write the hooks**

Create `lib/query/hooks/useAlerts.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig, MutationConfig } from '../types';
import type { AlertV2Response, ListAlertsQueryParams } from '@/types/v2';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * List alerts. Short staleTime: the list changes on every ingest and is patched
 * live by usePusherAlerts, so React Query is the fallback rather than the driver.
 */
export function useAlertsList(
  filters: ListAlertsQueryParams = {},
  config?: QueryConfig<AlertV2Response[]>
) {
  return useQuery({
    queryKey: queryKeys.alerts.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.alerts.list(filters);
      return response.data;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

export function useAlertDetail(
  id: string,
  options: { include_device?: boolean } = {},
  config?: QueryConfig<AlertV2Response>
) {
  return useQuery({
    queryKey: queryKeys.alerts.detail(id),
    queryFn: async () => {
      const response = await v2Api.alerts.getById(id, options);
      return response.data;
    },
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

/**
 * Count of open alerts, for the nav badge.
 *
 * Reads `pagination.total` off a one-row page rather than counting a fetched
 * array. Counting `data.length` would be wrong twice over: the API caps `limit`
 * at 100 (`lib/validations/common.validation.ts:17`), so a real storm would
 * display a frozen "100"; and TopNav renders on every route, so it would pull
 * 100 full alert documents on every navigation to render one number.
 */
export function useOpenAlertCount(config?: QueryConfig<number>) {
  return useQuery({
    queryKey: queryKeys.alerts.list({ count: true }),
    queryFn: async () => {
      // No `status` filter — the server defaults to open (firing + acknowledged).
      const response = await v2Api.alerts.list({ limit: 1 });
      return response.pagination.total;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useAcknowledgeAlert(
  config?: MutationConfig<AlertV2Response, { id: string; note?: string }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const response = await v2Api.alerts.acknowledge(id, note);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
    ...config,
  });
}

export function useResolveAlert(
  config?: MutationConfig<AlertV2Response, { id: string; note?: string }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const response = await v2Api.alerts.resolve(id, note);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
    ...config,
  });
}
```

Create `lib/query/hooks/useAlertRules.ts` following the same shape, with `useAlertRulesList(filters, config)`, `useAlertRuleDetail(id, config)`, `useCreateAlertRule()`, `useUpdateAlertRule()` (variables `{ id, data }`), and `useDeleteAlertRule()` (variables `id: string`). Rules change almost never, so use `staleTime: 5 * 60 * 1000`. Every mutation invalidates `queryKeys.alertRules.all`, and `useUpdateAlertRule` / `useDeleteAlertRule` also invalidate `queryKeys.alertRules.detail(id)`.

Add both to `lib/query/hooks/index.ts`:

```typescript
export * from './useAlerts';
export * from './useAlertRules';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test __tests__/unit/lib/useAlerts.test.tsx __tests__/unit/lib/v2-client-alerts.test.ts __tests__/integration/api/alerts.integration.test.ts`
Expected: PASS, including the two rewritten severity-sort cases from Step 0.

Then the full gates: `npx tsc --noEmit && pnpm lint`
Expected: 0 errors, 0 problems.

- [ ] **Step 9: Commit**

Two commits — the API fix is independently reviewable and independently revertable, and it is the only change here that alters server behaviour:

```bash
git add app/api/v2/alerts/route.ts __tests__/integration/api/alerts.integration.test.ts
git commit -m "fix(alerting): sort alerts by severity rank, not lexically"

git add lib/api/v2-client.ts lib/query/queryClient.ts lib/query/hooks/useAlerts.ts lib/query/hooks/useAlertRules.ts lib/query/hooks/index.ts __tests__/unit/lib/v2-client-alerts.test.ts __tests__/unit/lib/useAlerts.test.tsx
git commit -m "feat(alerting): add alerts API client and React Query hooks"
```

---

