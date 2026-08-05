'use client';

import Link from 'next/link';
import { toast } from 'react-toastify';
import { CheckCircle, Eye, Flame, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import { AlertStatusBadge } from './AlertStatusBadge';
import { describeCondition } from './AlertList';
import { useAcknowledgeAlert, useResolveAlert } from '@/lib/query/hooks';
import { useAdminAction } from '@/lib/auth/rbac-client';
import type { AlertResolution, AlertV2Response } from '@/types/v2';

/** A single reading bracketing the alert's fired_at, +/- 15 minutes. */
export interface BracketingReading {
  timestamp: string;
  value: number;
}

interface AlertDetailViewProps {
  alert: AlertV2Response;
  bracketingReadings: BracketingReading[];
  /**
   * Whether the bracketing readings are still being fetched. The alert itself
   * is always already-loaded by the time this component is rendered (the page
   * only renders it once `useAlertDetail` has settled), so this only gates the
   * readings section.
   */
  loading: boolean;
  /**
   * The firing rule's `for_duration_seconds`, when the caller has it (the
   * alert wire shape alone doesn't carry it — it belongs to the rule).
   * Optional; omitted entirely when unknown or zero.
   */
  forDurationSeconds?: number;
  /**
   * Set when the bracketing-readings fetch itself failed. Distinct from a
   * genuinely empty `bracketingReadings` array: "No readings in this
   * window." is the signature of a stale/device_inactive close (the sensor
   * stopped reporting) and must never be what a fetch failure renders as —
   * that would be the wrong diagnosis, mid-incident (review finding A3).
   * Optional because a caller may not have wired a readings-error branch
   * (the readings query can fail without this being populated, in which
   * case the section falls back to the empty-state copy — see the task
   * report for whether that wiring exists yet).
   */
  readingsError?: unknown;
  /** Retry affordance for the readings-error state — typically the readings query's own refetch. */
  onRetryReadings?: () => void;
}

function humanizeDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * How each resolution reason reads on the timeline. 'stale' and
 * 'device_inactive' must not sound like the underlying problem was fixed —
 * the sensor merely stopped reporting, so the episode was closed, not solved.
 * Deliberately avoids the word "resolved" (the status badge already says
 * that) so this text and the badge don't collide as duplicate matches.
 */
const RESOLUTION_LABELS: Record<AlertResolution, string> = {
  manual: 'closed manually',
  auto: 'closed automatically — back within threshold',
  stale: 'closed — stale (no recent readings)',
  device_inactive: 'closed — device went inactive',
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Presentational alert detail: header, plain-language condition, lifecycle
 * timeline, values, device link, and bracketing readings.
 *
 * Shared by the canonical `/alerts/[id]` page and any future quick-inspection
 * drawer, so the two cannot drift apart (mirrors DeviceDetailView). Acknowledge
 * / Resolve are self-contained here, the same way AlertList owns its own
 * mutations — there is no callback prop for them.
 */
export function AlertDetailView({
  alert,
  bracketingReadings,
  loading,
  forDurationSeconds,
  readingsError,
  onRetryReadings,
}: AlertDetailViewProps) {
  // Same useAdminAction() contract as AlertList's row actions and
  // app/analytics/page.tsx's report button: enabled for admins;
  // visible-but-disabled with a tooltip in demo mode (so a visitor can see the
  // workflow exists); hidden otherwise. requireAdmin() server-side is the
  // real enforcement in every case. Two calls name the two actions distinctly,
  // matching AlertList.
  const ackAction = useAdminAction();
  const resolveAction = useAdminAction();
  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();

  const act = (mutation: typeof acknowledge, successMessage: string) =>
    mutation.mutate(
      { id: alert._id },
      {
        onSuccess: () => toast.success(successMessage),
        onError: (err: Error) => toast.error(err.message),
      }
    );

  const condition = forDurationSeconds
    ? `${describeCondition(alert)} for ${humanizeDuration(forDurationSeconds)}`
    : describeCondition(alert);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground break-all">
              {alert.rule_name}
            </h2>
            <AlertSeverityBadge severity={alert.severity} />
            <AlertStatusBadge status={alert.status} />
          </div>
          <p className="text-sm text-muted-foreground">{condition}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {ackAction.visible && alert.status === 'firing' && (
            <Button
              variant="outline"
              size="sm"
              disabled={ackAction.disabled || acknowledge.isPending}
              title={ackAction.tooltip}
              onClick={() => act(acknowledge, 'Alert acknowledged')}
            >
              <Eye className="h-4 w-4 mr-1" aria-hidden="true" />
              Acknowledge
            </Button>
          )}
          {resolveAction.visible && alert.is_open && (
            <Button
              variant="outline"
              size="sm"
              disabled={resolveAction.disabled || resolve.isPending}
              title={resolveAction.tooltip}
              onClick={() => act(resolve, 'Alert resolved')}
            >
              <CheckCircle className="h-4 w-4 mr-1" aria-hidden="true" />
              Resolve
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Lifecycle timeline */}
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground">Timeline</h3>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <Flame className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>Breached since {formatTimestamp(alert.breached_since)}</span>
            </li>
            {alert.fired_at && (
              <li className="flex items-start gap-2">
                <Zap className="h-4 w-4 mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
                <span>Fired {formatTimestamp(alert.fired_at)}</span>
              </li>
            )}
            {alert.audit.acknowledged_at && (
              <li className="flex items-start gap-2">
                <Eye className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                <span>
                  Acknowledged {formatTimestamp(alert.audit.acknowledged_at)}
                  {alert.audit.acknowledged_by ? ` by ${alert.audit.acknowledged_by}` : ''}
                </span>
              </li>
            )}
            {alert.audit.resolved_at && (
              <li className="flex items-start gap-2">
                <CheckCircle
                  className="h-4 w-4 mt-0.5 shrink-0 text-green-500"
                  aria-hidden="true"
                />
                <span>
                  {formatTimestamp(alert.audit.resolved_at)} —{' '}
                  {alert.audit.resolution ? RESOLUTION_LABELS[alert.audit.resolution] : 'closed'}
                  {alert.audit.resolved_by ? ` by ${alert.audit.resolved_by}` : ''}
                </span>
              </li>
            )}
          </ol>
        </div>

        {/* Values */}
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground">Values</h3>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Trigger value: {alert.trigger_value}</p>
            <p>Last value: {alert.last_value}</p>
            {/* Deliberately unset on manual/swept resolutions — only auto-resolution
                has a reading to attribute. Its absence is normal, not an error. */}
            {alert.resolved_value !== undefined && <p>Closing value: {alert.resolved_value}</p>}
            <p>Threshold: {alert.threshold}</p>
          </div>
        </div>
      </div>

      {/* Device link */}
      <div className="text-sm">
        <span className="text-muted-foreground">Device: </span>
        <Link
          href={`/devices/${alert.device_id}`}
          className="font-medium text-primary hover:underline"
        >
          {alert.device_id}
        </Link>
      </div>

      {/* Bracketing readings */}
      <div className="space-y-3">
        <h3 className="font-semibold text-foreground">Readings around the trigger (+/-15m)</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : readingsError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <p>Failed to load readings for this window.</p>
            {onRetryReadings && (
              <Button variant="outline" size="sm" className="mt-2" onClick={onRetryReadings}>
                Retry
              </Button>
            )}
          </div>
        ) : bracketingReadings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No readings in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1 pr-4 font-medium">Timestamp</th>
                  <th className="py-1 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {bracketingReadings.map(reading => (
                  <tr key={reading.timestamp} className="border-b border-border/50 last:border-0">
                    <td className="py-1 pr-4">{formatTimestamp(reading.timestamp)}</td>
                    <td className="py-1">{reading.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default AlertDetailView;
