'use client';

import { useEffect, useState } from 'react';
import { ApiClientError, v2Api } from '@/lib/api/v2-client';
import type { DeviceV2Response, ReadingV2Response } from '@/types/v2';
import { MAX_CHART_POINTS } from '@/lib/utils/reading-display';

/** Entry shape expected by AuditLogViewer. */
export interface AuditLogEntry {
  timestamp: string;
  action: string;
  user: string;
  changes?: Record<string, unknown>;
}

export interface DeviceDetail {
  device: DeviceV2Response | null;
  /** Newest-first, up to MAX_CHART_POINTS readings from the 24h window. */
  recentReadings: ReadingV2Response[];
  auditLog: AuditLogEntry[];
  /** Server-reported total audit entry count; null until the audit fetch resolves. */
  auditTotal: number | null;
  /** Server-reported total readings in the 24h window; null until the readings fetch resolves. */
  readingsTotal: number | null;
  loading: boolean;
  error: string | null;
  /** True when the device id does not resolve, so callers can render a 404. */
  notFound: boolean;
}

/** Window of readings shown on the device detail surfaces. */
const READINGS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Chart cap ÷ server page max. Pages beyond this are reported via readingsTotal, not fetched. */
const MAX_READING_PAGES = MAX_CHART_POINTS / 100;

/**
 * Loads everything the device detail surfaces need: the device itself, its readings
 * for the last 24 hours, and its audit history.
 *
 * Shared by the quick-inspection modal and the canonical `/devices/[id]` page so the
 * two cannot drift apart.
 */
export function useDeviceDetail(deviceId: string | null, enabled = true): DeviceDetail {
  const [device, setDevice] = useState<DeviceV2Response | null>(null);
  const [recentReadings, setRecentReadings] = useState<ReadingV2Response[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState<number | null>(null);
  const [readingsTotal, setReadingsTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!deviceId || !enabled) {
      setDevice(null);
      setRecentReadings([]);
      setAuditLog([]);
      setAuditTotal(null);
      setReadingsTotal(null);
      setError(null);
      setNotFound(false);
      return;
    }

    const abortController = new AbortController();

    const fetchDeviceData = async () => {
      try {
        setLoading(true);
        setError(null);
        setNotFound(false);

        const deviceResponse = await v2Api.devices.getById(deviceId);
        if (abortController.signal.aborted) return;
        setDevice(deviceResponse.data);

        const now = new Date();
        const windowStart = new Date(now.getTime() - READINGS_WINDOW_MS);
        const readingsQuery = {
          device_id: deviceId,
          startDate: windowStart.toISOString(),
          endDate: now.toISOString(),
          limit: 100,
        };

        const firstPage = await v2Api.readings.list(readingsQuery);
        if (abortController.signal.aborted) return;
        if (firstPage.success && firstPage.data) {
          const readings = [...firstPage.data];
          const totalPages = Math.min(firstPage.pagination?.totalPages ?? 1, MAX_READING_PAGES);

          // Later pages are best-effort and sequential: stopping at the first failure
          // keeps the loaded window CONTIGUOUS (newest-first with no invisible hole in
          // the middle), and the panel heading reports the count actually shown.
          // eslint-disable-next-line curly
          for (let page = 2; page <= totalPages; page += 1) {
            try {
              const nextPage = await v2Api.readings.list({ ...readingsQuery, page });
              if (abortController.signal.aborted) return;
              if (!nextPage.success || !nextPage.data) break;
              readings.push(...nextPage.data);
            } catch {
              break;
            }
          }

          setRecentReadings(readings);
          setReadingsTotal(firstPage.pagination?.total ?? readings.length);
        }

        // Audit history is best-effort: it is admin-gated on some deployments, and a
        // missing audit panel should not fail the whole view.
        try {
          const auditResponse = await v2Api.devices.getHistory(deviceId, { limit: 100 });
          if (abortController.signal.aborted) return;
          if (auditResponse.success && auditResponse.data?.history) {
            const mappedEntries: AuditLogEntry[] = auditResponse.data.history.map(entry => ({
              timestamp: new Date(entry.timestamp).toISOString(),
              action: entry.action,
              user: entry.user,
              changes: entry.changes?.reduce(
                (acc, change) => {
                  acc[change.field] = { old: change.old_value, new: change.new_value };
                  return acc;
                },
                {} as Record<string, unknown>
              ),
            }));
            setAuditLog(mappedEntries);
            setAuditTotal(auditResponse.data.pagination?.total ?? null);
          }
        } catch (err) {
          if (abortController.signal.aborted) return;
          console.warn('Audit log not available:', err);
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        if (err instanceof ApiClientError && err.statusCode === 404) {
          setDevice(null);
          setNotFound(true);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load device details');
        console.error('Error fetching device data:', err);
      } finally {
        if (!abortController.signal.aborted) setLoading(false);
      }
    };

    fetchDeviceData();
    return () => abortController.abort();
  }, [deviceId, enabled]);

  return { device, recentReadings, auditLog, auditTotal, readingsTotal, loading, error, notFound };
}
