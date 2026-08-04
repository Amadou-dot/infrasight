'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ListAlertsQueryParams } from '@/types/v2';

const STATUS_VALUES = ['open', 'firing', 'acknowledged', 'resolved'] as const;
const SEVERITY_VALUES = ['all', 'critical', 'warning', 'info'] as const;

const DEFAULT_STATUS = 'open';
const DEFAULT_SEVERITY = 'all';

function isValidStatus(value: string): boolean {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

function isValidSeverity(value: string): boolean {
  return (SEVERITY_VALUES as readonly string[]).includes(value);
}

interface UrlState {
  status: string;
  severity: string;
  page: number;
}

export interface AlertFilterParams {
  status: string; // 'open' (default) | 'firing' | 'acknowledged' | 'resolved'
  severity: string; // 'all' (default) | 'critical' | 'warning' | 'info'
  page: number; // 1-based
  setStatus: (value: string) => void;
  setSeverity: (value: string) => void;
  setPage: (page: number) => void;
}

function buildQueryString({ status, severity, page }: UrlState): string {
  const params = new URLSearchParams();

  if (status !== DEFAULT_STATUS) params.set('status', status);
  if (severity !== DEFAULT_SEVERITY) params.set('severity', severity);
  if (page > 1) params.set('page', String(page));

  return params.toString();
}

/**
 * Keeps the alert list's status filter, severity filter, and page in the URL
 * so a filtered view is a shareable link and browser back steps through
 * filter changes — the same contract as
 * app/devices/_components/useDeviceFilterParams.ts.
 *
 * The URL is the single source of truth — nothing writes derived state back
 * into it, so there is no round-trip loop.
 *
 * `initialFilters` seeds only what the URL does not already specify; an
 * explicit URL parameter always wins, or a shared link would not survive the
 * first render.
 */
export function useAlertFilterParams(
  initialFilters: Partial<ListAlertsQueryParams> = {}
): AlertFilterParams {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const seedStatus =
    typeof initialFilters.status === 'string' && isValidStatus(initialFilters.status)
      ? initialFilters.status
      : DEFAULT_STATUS;

  const seedSeverity =
    typeof initialFilters.severity === 'string' && isValidSeverity(initialFilters.severity)
      ? initialFilters.severity
      : DEFAULT_SEVERITY;

  const status = useMemo(() => {
    const raw = searchParams.get('status');
    if (raw === null) return seedStatus;
    return isValidStatus(raw) ? raw : DEFAULT_STATUS;
  }, [searchParams, seedStatus]);

  const severity = useMemo(() => {
    const raw = searchParams.get('severity');
    if (raw === null) return seedSeverity;
    return isValidSeverity(raw) ? raw : DEFAULT_SEVERITY;
  }, [searchParams, seedSeverity]);

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

  const setStatus = useCallback(
    (nextStatus: string) => navigate({ status: nextStatus, severity, page: 1 }),
    [navigate, severity]
  );

  const setSeverity = useCallback(
    (nextSeverity: string) => navigate({ status, severity: nextSeverity, page: 1 }),
    [navigate, status]
  );

  const setPage = useCallback(
    (nextPage: number) => navigate({ status, severity, page: nextPage }),
    [navigate, status, severity]
  );

  return { status, severity, page, setStatus, setSeverity, setPage };
}

export default useAlertFilterParams;
