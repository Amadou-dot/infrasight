/**
 * Alert / alert-rule query key invalidation coverage
 *
 * Guards a coupling that is load-bearing and completely invisible at the call
 * site.
 *
 * Every alert and alert-rule mutation hook invalidates TWO keys — the specific
 * `.detail(id)` and the broad `.all`:
 *
 *   onSuccess: (_, variables) => {
 *     queryClient.invalidateQueries({ queryKey: queryKeys.alerts.detail(variables.id) });
 *     queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
 *   }
 *
 * Today the second line makes the first redundant. `queryKeys.alerts.all` is
 * `['alerts']`, `queryKeys.alerts.detail(id)` is `['alerts','detail',id]`, and
 * React Query matches `invalidateQueries` by key PREFIX (`exact: false` is the
 * default) — so invalidating `.all` already reaches every detail query. This
 * was verified by mutation testing: deleting either `.detail(...)` line on its
 * own leaves the whole alerting suite green, because its sibling covers it.
 *
 * The redundancy is not a property of the hooks. It is a property of the SHAPE
 * OF THE KEYS in `lib/query/queryClient.ts`. Namespace them, or make `.all`
 * something like `['alerts','root']`, and the relation silently inverts: `.all`
 * stops covering `.detail`, the `.detail` lines become the only thing keeping
 * an open detail pane honest, and nothing anywhere would say so. A subsystem
 * that cannot tell you when it has stopped working is the failure mode this
 * whole review is about, so it is pinned here rather than left implicit.
 *
 * Deliberately NOT a `jest.spyOn(queryClient, 'invalidateQueries')` assertion.
 * Spying on the call and comparing it to the same constant the hook reads is
 * tautological — it passes whether or not invalidating that key achieves
 * anything. These tests assert the key relation itself and then exercise React
 * Query's real matcher against it. The behavioural side (that the mutations
 * actually refetch mounted queries) lives in `useAlerts.test.tsx` and
 * `useAlertRules.test.tsx`.
 */

import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryClient';

/**
 * Returns 'ok', or an explanation of what broke and what it now costs.
 *
 * A string rather than a boolean so the failure output carries its own
 * briefing — `expect(covers).toBe(true)` would print "expected true, received
 * false", which tells the next person nothing about which production lines
 * just became load-bearing.
 */
function prefixCoverageDiagnosis(
  namespace: string,
  allKey: readonly unknown[],
  detailKey: readonly unknown[]
): string {
  const covers =
    allKey.length <= detailKey.length &&
    allKey.every((segment, index) => Object.is(segment, detailKey[index]));

  if (covers) return 'ok';

  return (
    `queryKeys.${namespace}.all (${JSON.stringify(allKey)}) is no longer a prefix of ` +
    `queryKeys.${namespace}.detail(id) (${JSON.stringify(detailKey)}). ` +
    'React Query matches invalidateQueries by key PREFIX, so the paired ' +
    `invalidateQueries({ queryKey: queryKeys.${namespace}.all }) call in the mutation hooks NO ` +
    'LONGER REACHES the detail query. The explicit ' +
    `invalidateQueries({ queryKey: queryKeys.${namespace}.detail(...) }) calls in those hooks are ` +
    'therefore now LOAD-BEARING — they were redundant only because of this prefix relation. ' +
    'Do NOT remove them. Add a behavioural test that a mounted detail query refetches after ' +
    'each mutation, then update this guard.'
  );
}

/** Seeds a detail query, invalidates via `.all`, and reports whether it landed. */
async function allInvalidationReachesDetail(
  allKey: readonly unknown[],
  detailKey: readonly unknown[]
): Promise<boolean> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await client.fetchQuery({ queryKey: detailKey as unknown[], queryFn: async () => 'seeded' });
  await client.invalidateQueries({ queryKey: allKey as unknown[] });

  const detail = client.getQueryCache().find({ queryKey: detailKey as unknown[] });
  return detail?.state.isInvalidated === true;
}

describe('queryKeys.alerts invalidation coverage', () => {
  it('should keep alerts.all a prefix of alerts.detail(id)', () => {
    expect(
      prefixCoverageDiagnosis('alerts', queryKeys.alerts.all, queryKeys.alerts.detail('alert_1'))
    ).toBe('ok');
  });

  /**
   * The prefix check explains WHY; this asserts the property itself, through
   * React Query's own matcher. It also fails if a React Query release changes
   * how `invalidateQueries` matches — which a structural check would miss.
   */
  it('should have an alerts.all invalidation actually reach an alerts.detail query', async () => {
    await expect(
      allInvalidationReachesDetail(queryKeys.alerts.all, queryKeys.alerts.detail('alert_1'))
    ).resolves.toBe(true);
  });
});

describe('queryKeys.alertRules invalidation coverage', () => {
  it('should keep alertRules.all a prefix of alertRules.detail(id)', () => {
    expect(
      prefixCoverageDiagnosis(
        'alertRules',
        queryKeys.alertRules.all,
        queryKeys.alertRules.detail('rule_1')
      )
    ).toBe('ok');
  });

  it('should have an alertRules.all invalidation actually reach an alertRules.detail query', async () => {
    await expect(
      allInvalidationReachesDetail(
        queryKeys.alertRules.all,
        queryKeys.alertRules.detail('rule_1')
      )
    ).resolves.toBe(true);
  });
});
