'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { usePusherAlerts } from '@/lib/pusher-context';
import { queryKeys } from '@/lib/query/queryClient';
import type { AlertEvent, AlertSeverity } from '@/types/v2';

const TOAST_TYPE: Record<AlertSeverity, 'error' | 'warning' | 'info'> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

/**
 * How long each severity stays on screen, in milliseconds.
 *
 * Every value is finite on purpose. The container's default is
 * `autoClose={false}`, which was survivable while every toast was raised by a
 * user one at a time — but alerts come from a background evaluator that can
 * emit up to ALERT_EVENT_MAX (20) from a single ingest, and toasts that never
 * expire stack past the top of the viewport and stay there across every route
 * change until the tab is reloaded.
 *
 * Critical lingers longest because it is the one worth interrupting for; info
 * is a glance. Nothing is lost either way — the alert is on /alerts, and the
 * toast is only the interruption.
 */
const TOAST_AUTO_CLOSE_MS: Record<AlertSeverity, number> = {
  critical: 15_000,
  warning: 8_000,
  info: 5_000,
};

/** Storms are the loudest thing the app can say, so they get the critical dwell. */
const STORM_AUTO_CLOSE_MS = TOAST_AUTO_CLOSE_MS.critical;

/**
 * Raises toasts for alerts that start firing and keeps the cached alert list in
 * step with what the server just did. Renders nothing.
 *
 * Only `fired` raises a toast. `resolved` is broadcast so open lists reconcile
 * without a refetch, but a popup per device when a floor-wide condition clears
 * is noise. Because firing is always system-generated, no viewer can ever cause a
 * toast with their own acknowledge or resolve — the acting admin gets feedback
 * from their own mutation instead.
 */
export function AlertToaster() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleEvent = useCallback(
    (event: AlertEvent) => {
      switch (event.kind) {
        case 'fired':
          for (const alert of event.alerts)
            toast[TOAST_TYPE[alert.severity]](
              `${alert.rule_name} — ${alert.device_id} (${alert.trigger_value})`,
              {
                // Keyed on the alert id so a re-broadcast of the same episode
                // replaces its own toast instead of stacking a second copy.
                toastId: alert._id,
                autoClose: TOAST_AUTO_CLOSE_MS[alert.severity],
                closeOnClick: true,
                onClick: () => router.push(`/alerts/${alert._id}`),
              }
            );
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;

        case 'resolved':
          // No toast: reconcile silently.
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;

        case 'storm':
          // The storm envelope deliberately carries no rows, so there is nothing
          // to patch — invalidate and let the list refetch.
          //
          // Only a FIRED storm toasts. A resolved storm is a mass recovery, and
          // announcing it with the same red banner would report the best news in
          // the app as the worst. It still invalidates, so lists reconcile.
          if (event.of === 'fired')
            toast.error(`${event.count} alerts firing`, {
              // Keyed on `since` rather than a fixed string: two separate storms
              // are two separate pieces of news and both deserve to be seen,
              // while a re-broadcast of the same one does not stack.
              toastId: `alert-storm-${event.since}`,
              autoClose: STORM_AUTO_CLOSE_MS,
              closeOnClick: true,
              onClick: () => router.push('/alerts'),
            });
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;
      }
    },
    [queryClient, router]
  );

  usePusherAlerts(handleEvent);

  return null;
}

export default AlertToaster;
