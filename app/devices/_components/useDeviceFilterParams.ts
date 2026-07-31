'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DeviceFilters } from './DeviceFilterModal';

/** How long typing settles before the search term becomes a history entry. */
export const SEARCH_DEBOUNCE_MS = 300;

const FILTER_KEYS = ['status', 'type', 'manufacturer', 'department'] as const;

interface UrlState {
  q: string;
  floor: number | 'all';
  filters: DeviceFilters;
  page: number;
}

export interface DeviceFilterParams extends UrlState {
  /** Uncommitted search box value; mirrors `q` once typing settles. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  setFloor: (floor: number | 'all') => void;
  setFilters: (filters: DeviceFilters) => void;
  setPage: (page: number) => void;
}

function buildQueryString({ q, floor, filters, page }: UrlState): string {
  const params = new URLSearchParams();

  if (q) params.set('q', q);
  if (floor !== 'all') params.set('floor', String(floor));
  FILTER_KEYS.forEach(key => filters[key].forEach(value => params.append(key, value)));
  if (page > 1) params.set('page', String(page));

  return params.toString();
}

/**
 * Keeps the device list's search, floor, advanced filters, and page in the URL so a
 * filtered view is a shareable link and browser back steps through changes.
 *
 * The URL is the single source of truth — nothing writes derived state back into it,
 * so there is no round-trip loop. Device data itself is fetched once and filtered
 * client-side, so navigating never triggers a refetch.
 */
export function useDeviceFilterParams(): DeviceFilterParams {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const q = searchParams.get('q') ?? '';

  const floor = useMemo(() => {
    const raw = searchParams.get('floor');
    if (raw === null || !/^-?\d+$/.test(raw)) return 'all' as const;
    return Number(raw);
  }, [searchParams]);

  const filters = useMemo<DeviceFilters>(
    () => ({
      status: searchParams.getAll('status'),
      type: searchParams.getAll('type'),
      manufacturer: searchParams.getAll('manufacturer'),
      department: searchParams.getAll('department'),
    }),
    [searchParams]
  );

  const page = useMemo(() => {
    const raw = Number(searchParams.get('page'));
    return Number.isInteger(raw) && raw > 0 ? raw : 1;
  }, [searchParams]);

  const navigate = useCallback(
    (next: UrlState) => {
      const queryString = buildQueryString(next);
      router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  const [searchInput, setSearchInput] = useState(q);
  // Tracks the last search term this hook put in the URL, so a URL update we caused
  // does not overwrite characters typed while the navigation was in flight.
  const committedSearchRef = useRef(q);

  // Adopt search terms that arrive from the URL rather than the search box:
  // back/forward navigation, or a shared link opened directly.
  useEffect(() => {
    if (q === committedSearchRef.current) return;
    committedSearchRef.current = q;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: the URL is the source of truth for the committed search term
    setSearchInput(q);
  }, [q]);

  // Commit typing to the URL once it settles, so a burst of keystrokes is one history entry.
  useEffect(() => {
    if (searchInput === q) return;

    const timeout = setTimeout(() => {
      committedSearchRef.current = searchInput;
      navigate({ q: searchInput, floor, filters, page: 1 });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [searchInput, q, floor, filters, navigate]);

  const setFloor = useCallback(
    (nextFloor: number | 'all') => navigate({ q, floor: nextFloor, filters, page: 1 }),
    [navigate, q, filters]
  );

  const setFilters = useCallback(
    (nextFilters: DeviceFilters) => navigate({ q, floor, filters: nextFilters, page: 1 }),
    [navigate, q, floor]
  );

  const setPage = useCallback(
    (nextPage: number) => navigate({ q, floor, filters, page: nextPage }),
    [navigate, q, floor, filters]
  );

  return {
    q,
    floor,
    filters,
    page,
    searchInput,
    setSearchInput,
    setFloor,
    setFilters,
    setPage,
  };
}
