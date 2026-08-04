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
import { useRbac } from '@/lib/auth/rbac-client';
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

const ADMIN_ONLY_TOOLTIP = 'Admin role required — sign in as an admin to act on alerts';

export function AlertList({
  initialFilters = {},
  showHeader = true,
  onDeviceClick,
}: AlertListProps) {
  const { isAdmin } = useRbac();
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

  const { data: alerts, isLoading, error, refetch } = useAlertsList(filters);
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
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
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

        <ul className="divide-y divide-border">
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

              <div className="ml-auto flex items-center gap-2">
                {/* Disabled, never hidden: a visitor should learn the workflow exists.
                    requireAdmin() server-side is the real enforcement. */}
                {alert.status === 'firing' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isAdmin || acknowledge.isPending}
                    title={isAdmin ? undefined : ADMIN_ONLY_TOOLTIP}
                    onClick={() => act(acknowledge, alert._id, 'Alert acknowledged')}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Acknowledge
                  </Button>
                )}
                {alert.is_open && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isAdmin || resolve.isPending}
                    title={isAdmin ? undefined : ADMIN_ONLY_TOOLTIP}
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
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={(alerts?.length ?? 0) < PAGE_SIZE}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default AlertList;
