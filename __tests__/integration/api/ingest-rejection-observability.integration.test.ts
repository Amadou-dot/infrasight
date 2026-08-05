/**
 * Ingest rejection observability (A4) — cron simulate AND production ingest.
 *
 * Both write paths compute a rejected count and both used to put it ONLY in the
 * response body, on a 2xx. No log at a level anyone alerts on, and — on the cron
 * path — no metric at all.
 *
 * Why that is worse than an ordinary missing log: a reading that never persisted
 * is never handed to `evaluateReadings`, so `last_observed_at` stops advancing
 * on every open alert. After `ALERT_STALE_AFTER_SECONDS` the staleness sweep
 * auto-resolves all of them as `stale`, and the dashboard goes green — BECAUSE
 * ingest is down. The failure actively erases its own evidence, so the signal
 * has to be emitted at the moment of rejection or it is not recoverable later.
 *
 * These tests assert on the three channels this repo actually has (structured
 * log at a level matched to severity, the `recordIngestion` counter, and Sentry
 * escalation on total failure) and, in every case, that the response contract is
 * unchanged — this is observability, not behaviour.
 *
 * Sentry is asserted against the REAL `@sentry/nextjs` client (mocked here, but
 * the same module singleton `instrumentation.ts` initializes in production)
 * rather than against anything private to `lib/monitoring/sentry.ts`, which
 * gates capture on `SENTRY_DSN` alone.
 */

import { NextRequest } from 'next/server';
import * as SentryClient from '@sentry/nextjs';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2, { type IReadingV2 } from '@/models/v2/ReadingV2';
import { getMetricsSnapshot, logger, resetMetrics } from '@/lib/monitoring';
import { createDeviceInput, resetCounters } from '../../setup/factories';

import { GET as GET_SIMULATE_RAW } from '@/app/api/v2/cron/simulate/route';
import { POST as POST_INGEST } from '@/app/api/v2/readings/ingest/route';

jest.mock('@/lib/pusher', () => ({
  pusherServer: { trigger: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@sentry/nextjs', () => ({
  init: jest.fn(),
  captureException: jest.fn().mockReturnValue('ingest-event-id'),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setExtra: jest.fn(),
  startInactiveSpan: jest.fn().mockReturnValue({ end: jest.fn() }),
}));

function callSimulate() {
  return GET_SIMULATE_RAW(
    new NextRequest('http://localhost:3000/api/v2/cron/simulate', {
      headers: { Authorization: `Bearer ${process.env.SEED_SECRET}` },
    })
  );
}

function callIngest(readings: unknown[]) {
  return POST_INGEST(
    new NextRequest('http://localhost:3000/api/v2/readings/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readings }),
    })
  );
}

function ingestItem(deviceId: string) {
  return {
    device_id: deviceId,
    type: 'temperature',
    unit: 'celsius',
    value: 21.5,
    timestamp: new Date().toISOString(),
  };
}

function ingestionMetrics() {
  return getMetricsSnapshot().ingestion as { total: number; errors: number };
}

describe('ingest rejection observability', () => {
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    resetCounters();
    resetMetrics();
    delete process.env.SENTRY_DSN;
  });

  afterAll(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  // ==========================================================================
  // GET /api/v2/cron/simulate
  // ==========================================================================

  describe('cron simulate route', () => {
    beforeEach(async () => {
      await DeviceV2.insertMany([
        createDeviceInput({ _id: 'obs_sim_01', type: 'temperature' }),
        createDeviceInput({ _id: 'obs_sim_02', type: 'temperature' }),
        createDeviceInput({ _id: 'obs_sim_03', type: 'temperature' }),
      ]);
    });

    /**
     * Stand-in for bulkInsertReadings' real `{ ordered: false }` behavior: some
     * documents are dropped and only the survivors come back, without throwing.
     * Survivors carry a `toObject()` so the route's Pusher broadcast behaves as
     * it would against the real Mongoose documents insertMany returns.
     */
    function insertOnly(count: number) {
      return jest
        .spyOn(ReadingV2, 'bulkInsertReadings')
        .mockImplementation(
          async readings =>
            readings.slice(0, count).map(r => ({ ...r, toObject: () => ({ ...r }) })) as unknown as IReadingV2[]
        );
    }

    it('should warn and count a partial rejection', async () => {
      const spy = insertOnly(2);
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const response = await callSimulate();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('partially rejected'),
        expect.objectContaining({ generated: 3, inserted: 2, rejected: 1 })
      );
      // A partial rejection is a warning, not an outage.
      expect(errorSpy).not.toHaveBeenCalled();
      expect(SentryClient.captureException).not.toHaveBeenCalled();

      expect(ingestionMetrics()).toMatchObject({ total: 2, errors: 1 });

      // Response contract unchanged.
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, count: 2, rejected: 1 });

      spy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should log at error and escalate to Sentry when every reading is rejected', async () => {
      process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
      const spy = insertOnly(0);
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const response = await callSimulate();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('rejected every reading'),
        expect.objectContaining({ generated: 3, inserted: 0, rejected: 3 })
      );
      expect(SentryClient.captureException).toHaveBeenCalledTimes(1);
      expect(ingestionMetrics()).toMatchObject({ total: 0, errors: 3 });

      // The dangerous part: the handler still reports success, which is exactly
      // why the log and the metric have to carry the signal instead.
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, count: 0, rejected: 3 });

      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should stay quiet and still record the batch when nothing is rejected', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const response = await callSimulate();

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      // The counter still moves on a healthy run — without a denominator the
      // error count above says nothing about the ingest success rate.
      expect(ingestionMetrics()).toMatchObject({ total: 3, errors: 0 });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, count: 3, rejected: 0 });

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // POST /api/v2/readings/ingest — the real production path
  // ==========================================================================

  describe('readings ingest route', () => {
    beforeEach(async () => {
      await DeviceV2.insertMany([
        createDeviceInput({ _id: 'obs_ing_01' }),
        createDeviceInput({ _id: 'obs_ing_02' }),
      ]);
    });

    it('should log at info when nothing is rejected', async () => {
      const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const response = await callIngest([ingestItem('obs_ing_01')]);

      expect(response.status).toBe(201);
      expect(infoSpy).toHaveBeenCalledWith(
        'Readings ingested',
        expect.objectContaining({ inserted: 1, rejected: 0 })
      );
      expect(warnSpy).not.toHaveBeenCalled();

      infoSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should warn on a partial rejection instead of reporting it as a plain success', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const response = await callIngest([ingestItem('obs_ing_01'), ingestItem('obs_ing_missing')]);

      expect(response.status).toBe(201);
      expect(warnSpy).toHaveBeenCalledWith(
        'Readings ingested with rejections',
        expect.objectContaining({
          inserted: 1,
          rejected: 1,
          rejectedUnknownDevice: 1,
          rejectedAtInsert: 0,
        })
      );
      expect(errorSpy).not.toHaveBeenCalled();

      // Response contract unchanged.
      expect(await response.json()).toMatchObject({
        data: { inserted: 1, rejected: 1 },
      });

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should log at error and escalate when the datastore persists none of a valid batch', async () => {
      process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
      // The devices exist and the payload is valid — the writes themselves fail.
      // This is the outage shape, and the one that starts the stale cascade.
      const insertSpy = jest
        .spyOn(ReadingV2, 'insertMany')
        .mockResolvedValue([] as never);
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const response = await callIngest([ingestItem('obs_ing_01'), ingestItem('obs_ing_02')]);

      expect(response.status).toBe(201);
      expect(errorSpy).toHaveBeenCalledWith(
        'Readings ingest rejected every reading',
        expect.objectContaining({ inserted: 0, rejected: 2, rejectedAtInsert: 2 })
      );
      expect(SentryClient.captureException).toHaveBeenCalledTimes(1);
      expect(ingestionMetrics()).toMatchObject({ total: 0, errors: 2 });

      insertSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should log at error but NOT page anyone when every device id is simply unknown', async () => {
      process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const response = await callIngest([ingestItem('nobody_01'), ingestItem('nobody_02')]);

      expect(response.status).toBe(201);
      expect(errorSpy).toHaveBeenCalledWith(
        'Readings ingest rejected every reading',
        expect.objectContaining({
          inserted: 0,
          rejected: 2,
          rejectedUnknownDevice: 2,
          rejectedAtInsert: 0,
        })
      );
      // A caller naming devices that do not exist is a client mistake, already
      // itemized in the response's errors[]. Escalating it would train everyone
      // to ignore the alert that matters.
      expect(SentryClient.captureException).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });
});
