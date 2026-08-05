'use client';

import Link from 'next/link';
import { toast } from 'react-toastify';
import { CheckCircle, Eye, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import { AlertStatusBadge } from './AlertStatusBadge';
import { useAlertFilterParams } from './useAlertFilterParams';
import { useAlertsList, useAcknowledgeAlert, useResolveAlert } from '@/lib/query/hooks';
import { useAdminAction } from '@/lib/auth/rbac-client';
import { cn } from '@/lib/utils';
import type {
  AlertComparison,
  AlertSeverity,
  AlertStatus,
  AlertV2Response,
  ListAlertsQueryParams,
} from '@/types/v2';

interface AlertListProps {
  initialFilters?: Partial<ListAlertsQueryParams>;
  showHeader?: boolean;
  onDeviceClick?: (deviceId: string) => void;
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'firing', label: 'Firing' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved (history)' },
];

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const PAGE_SIZE = 10;

const COMPARISON_WORDS: Record<AlertComparison, string> = {
  gt: 'above',
  gte: 'at or above',
  lt: 'below',
  lte: 'at or below',
};

/** "temperature above 30" / "battery_level below 20" — shared with AlertDetailView. */
export function describeCondition(
  alert: Pick<AlertV2Response, 'metric' | 'comparison' | 'threshold'>
): string {
  return `${alert.metric} ${COMPARISON_WORDS[alert.comparison]} ${alert.threshold}`;
}

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Largest-unit-first thresholds for stepping a duration down into a display unit. */
const RELATIVE_TIME_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'seconds' },
  { amount: 60, unit: 'minutes' },
  { amount: 24, unit: 'hours' },
  { amount: 7, unit: 'days' },
  { amount: 4.34524, unit: 'weeks' },
  { amount: 12, unit: 'months' },
  { amount: Infinity, unit: 'years' },
];

/**
 * "5 minutes ago" / "2 hours ago" — a small local helper rather than a
 * date-fns dependency the repo doesn't otherwise carry (ScheduleList.tsx
 * only ever needs absolute dates, via toLocaleDateString). Wraps the
 * built-in Intl.RelativeTimeFormat. Shared with AlertDetailView (Task 16).
 */
export function formatRelativeTime(isoString: string): string {
  let duration = (new Date(isoString).getTime() - Date.now()) / 1000;

  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount)
      return RELATIVE_TIME_FORMATTER.format(Math.round(duration), division.unit);

    duration /= division.amount;
  }

  return RELATIVE_TIME_FORMATTER.format(Math.round(duration), 'years');
}

export function AlertList({
  initialFilters = {},
  showHeader = true,
  onDeviceClick,
}: AlertListProps) {
  // Same useAdminAction() contract as app/analytics/page.tsx's report button:
  // enabled for admins; visible-but-disabled with a tooltip in demo mode (so a
  // visitor can see the workflow exists); hidden otherwise. requireAdmin()
  // server-side is the real enforcement in every case. Two calls (rather than
  // one shared value) name the two actions distinctly, matching how the hook
  // is used elsewhere for a single action.
  const ackAction = useAdminAction();
  const resolveAction = useAdminAction();
  // URL is the source of truth — see useAlertFilterParams below.
  const { status, setStatus, severity, setSeverity, page, setPage } =
    useAlertFilterParams(initialFilters);

  const filters: ListAlertsQueryParams = {
    ...initialFilters,
    // 'open' is the server default (firing + acknowledged), so it is sent as absent.
    ...(status !== 'open' ? { status: status as AlertStatus } : {}),
    ...(severity !== 'all' ? { severity: severity as AlertSeverity } : {}),
    page,
    limit: PAGE_SIZE,
  };

  const { data: alerts, isLoading, error, refetch, isFetching } = useAlertsList(filters);
  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();

  const act = (mutation: typeof acknowledge, id: string, successMessage: string) =>
    mutation.mutate(
      { id },
      {
        onSuccess: () => toast.success(successMessage),
        onError: (err: Error) => toast.error(err.message),
      }
    );

  return (
    <Card>
      {showHeader && (
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Alerts</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              label="Status"
              value={status}
              onValueChange={setStatus}
              options={STATUS_OPTIONS}
              size="sm"
            />
            <Select
              label="Severity"
              value={severity}
              onValueChange={setSeverity}
              options={SEVERITY_OPTIONS}
              size="sm"
            />
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          </div>
        </CardHeader>
      )}

      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {error && !isLoading && (
          <p className="py-8 text-center text-sm text-destructive">Failed to load alerts</p>
        )}

        {!isLoading && !error && alerts?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No open alerts.</p>
        )}

        <ul
          className={cn(
            'divide-y divide-border transition-opacity',
            isFetching && !isLoading && 'opacity-60'
          )}
        >
          {alerts?.map(alert => (
            <li key={alert._id} className="flex flex-wrap items-center gap-3 py-3">
              <AlertSeverityBadge severity={alert.severity} />
              <AlertStatusBadge status={alert.status} />

              <Link href={`/alerts/${alert._id}`} className="font-medium hover:underline">
                {alert.rule_name}
              </Link>

              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => onDeviceClick?.(alert.device_id)}
              >
                {alert.device_id}
              </button>

              <span className="text-sm text-muted-foreground">
                {describeCondition(alert)} — last {alert.last_value}
              </span>

              {/* fired_at is typed optional, but every alert this list ever
                  receives has one set: the list route never returns
                  `pending` episodes — they are deleted rather than resolved,
                  so they never reach a client (app/api/v2/alerts/route.ts).
                  This is defensive against the type, not a real pending-row
                  case; breached_since always exists regardless. */}
              <span className="text-sm text-muted-foreground">
                {formatRelativeTime(alert.fired_at ?? alert.breached_since)}
              </span>

              <div className="ml-auto flex items-center gap-2">
                {ackAction.visible && alert.status === 'firing' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={ackAction.disabled || acknowledge.isPending}
                    title={ackAction.tooltip}
                    onClick={() => act(acknowledge, alert._id, 'Alert acknowledged')}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Acknowledge
                  </Button>
                )}
                {resolveAction.visible && alert.is_open && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resolveAction.disabled || resolve.isPending}
                    title={resolveAction.tooltip}
                    onClick={() => act(resolve, alert._id, 'Alert resolved')}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Resolve
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1 || isFetching}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={(alerts?.length ?? 0) < PAGE_SIZE || isFetching}
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default AlertList;
