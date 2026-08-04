'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDetailView } from '@/components/alerts/AlertDetailView';
import { useAlertDetail } from '@/lib/query/hooks';
import { ApiClientError, v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '@/lib/query/queryClient';
import type { ReadingV2Response } from '@/types/v2';

const BRACKET_MINUTES = 15;

/**
 * Canonical, deep-linkable alert page: it survives a refresh and can be pasted
 * into a chat mid-incident. Mirrors app/devices/[id]/page.tsx.
 */
export default function AlertDetailPage() {
  const params = useParams<{ id: string }>();
  const alertId = params?.id ? decodeURIComponent(params.id) : '';

  // retry: false — a 404 must render the styled not-found state right away,
  // not spin through the default two retries first (useAlertDetail's own
  // config doesn't set this, so it has to be passed here).
  const {
    data: alert,
    isLoading,
    error,
    refetch,
  } = useAlertDetail(alertId, { include_device: true }, { retry: false });

  const range = useMemo(() => {
    const anchor = alert?.fired_at ?? alert?.breached_since;
    if (!anchor) return null;
    const at = new Date(anchor).getTime();
    return {
      startDate: new Date(at - BRACKET_MINUTES * 60_000).toISOString(),
      endDate: new Date(at + BRACKET_MINUTES * 60_000).toISOString(),
    };
  }, [alert?.fired_at, alert?.breached_since]);

  // No new endpoint: the existing readings endpoint already requires a time
  // range, and fired_at +/- 15 minutes satisfies it. limit/sortBy/sortDirection
  // are explicit because the endpoint defaults to 20 rows, newest first — a
  // silent default that would truncate exactly the early part of the window
  // that shows the breach developing. limit: 100 is the endpoint's max and
  // comfortably covers 30 minutes at any realistic reporting cadence;
  // ascending puts the bracketing table in chronological order.
  const { data: bracketingReadings = [], isLoading: readingsLoading } = useQuery({
    queryKey: queryKeys.readings.list({
      device_id: alert?.device_id,
      ...range,
      limit: 100,
      sortBy: 'timestamp',
      sortDirection: 'asc',
    }),
    queryFn: async (): Promise<ReadingV2Response[]> => {
      const response = await v2Api.readings.list({
        device_id: alert!.device_id,
        startDate: range!.startDate,
        endDate: range!.endDate,
        limit: 100,
        sortBy: 'timestamp',
        sortDirection: 'asc',
      });
      return response.data;
    },
    enabled: !!alert?.device_id && !!range,
  });

  // apiCall() (lib/api/v2-client.ts) always throws ApiClientError, network
  // failures included, so this narrows reliably: a genuine 404 renders the
  // app-wide styled not-found state, while any other error (network, 500) is
  // not "this alert doesn't exist" and gets a retry banner instead — the same
  // distinction useDeviceDetail draws for app/devices/[id]/page.tsx.
  const isNotFound = error instanceof ApiClientError && error.statusCode === 404;
  if (!isLoading && isNotFound) notFound();
  const loadError = !isLoading && error && !isNotFound ? error : null;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6 space-y-4">
        <Link
          href="/alerts"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to alerts
        </Link>
        <div className="flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground break-all">
            {alert?.rule_name ?? 'Alert'}
          </h1>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      )}

      {loadError && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
          Failed to load alert.
          <Button variant="outline" size="sm" className="ml-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {alert && !isLoading && (
        <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <AlertDetailView
            alert={alert}
            bracketingReadings={bracketingReadings}
            loading={readingsLoading}
          />
        </div>
      )}
    </div>
  );
}
