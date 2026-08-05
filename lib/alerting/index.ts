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
 *
 * The Pusher broadcast (publishAlertEvents, Task 13) runs AFTER
 * evaluateReadings()/sweepStaleAlerts() inside (2)'s try, but in its OWN nested
 * try/catch — never (2)'s catch clause. A throw from the broadcast path
 * (envelope math, or a Pusher failure notify.ts's own internal try/catch didn't
 * already absorb) is swallowed right where it happens. If it shared (2)'s catch,
 * it would reach `recordAlert('evaluation_error')` and mislabel a successful
 * evaluation as failed, and `return emptyEvaluationResult()` /
 * `return { deleted: 0, resolved: [] }` would discard a fired/resolved result
 * that had already committed to the database — exactly the failure mode (2)
 * exists to prevent, just for the broadcast instead of the DB write.
 */

import { logger, recordAlert, captureException } from '@/lib/monitoring';
import { evaluateReadings } from './evaluate';
import { publishAlertEvents } from './notify';
import { sweepStaleAlerts, type SweepResult } from './sweep';
import { emptyEvaluationResult, type EvaluableDevice, type EvaluableReading, type EvaluationResult } from './types';

export { evaluateReadings } from './evaluate';
export { sweepStaleAlerts, STALE_AFTER_SECONDS, type SweepResult } from './sweep';
export { matchesSelector, compare, METRIC_ACCESSORS } from './selector';
export { getRuleBuckets, loadActiveRules, buildRuleBuckets } from './rule-cache';
export { publishAlertEvents, ALERT_EVENT_NAME, ALERT_EVENT_MAX, ALERT_EVENT_MAX_BYTES } from './notify';
export {
  redactAuditForDemo,
  jsonRedacted,
  jsonRedactedPaginated,
  extendRedacted,
  type Redacted,
} from './redact';
export type { EvaluableDevice, EvaluableReading, EvaluationResult, CachedAlertRule } from './types';

/**
 * Forward a swallowed alerting failure to Sentry. `logger.error` only ever
 * reaches a console line (see lib/monitoring/logger.ts), and the
 * `evaluation_error` counter these callers also record (see recordAlert in
 * lib/monitoring/metrics.ts) is per-process memory that resets on every
 * serverless cold start and is only readable through an admin-gated metrics
 * endpoint — this call is what actually makes a silently broken evaluator
 * visible in production.
 *
 * That last sentence is load-bearing and was once false: captureException()
 * used to be gated on a module-local flag set only by an initSentry() that
 * production never called, so this escalation was dead code. It now routes to
 * the `@sentry/nextjs` singleton that instrumentation.ts initializes, gated on
 * SENTRY_DSN alone. If you ever make capturing depend on shim state again, this
 * comment goes back to being a lie.
 *
 * Guarded on its own: captureException() is still a no-op when Sentry isn't
 * configured (see lib/monitoring/sentry.ts), but this function must tolerate
 * it throwing anyway — a misbehaving Sentry SDK must never turn an
 * already-handled evaluator error into an unhandled one and defeat the very
 * isolation these callers provide.
 */
function reportToSentry(error: unknown): void {
  try {
    // `{ subsystem: 'alerting' }` goes in the THIRD argument (Sentry tags — an
    // indexed, filterable facet), not the second (context/"Additional Data").
    // Passing it as context would silently stop working as a triage classifier.
    captureException(error instanceof Error ? error : new Error(String(error)), undefined, {
      subsystem: 'alerting',
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
    const result = await evaluateReadings(readings, devices);
    try {
      await publishAlertEvents(result.fired, result.resolved);
    } catch (error) {
      // Never let a broadcast fault discard an evaluation the DB already
      // committed — but never let it vanish silently either.
      logger.error('Alert broadcast failed after a committed write', {
        error: error instanceof Error ? error.message : String(error),
      });
      reportToSentry(error);
    }
    return result;
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
    const result = await sweepStaleAlerts(reportingDeviceIds);
    try {
      await publishAlertEvents([], result.resolved);
    } catch (error) {
      // Never let a broadcast fault discard an evaluation the DB already
      // committed — but never let it vanish silently either.
      logger.error('Alert broadcast failed after a committed write', {
        error: error instanceof Error ? error.message : String(error),
      });
      reportToSentry(error);
    }
    return result;
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
