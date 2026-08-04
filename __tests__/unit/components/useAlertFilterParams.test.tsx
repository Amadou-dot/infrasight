/**
 * useAlertFilterParams Tests
 *
 * Mirrors __tests__/unit/lib/useDeviceFilterParams.test.tsx: `push` records the
 * URL and updates what `useSearchParams` returns, so the hook's read path and
 * write path are exercised against each other exactly as they are in the
 * browser. next/navigation is mocked in full — no Suspense boundary is needed
 * here because the hook is exercised directly via renderHook, not through a
 * page render.
 *
 * Three behavioral rules are pinned deliberately hard, per the task brief:
 *  1. setStatus/setSeverity reset page to 1 IN THE SAME URL write — asserted by
 *     starting on page 3 (not page 1, which would make the assertion vacuous)
 *     and checking the pushed URL has no page param at all.
 *  2. Default values are omitted from the query string — asserted by parsing
 *     the pushed URL and checking `.has(key)` is false, not just that the
 *     hook's return value equals the default.
 *  3. Unparseable values fall back to defaults — using genuinely unparseable
 *     input ('banana' for a number, 'purple' for an enum), not merely absent
 *     input.
 */

import { act, renderHook } from '@testing-library/react';
import { useAlertFilterParams } from '@/components/alerts/useAlertFilterParams';

const pushHistory: string[] = [];
let currentSearch = '';

const push = jest.fn((url: string) => {
  pushHistory.push(url);
  currentSearch = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/alerts',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

/** Simulates a back/forward navigation, which changes the URL without a push. */
function navigateTo(search: string) {
  currentSearch = search;
}

/** Parses the query string out of the most recent push call. */
function lastPushedQuery(): URLSearchParams {
  const [url] = push.mock.calls.at(-1) ?? [];
  if (!url) throw new Error('push was not called');
  const queryIndex = url.indexOf('?');
  return new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1));
}

beforeEach(() => {
  pushHistory.length = 0;
  currentSearch = '';
  push.mockClear();
});

describe('useAlertFilterParams', () => {
  describe('reading state from the URL', () => {
    it('should default to open/all/page-1 when the URL is bare', () => {
      const { result } = renderHook(() => useAlertFilterParams());

      expect(result.current.status).toBe('open');
      expect(result.current.severity).toBe('all');
      expect(result.current.page).toBe(1);
    });

    it('should restore a filtered view from a shared link', () => {
      navigateTo('status=resolved&severity=critical&page=3');

      const { result } = renderHook(() => useAlertFilterParams());

      expect(result.current.status).toBe('resolved');
      expect(result.current.severity).toBe('critical');
      expect(result.current.page).toBe(3);
    });

    // --- Rule 3: unparseable values fall back to defaults ---------------

    it('should fall back to page 1 for a genuinely unparseable page', () => {
      navigateTo('page=banana');

      const { result } = renderHook(() => useAlertFilterParams());

      expect(result.current.page).toBe(1);
    });

    it('should fall back to page 1 for an out-of-range page', () => {
      navigateTo('page=0');

      const { result } = renderHook(() => useAlertFilterParams());

      expect(result.current.page).toBe(1);
    });

    it('should fall back to "all" for an unrecognized severity rather than passing it through', () => {
      navigateTo('severity=purple');

      const { result } = renderHook(() => useAlertFilterParams());

      expect(result.current.severity).toBe('all');
    });

    it('should fall back to "open" for an unrecognized status rather than passing it through', () => {
      navigateTo('status=bogus');

      const { result } = renderHook(() => useAlertFilterParams());

      expect(result.current.status).toBe('open');
    });
  });

  describe('writing state to the URL', () => {
    it('should put the selected status in the URL', () => {
      const { result } = renderHook(() => useAlertFilterParams());

      act(() => result.current.setStatus('firing'));

      expect(push).toHaveBeenCalledWith('/alerts?status=firing', { scroll: false });
    });

    it('should put the selected severity in the URL', () => {
      const { result } = renderHook(() => useAlertFilterParams());

      act(() => result.current.setSeverity('critical'));

      expect(push).toHaveBeenCalledWith('/alerts?severity=critical', { scroll: false });
    });

    it('should put an explicit page in the URL', () => {
      const { result } = renderHook(() => useAlertFilterParams());

      act(() => result.current.setPage(5));

      expect(push).toHaveBeenCalledWith('/alerts?page=5', { scroll: false });
    });

    it('should keep the current status/severity when only the page changes', () => {
      navigateTo('status=firing&severity=warning');
      const { result } = renderHook(() => useAlertFilterParams());

      act(() => result.current.setPage(2));

      expect(push).toHaveBeenCalledWith('/alerts?status=firing&severity=warning&page=2', {
        scroll: false,
      });
    });

    it('should return to a bare path when the only non-default filter is reset', () => {
      navigateTo('status=firing');
      const { result } = renderHook(() => useAlertFilterParams());

      act(() => result.current.setStatus('open'));

      expect(push).toHaveBeenCalledWith('/alerts', { scroll: false });
    });

    // --- Rule 2: defaults are omitted from the query string --------------
    // Asserted by parsing the pushed URL and checking for ABSENCE of the key,
    // not merely that result.current.<field> equals the default value.

    it('should never write "status=open" or "severity=all" to the URL', () => {
      const { result } = renderHook(() => useAlertFilterParams());

      act(() => result.current.setPage(2));

      const query = lastPushedQuery();
      expect(query.has('status')).toBe(false);
      expect(query.has('severity')).toBe(false);
      expect(query.get('page')).toBe('2');
    });

    it('should never write "page=1" to the URL', () => {
      navigateTo('page=4');
      const { result } = renderHook(() => useAlertFilterParams());

      act(() => result.current.setStatus('firing'));

      const query = lastPushedQuery();
      expect(query.has('page')).toBe(false);
      expect(query.get('status')).toBe('firing');
    });

    // --- Rule 1: page resets to 1 in the SAME url write as a filter change --
    // Deliberately starts on page 3 (not page 1) so the assertion is not
    // vacuous — if the reset were missing, the pushed URL would contain
    // "page=3" and this would fail.

    it('should reset page to 1 in the same write when status changes, starting from page 3', () => {
      navigateTo('page=3');
      const { result } = renderHook(() => useAlertFilterParams());
      expect(result.current.page).toBe(3);

      act(() => result.current.setStatus('firing'));

      expect(push).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith('/alerts?status=firing', { scroll: false });
      const query = lastPushedQuery();
      expect(query.has('page')).toBe(false);
    });

    it('should reset page to 1 in the same write when severity changes, starting from page 3', () => {
      navigateTo('page=3');
      const { result } = renderHook(() => useAlertFilterParams());
      expect(result.current.page).toBe(3);

      act(() => result.current.setSeverity('warning'));

      expect(push).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith('/alerts?severity=warning', { scroll: false });
      const query = lastPushedQuery();
      expect(query.has('page')).toBe(false);
    });

    it('should preserve an already-selected severity when status changes, dropping page 3 to 1', () => {
      navigateTo('severity=critical&page=3');
      const { result } = renderHook(() => useAlertFilterParams());

      act(() => result.current.setStatus('acknowledged'));

      expect(push).toHaveBeenCalledWith('/alerts?status=acknowledged&severity=critical', {
        scroll: false,
      });
    });
  });

  describe('initialFilters seeding', () => {
    it('should seed status from initialFilters when the URL does not specify one', () => {
      const { result } = renderHook(() => useAlertFilterParams({ status: 'firing' }));

      expect(result.current.status).toBe('firing');
    });

    it('should let an explicit URL parameter win over initialFilters', () => {
      navigateTo('status=resolved');

      const { result } = renderHook(() => useAlertFilterParams({ status: 'firing' }));

      expect(result.current.status).toBe('resolved');
    });
  });
});
