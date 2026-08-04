/**
 * Public alerting surface.
 *
 * Both write paths call the `safe*` wrappers, never the raw functions. Issue #97
 * requires that evaluation failures never drop readings; three properties
 * guarantee it:
 *
 *   1. Evaluation runs strictly AFTER insertMany has committed. There is no path
 *      by which it can roll back an insert.
 *   2. The call is wrapped here in its own try/catch. Errors are logged and
 *      counted; they never propagate to withErrorHandler and never change the
 *      response status.
 *   3. Route response bodies report insert results only. Alerting is not part of
 *      their contract.
 *
 * This mirrors the existing treatment of the Pusher trigger in the simulate route.
 */

import { logger, recordAlert, captureException } from '@/lib/monitoring';
import { evaluateReadings } from './evaluate';
import { sweepStaleAlerts, type SweepResult } from './sweep';
import { emptyEvaluationResult, type EvaluableDevice, type EvaluableReading, type EvaluationResult } from './types';

export { evaluateReadings } from './evaluate';
export { sweepStaleAlerts, STALE_AFTER_SECONDS, type SweepResult } from './sweep';
export { matchesSelector, compare, METRIC_ACCESSORS } from './selector';
export { getRuleBuckets, loadActiveRules, buildRuleBuckets } from './rule-cache';
export type { EvaluableDevice, EvaluableReading, EvaluationResult, CachedAlertRule } from './types';

/**
 * Forward a swallowed alerting failure to Sentry. `logger.error` only ever
 * reaches a console line (see lib/monitoring/logger.ts), and the
 * `evaluation_error` counter these callers also record (see recordAlert
 * below) resets on every serverless cold start — this call is what actually
 * makes a silently broken evaluator visible in production.
 *
 * Guarded on its own: captureException() is a no-op when Sentry isn't
 * configured (see lib/monitoring/sentry.ts), but this function must tolerate
 * it throwing anyway — a misbehaving Sentry SDK must never turn an
 * already-handled evaluator error into an unhandled one and defeat the very
 * isolation these callers provide.
 */
function reportToSentry(error: unknown): void {
  try {
    captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { subsystem: 'alerting' },
    });
  } catch {
    // Deliberately swallowed — see doc comment above.
  }
}

export async function safeEvaluateReadings(
  readings: EvaluableReading[],
  devices: EvaluableDevice[]
): Promise<EvaluationResult> {
  try {
    return await evaluateReadings(readings, devices);
  } catch (error) {
    recordAlert('evaluation_error');
    logger.error('Alert evaluation failed after a committed write', {
      readingsCount: readings.length,
      deviceCount: devices.length,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    reportToSentry(error);
    return emptyEvaluationResult();
  }
}

export async function safeSweepStaleAlerts(
  reportingDeviceIds: Set<string>
): Promise<SweepResult> {
  try {
    return await sweepStaleAlerts(reportingDeviceIds);
  } catch (error) {
    recordAlert('evaluation_error');
    logger.error('Alert staleness sweep failed', {
      reportingDeviceCount: reportingDeviceIds.size,
      error: error instanceof Error ? error.message : String(error),
    });
    reportToSentry(error);
    return { deleted: 0, resolved: [] };
  }
}
