/**
 * Alerting -> Sentry escalation.
 *
 * `safeEvaluateReadings` / `safeSweepStaleAlerts` swallow evaluator failures by
 * design so an alerting fault can never drop a committed reading. That makes
 * the escalation in `reportToSentry()` the only thing standing between a
 * silently broken evaluator and nobody finding out: the response stays 2xx, the
 * log line is a console write, and the `evaluation_error` counter is
 * per-process memory behind an admin-gated, off-by-default metrics endpoint.
 *
 * These tests therefore assert against the REAL `@sentry/nextjs` client (mocked
 * here, but it is the same module singleton `instrumentation.ts` initializes in
 * production), never against state private to `lib/monitoring/sentry.ts`, and
 * they never call `initSentry()`. Production does not call it; a test that does
 * is how this escalation shipped as dead code in the first place.
 */

import * as SentryClient from '@sentry/nextjs';
import { logger } from '@/lib/monitoring';
import { safeEvaluateReadings, safeSweepStaleAlerts } from '@/lib/alerting';
import { evaluateReadings } from '@/lib/alerting/evaluate';
import { sweepStaleAlerts } from '@/lib/alerting/sweep';
import { publishAlertEvents } from '@/lib/alerting/notify';
import {
  emptyEvaluationResult,
  type EvaluableDevice,
  type EvaluableReading,
} from '@/lib/alerting/types';

jest.mock('@sentry/nextjs', () => ({
  init: jest.fn(),
  captureException: jest.fn().mockReturnValue('alerting-event-id'),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setExtra: jest.fn(),
  startInactiveSpan: jest.fn().mockReturnValue({ end: jest.fn() }),
}));

// The units under test are the `safe*` wrappers, so the work they wrap is
// stubbed: what matters is what happens to a throw, not what threw. Each mock
// spreads the real module and replaces exactly one function, so the barrel's
// re-exports keep working and adding an export to any of these modules cannot
// quietly turn it into `undefined` here.
jest.mock('@/lib/alerting/evaluate', () => ({
  ...jest.requireActual('@/lib/alerting/evaluate'),
  evaluateReadings: jest.fn(),
}));

jest.mock('@/lib/alerting/sweep', () => ({
  ...jest.requireActual('@/lib/alerting/sweep'),
  sweepStaleAlerts: jest.fn(),
}));

jest.mock('@/lib/alerting/notify', () => ({
  ...jest.requireActual('@/lib/alerting/notify'),
  publishAlertEvents: jest.fn(),
}));

const sentry = SentryClient as unknown as {
  init: jest.Mock;
  captureException: jest.Mock;
};
const mockEvaluateReadings = evaluateReadings as jest.Mock;
const mockSweepStaleAlerts = sweepStaleAlerts as jest.Mock;
const mockPublishAlertEvents = publishAlertEvents as jest.Mock;

const DSN = 'https://key@sentry.io/project';

const READINGS = [
  {
    metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' },
    timestamp: new Date(),
    value: 42,
  },
] as EvaluableReading[];

const DEVICES = [{ _id: 'device_001', type: 'temperature' }] as EvaluableDevice[];

describe('alerting -> Sentry escalation', () => {
  const originalEnv = process.env;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SENTRY_DSN = DSN;

    sentry.captureException.mockReturnValue('alerting-event-id');
    mockPublishAlertEvents.mockResolvedValue(undefined);
    // The wrappers log every swallowed failure; keep the suite output readable
    // without weakening the Sentry assertions.
    loggerError = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerError.mockRestore();
    process.env = originalEnv;
  });

  describe('safeEvaluateReadings()', () => {
    it('escalates a swallowed evaluator failure to the real Sentry client, tagged subsystem=alerting', async () => {
      const boom = new Error('evaluator exploded');
      mockEvaluateReadings.mockRejectedValue(boom);

      const result = await safeEvaluateReadings(READINGS, DEVICES);

      // Nothing in this test — or in production — initializes Sentry through
      // the lib/monitoring shim. If the escalation only fires after
      // initSentry(), it does not fire in production, and this assertion is
      // what keeps that from passing unnoticed.
      expect(sentry.init).not.toHaveBeenCalled();
      expect(sentry.captureException).toHaveBeenCalledTimes(1);
      expect(sentry.captureException).toHaveBeenCalledWith(boom, {
        extra: undefined,
        tags: { subsystem: 'alerting' },
      });

      // And the isolation contract still holds: swallowed, not rethrown.
      expect(result).toEqual(emptyEvaluationResult());
      expect(loggerError).toHaveBeenCalled();
    });

    it('sends subsystem as an indexed tag, not as Additional Data', async () => {
      mockEvaluateReadings.mockRejectedValue(new Error('evaluator exploded'));

      await safeEvaluateReadings(READINGS, DEVICES);

      const [, options] = sentry.captureException.mock.calls[0];
      // Sentry only indexes a top-level `tags` key as a filterable facet.
      // Folded into `extra` it becomes unsearchable Additional Data and stops
      // working as a triage classifier — silently, which is the whole problem.
      expect(options.tags).toEqual({ subsystem: 'alerting' });
      expect(options).not.toHaveProperty('extra.tags');
    });

    it('escalates a broadcast failure that follows a committed evaluation', async () => {
      const committed = { ...emptyEvaluationResult(), evaluatedPairs: 3 };
      mockEvaluateReadings.mockResolvedValue(committed);
      const broadcastFailure = new Error('pusher unavailable');
      mockPublishAlertEvents.mockRejectedValue(broadcastFailure);

      const result = await safeEvaluateReadings(READINGS, DEVICES);

      expect(sentry.captureException).toHaveBeenCalledWith(broadcastFailure, {
        extra: undefined,
        tags: { subsystem: 'alerting' },
      });
      // The DB write already committed; a broadcast fault must not discard it.
      expect(result).toBe(committed);
    });

    it('does not escalate when the evaluation succeeds', async () => {
      mockEvaluateReadings.mockResolvedValue(emptyEvaluationResult());

      await safeEvaluateReadings(READINGS, DEVICES);

      expect(sentry.captureException).not.toHaveBeenCalled();
    });

    it('wraps a non-Error throw so Sentry still receives an Error', async () => {
      mockEvaluateReadings.mockRejectedValue('a bare string');

      await safeEvaluateReadings(READINGS, DEVICES);

      const [captured, options] = sentry.captureException.mock.calls[0];
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toBe('a bare string');
      expect(options.tags).toEqual({ subsystem: 'alerting' });
    });

    it('stays a no-op when no DSN is configured, without breaking the swallow', async () => {
      delete process.env.SENTRY_DSN;
      mockEvaluateReadings.mockRejectedValue(new Error('evaluator exploded'));

      const result = await safeEvaluateReadings(READINGS, DEVICES);

      expect(sentry.captureException).not.toHaveBeenCalled();
      expect(result).toEqual(emptyEvaluationResult());
    });

    it('survives a Sentry client that throws — escalation must never unswallow the error', async () => {
      mockEvaluateReadings.mockRejectedValue(new Error('evaluator exploded'));
      sentry.captureException.mockImplementation(() => {
        throw new Error('sentry transport is down');
      });

      // A misbehaving SDK must not turn an already-handled evaluator error into
      // an unhandled one and defeat the isolation these wrappers exist for.
      await expect(safeEvaluateReadings(READINGS, DEVICES)).resolves.toEqual(
        emptyEvaluationResult()
      );
    });
  });

  describe('safeSweepStaleAlerts()', () => {
    it('escalates a swallowed sweep failure with the same subsystem tag', async () => {
      const boom = new Error('sweep exploded');
      mockSweepStaleAlerts.mockRejectedValue(boom);

      const result = await safeSweepStaleAlerts(new Set(['device_001']));

      expect(sentry.init).not.toHaveBeenCalled();
      expect(sentry.captureException).toHaveBeenCalledWith(boom, {
        extra: undefined,
        tags: { subsystem: 'alerting' },
      });
      expect(result).toEqual({ deleted: 0, resolved: [] });
    });

    it('escalates a broadcast failure that follows a committed sweep', async () => {
      const committed = { deleted: 2, resolved: [] };
      mockSweepStaleAlerts.mockResolvedValue(committed);
      const broadcastFailure = new Error('pusher unavailable');
      mockPublishAlertEvents.mockRejectedValue(broadcastFailure);

      const result = await safeSweepStaleAlerts(new Set(['device_001']));

      expect(sentry.captureException).toHaveBeenCalledWith(broadcastFailure, {
        extra: undefined,
        tags: { subsystem: 'alerting' },
      });
      expect(result).toBe(committed);
    });
  });
});
