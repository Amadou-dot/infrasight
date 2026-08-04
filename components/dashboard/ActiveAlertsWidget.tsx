'use client';

import Link from 'next/link';
import { Bell, CheckCircle2 } from 'lucide-react';
import { useAlertsList } from '@/lib/query/hooks';
import { AlertSeverityBadge } from '@/components/alerts/AlertSeverityBadge';
import { AlertStatusBadge } from '@/components/alerts/AlertStatusBadge';
import { formatRelativeTime } from '@/components/alerts/AlertList';

/** Rows shown in the widget — a dashboard preview, not the full triage list at /alerts. */
const WIDGET_ALERT_LIMIT = 5;

/**
 * Dashboard preview of currently-open alerts (firing + acknowledged), sorted
 * critical-first by the server (the rank-based severity sort added in Task 12
 * Step 0 — `$switch` on critical=3/warning=2/info=1 — replacing a lexical
 * sort that put "critical" last).
 *
 * Built fresh against `GET /api/v2/alerts` rather than lifting AnomalyPanel's
 * layout: alerts carry a status/acknowledgement/duration shape that anomaly
 * rows don't have, so copying that panel would import assumptions that don't
 * hold here.
 */
export function ActiveAlertsWidget() {
  const { data: alerts, isLoading, error } = useAlertsList({
    limit: WIDGET_ALERT_LIMIT,
    sortBy: 'severity',
    sortDirection: 'desc',
  });

  const isEmpty = !isLoading && !error && (alerts?.length ?? 0) === 0;
  const hasRows = !isLoading && !error && (alerts?.length ?? 0) > 0;

  return (
    <div className="bg-card border border-border rounded-xl p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Open Alerts
        </h3>
        <Link
          href="/alerts"
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          View all alerts
        </Link>
      </div>

      {isLoading && (
        <div className="flex-1 space-y-3 animate-pulse">
          <div className="h-12 bg-muted rounded-lg" />
          <div className="h-12 bg-muted rounded-lg" />
          <div className="h-12 bg-muted rounded-lg" />
        </div>
      )}

      {!isLoading && error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-red-500">Failed to load alerts</p>
        </div>
      )}

      {isEmpty && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">No active alerts</p>
        </div>
      )}

      {hasRows && (
        <ul className="flex-1 space-y-2 overflow-y-auto">
          {alerts!.map(alert => (
            <li
              key={alert._id}
              className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm"
            >
              <AlertSeverityBadge severity={alert.severity} />
              <AlertStatusBadge status={alert.status} />
              <Link
                href={`/alerts/${alert._id}`}
                className="font-medium text-foreground hover:underline"
              >
                {alert.rule_name}
              </Link>
              <span className="text-muted-foreground">{alert.device_id}</span>
              {/* fired_at is unset while an episode is pending; breached_since always exists. */}
              <span className="ml-auto text-xs text-muted-foreground">
                {formatRelativeTime(alert.fired_at ?? alert.breached_since)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ActiveAlertsWidget;
