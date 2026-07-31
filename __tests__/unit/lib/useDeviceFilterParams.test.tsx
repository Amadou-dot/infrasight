/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
import {
  SEARCH_DEBOUNCE_MS,
  useDeviceFilterParams,
} from '@/app/devices/_components/useDeviceFilterParams';

/**
 * Minimal stand-in for the App Router: `push` records the URL and updates what
 * `useSearchParams` returns, so the hook's read path and write path are exercised
 * against each other exactly as they are in the browser.
 */
const pushHistory: string[] = [];
let currentSearch = '';

const push = jest.fn((url: string) => {
  pushHistory.push(url);
  currentSearch = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/devices',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

/** Simulates a back/forward navigation, which changes the URL without a push. */
function navigateTo(search: string) {
  currentSearch = search;
}

describe('useDeviceFilterParams', () => {
  beforeEach(() => {
    pushHistory.length = 0;
    currentSearch = '';
    push.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('reading state from the URL', () => {
    it('should default to no filters when the URL is bare', () => {
      const { result } = renderHook(() => useDeviceFilterParams());

      expect(result.current.q).toBe('');
      expect(result.current.floor).toBe('all');
      expect(result.current.page).toBe(1);
      expect(result.current.filters).toEqual({
        status: [],
        type: [],
        manufacturer: [],
        department: [],
      });
    });

    it('should restore a filtered view from a shared link', () => {
      navigateTo('q=lobby&floor=3&status=active&status=error&type=temperature&page=2');

      const { result } = renderHook(() => useDeviceFilterParams());

      expect(result.current.q).toBe('lobby');
      expect(result.current.searchInput).toBe('lobby');
      expect(result.current.floor).toBe(3);
      expect(result.current.page).toBe(2);
      expect(result.current.filters.status).toEqual(['active', 'error']);
      expect(result.current.filters.type).toEqual(['temperature']);
    });

    it('should ignore a non-numeric floor rather than filtering on NaN', () => {
      navigateTo('floor=mezzanine');

      const { result } = renderHook(() => useDeviceFilterParams());

      expect(result.current.floor).toBe('all');
    });

    it('should ignore an out-of-range page', () => {
      navigateTo('page=0');

      const { result } = renderHook(() => useDeviceFilterParams());

      expect(result.current.page).toBe(1);
    });
  });

  describe('writing state to the URL', () => {
    it('should put the selected floor in the URL', () => {
      const { result } = renderHook(() => useDeviceFilterParams());

      act(() => result.current.setFloor(2));

      expect(push).toHaveBeenCalledWith('/devices?floor=2', { scroll: false });
    });

    it('should encode multi-valued filters as repeated params', () => {
      const { result } = renderHook(() => useDeviceFilterParams());

      act(() =>
        result.current.setFilters({
          status: ['active', 'offline'],
          type: [],
          manufacturer: ['Acme'],
          department: [],
        })
      );

      expect(push).toHaveBeenCalledWith('/devices?status=active&status=offline&manufacturer=Acme', {
        scroll: false,
      });
    });

    it('should drop the page when filters change so results are not skipped', () => {
      navigateTo('page=4');
      const { result } = renderHook(() => useDeviceFilterParams());

      act(() => result.current.setFloor(1));

      expect(push).toHaveBeenCalledWith('/devices?floor=1', { scroll: false });
    });

    it('should keep filters when only the page changes', () => {
      navigateTo('q=hvac&floor=2');
      const { result } = renderHook(() => useDeviceFilterParams());

      act(() => result.current.setPage(3));

      expect(push).toHaveBeenCalledWith('/devices?q=hvac&floor=2&page=3', { scroll: false });
    });

    it('should return to a bare path when everything is cleared', () => {
      navigateTo('floor=2');
      const { result } = renderHook(() => useDeviceFilterParams());

      act(() => result.current.setFloor('all'));

      expect(push).toHaveBeenCalledWith('/devices', { scroll: false });
    });
  });

  describe('search box', () => {
    it('should commit a burst of typing as a single history entry', () => {
      const { result, rerender } = renderHook(() => useDeviceFilterParams());

      act(() => result.current.setSearchInput('l'));
      act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50));
      act(() => result.current.setSearchInput('lo'));
      act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50));
      act(() => result.current.setSearchInput('lobby'));

      expect(push).not.toHaveBeenCalled();

      act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      rerender();

      expect(push).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith('/devices?q=lobby', { scroll: false });
      expect(result.current.searchInput).toBe('lobby');
    });

    it('should not push again once the URL matches the input', () => {
      const { result, rerender } = renderHook(() => useDeviceFilterParams());

      act(() => result.current.setSearchInput('lobby'));
      act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      rerender();
      act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 4));
      rerender();

      expect(push).toHaveBeenCalledTimes(1);
    });

    it('should adopt a search term that arrives from browser back', () => {
      navigateTo('q=lobby');
      const { result, rerender } = renderHook(() => useDeviceFilterParams());
      expect(result.current.searchInput).toBe('lobby');

      navigateTo('');
      rerender();

      expect(result.current.searchInput).toBe('');

      // Adopting the URL value must not bounce a push back at the router.
      act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 4));
      expect(push).not.toHaveBeenCalled();
    });

    it('should clear the search term from the URL when the box is emptied', () => {
      navigateTo('q=lobby');
      const { result, rerender } = renderHook(() => useDeviceFilterParams());

      act(() => result.current.setSearchInput(''));
      act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      rerender();

      expect(push).toHaveBeenCalledWith('/devices', { scroll: false });
    });

    it('should preserve the other filters when committing a search term', () => {
      navigateTo('floor=2&status=active');
      const { result, rerender } = renderHook(() => useDeviceFilterParams());

      act(() => result.current.setSearchInput('hvac'));
      act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      rerender();

      expect(push).toHaveBeenCalledWith('/devices?q=hvac&floor=2&status=active', {
        scroll: false,
      });
    });
  });
});
