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
              { onClick: () => router.push(`/alerts/${alert._id}`) }
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
