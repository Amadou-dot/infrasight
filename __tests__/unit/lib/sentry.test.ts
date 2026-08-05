/**
 * Sentry Integration Tests
 *
 * These tests exist to catch one specific class of regression, so read the
 * setup before adding to them.
 *
 * `lib/monitoring/sentry.ts` once gated every capture helper on a module-local
 * flag that only `initSentry()` set. Production never calls `initSentry()` —
 * Next.js initializes Sentry through `instrumentation.ts` ->
 * `sentry.server.config.ts` — so every escalation in the app was dead code.
 * The bug survived review because the tests here called `initSentry()`
 * themselves before asserting, performing setup production never performs.
 *
 * So: the escalation tests below deliberately do NOT call `initSentry()`, and
 * several of them assert `init` was never called, which is what makes them fail
 * if the module-local gate is ever reintroduced. Do not "fix" a failing test in
 * this file by adding an `initSentry()` call.
 */

// Type-only, so it is erased at compile time: the shim itself is loaded through
// `loadShim()` below, which gives each test a module instance with pristine
// internal state.
import type * as SentryShimModule from '@/lib/monitoring/sentry';

// Mock the real client. Every assertion below is against THIS module — the
// singleton the Next.js config files initialize — not against any state
// private to the shim.
jest.mock('@sentry/nextjs', () => ({
  init: jest.fn(),
  captureException: jest.fn().mockReturnValue('event-id-123'),
  captureMessage: jest.fn().mockReturnValue('message-id-456'),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setExtra: jest.fn(),
  startInactiveSpan: jest.fn().mockReturnValue({
    end: jest.fn(),
  }),
}));

type SentryShim = typeof SentryShimModule;

interface SentryClientMock {
  init: jest.Mock;
  captureException: jest.Mock;
  captureMessage: jest.Mock;
  addBreadcrumb: jest.Mock;
  setUser: jest.Mock;
  setTag: jest.Mock;
  setExtra: jest.Mock;
  startInactiveSpan: jest.Mock;
}

/**
 * Load a pristine copy of the shim plus the client instance it bound to.
 *
 * `jest.resetModules()` guarantees the shim's module-local state starts at its
 * cold-boot value, so no earlier test in this file can leave it "initialized"
 * and mask a reintroduced gate. The client must be required AFTER the shim so
 * both resolve to the same freshly-built mock.
 */
function loadShim(): { shim: SentryShim; client: SentryClientMock } {
  jest.resetModules();
  const shim = require('@/lib/monitoring/sentry') as SentryShim;
  const client = require('@sentry/nextjs') as unknown as SentryClientMock;
  return { shim, client };
}

const DSN = 'https://key@sentry.io/project';

describe('Sentry Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Explicit: a developer machine with a real DSN exported must not turn the
    // "not configured" cases into false passes.
    delete process.env.SENTRY_DSN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ==========================================================================
  // isSentryConfigured()
  // ==========================================================================

  describe('isSentryConfigured()', () => {
    it('should return false when SENTRY_DSN is not set', () => {
      const { shim } = loadShim();

      expect(shim.isSentryConfigured()).toBe(false);
    });

    it('should return true when SENTRY_DSN is set', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim } = loadShim();

      expect(shim.isSentryConfigured()).toBe(true);
    });

    it('should return false for empty string', () => {
      process.env.SENTRY_DSN = '';
      const { shim } = loadShim();

      expect(shim.isSentryConfigured()).toBe(false);
    });
  });

  // ==========================================================================
  // captureException() — THE ESCALATION PATH
  //
  // The load-bearing block. Every test here runs with a DSN configured and
  // initSentry() never called, mirroring production exactly.
  // ==========================================================================

  describe('captureException() escalation', () => {
    it('reaches the real @sentry/nextjs client with only a DSN set — initSentry() is not a precondition', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      const error = new Error('evaluator exploded');
      const result = shim.captureException(error);

      // The two assertions have to hold together. `init` never being called is
      // what proves the forward below did not depend on setup production skips:
      // drop this and the test degrades into the one that shipped the bug.
      expect(client.init).not.toHaveBeenCalled();
      expect(client.captureException).toHaveBeenCalledTimes(1);
      expect(client.captureException).toHaveBeenCalledWith(error, { extra: undefined });
      expect(result).toBe('event-id-123');
    });

    it('forwards context as extra without any initialization of its own', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      const error = new Error('Test error');
      const context = { userId: '123', action: 'test' };
      const result = shim.captureException(error, context);

      expect(client.init).not.toHaveBeenCalled();
      expect(client.captureException).toHaveBeenCalledWith(error, { extra: context });
      expect(result).toBe('event-id-123');
    });

    it('forwards tags as a distinct top-level field, not folded into context', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      const error = new Error('Test error');
      const context = { readingsCount: 5 };
      const tags = { subsystem: 'alerting' };
      const result = shim.captureException(error, context, tags);

      expect(result).toBe('event-id-123');
      expect(client.init).not.toHaveBeenCalled();
      // Full-shape match, not objectContaining: `tags` must be its own
      // top-level key alongside `extra`. Sentry only indexes a top-level `tags`
      // key as a filterable facet — nesting it under `extra` (the bug this test
      // guards) silently downgrades it to unfilterable "Additional Data".
      expect(client.captureException).toHaveBeenCalledWith(error, {
        extra: context,
        tags,
      });

      // Stated the other way round too, so a `{ extra: { ...context, tags } }`
      // regression fails on the specific thing that is wrong with it rather
      // than on a whole-object diff.
      const [, options] = client.captureException.mock.calls[0];
      expect(options.tags).toEqual(tags);
      expect(options.extra).toEqual(context);
      expect(Object.prototype.hasOwnProperty.call(options.extra, 'tags')).toBe(false);
    });

    it('omits the tags key entirely when no tags are passed', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      shim.captureException(new Error('Test error'), { userId: '123' });

      const [, options] = client.captureException.mock.calls[0];
      expect(Object.prototype.hasOwnProperty.call(options, 'tags')).toBe(false);
    });

    it('reads the DSN gate per call, not once at module load', () => {
      // The shim is loaded with no DSN, then the DSN appears. Nothing may be
      // cached at import time: serverless cold starts and test harnesses both
      // populate env after modules resolve.
      const { shim, client } = loadShim();
      expect(shim.captureException(new Error('too early'))).toBeUndefined();

      process.env.SENTRY_DSN = DSN;

      expect(shim.captureException(new Error('now configured'))).toBe('event-id-123');
      expect(client.captureException).toHaveBeenCalledTimes(1);
    });

    it('is a no-op that returns undefined when no DSN is configured', () => {
      const { shim, client } = loadShim();

      const result = shim.captureException(new Error('Test error'), { userId: '123' });

      expect(result).toBeUndefined();
      expect(client.captureException).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // initSentry()
  //
  // Still exported (and re-exported from lib/monitoring/index.ts) for entry
  // points that are not Next.js request handlers. It is no longer a
  // precondition for anything above.
  // ==========================================================================

  describe('initSentry()', () => {
    it('should return false when SENTRY_DSN is not set', async () => {
      const { shim, client } = loadShim();

      await expect(shim.initSentry()).resolves.toBe(false);
      expect(client.init).not.toHaveBeenCalled();
    });

    it('should initialize Sentry when DSN is configured', async () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      await expect(shim.initSentry()).resolves.toBe(true);
      expect(client.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: DSN,
        })
      );
    });

    it('should be idempotent — a second call does not re-init', async () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      await shim.initSentry();
      await expect(shim.initSentry()).resolves.toBe(true);

      expect(client.init).toHaveBeenCalledTimes(1);
    });

    it('should use production sample rate in production', async () => {
      process.env.SENTRY_DSN = DSN;
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const { shim, client } = loadShim();

      await shim.initSentry();

      expect(client.init).toHaveBeenCalledWith(
        expect.objectContaining({
          tracesSampleRate: 0.1,
        })
      );
    });

    it('should return false rather than throw when the SDK fails to initialize', async () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();
      client.init.mockImplementationOnce(() => {
        throw new Error('bad DSN');
      });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(shim.initSentry()).resolves.toBe(false);

      warn.mockRestore();
    });

    it('does not gate captureException — capture works before and after it runs', async () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      expect(shim.captureException(new Error('before'))).toBe('event-id-123');
      await shim.initSentry();
      expect(shim.captureException(new Error('after'))).toBe('event-id-123');

      expect(client.captureException).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // captureMessage()
  // ==========================================================================

  describe('captureMessage()', () => {
    it('should return undefined when Sentry is not configured', () => {
      const { shim, client } = loadShim();

      expect(shim.captureMessage('Test message')).toBeUndefined();
      expect(client.captureMessage).not.toHaveBeenCalled();
    });

    it('should capture message with level and context, without initSentry()', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      const result = shim.captureMessage('Test message', 'warning', { key: 'value' });

      expect(result).toBe('message-id-456');
      expect(client.init).not.toHaveBeenCalled();
      expect(client.captureMessage).toHaveBeenCalledWith('Test message', {
        level: 'warning',
        extra: { key: 'value' },
      });
    });
  });

  // ==========================================================================
  // addBreadcrumb()
  // ==========================================================================

  describe('addBreadcrumb()', () => {
    it('should do nothing when Sentry is not configured', () => {
      const { shim, client } = loadShim();

      shim.addBreadcrumb('Test breadcrumb', 'test');

      expect(client.addBreadcrumb).not.toHaveBeenCalled();
    });

    it('should add breadcrumb without initSentry()', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      shim.addBreadcrumb('Test breadcrumb', 'navigation', { page: '/home' }, 'info');

      expect(client.init).not.toHaveBeenCalled();
      expect(client.addBreadcrumb).toHaveBeenCalledWith({
        message: 'Test breadcrumb',
        category: 'navigation',
        data: { page: '/home' },
        level: 'info',
      });
    });
  });

  // ==========================================================================
  // setUser()
  // ==========================================================================

  describe('setUser()', () => {
    it('should do nothing when Sentry is not configured', () => {
      const { shim, client } = loadShim();

      shim.setUser({ id: '123', email: 'test@example.com' });

      expect(client.setUser).not.toHaveBeenCalled();
    });

    it('should set user when configured', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      const user = { id: '123', email: 'test@example.com' };
      shim.setUser(user);

      expect(client.setUser).toHaveBeenCalledWith(user);
    });

    it('should clear user when null is passed', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      shim.setUser(null);

      expect(client.setUser).toHaveBeenCalledWith(null);
    });
  });

  // ==========================================================================
  // setTag()
  // ==========================================================================

  describe('setTag()', () => {
    it('should do nothing when Sentry is not configured', () => {
      const { shim, client } = loadShim();

      shim.setTag('version', '1.0.0');

      expect(client.setTag).not.toHaveBeenCalled();
    });

    it('should set tag when configured', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      shim.setTag('version', '1.0.0');

      expect(client.setTag).toHaveBeenCalledWith('version', '1.0.0');
    });
  });

  // ==========================================================================
  // setExtra()
  // ==========================================================================

  describe('setExtra()', () => {
    it('should do nothing when Sentry is not configured', () => {
      const { shim, client } = loadShim();

      shim.setExtra('metadata', { key: 'value' });

      expect(client.setExtra).not.toHaveBeenCalled();
    });

    it('should set extra when configured', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      shim.setExtra('metadata', { key: 'value' });

      expect(client.setExtra).toHaveBeenCalledWith('metadata', { key: 'value' });
    });
  });

  // ==========================================================================
  // startTransaction()
  // ==========================================================================

  describe('startTransaction()', () => {
    it('should return undefined when Sentry is not configured', () => {
      const { shim, client } = loadShim();

      expect(shim.startTransaction('test-transaction', 'http.request')).toBeUndefined();
      expect(client.startInactiveSpan).not.toHaveBeenCalled();
    });

    it('should start transaction when configured', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      const transaction = shim.startTransaction('test-transaction', 'http.request');

      expect(transaction).toBeDefined();
      expect(transaction?.finish).toBeDefined();
      expect(client.startInactiveSpan).toHaveBeenCalledWith({
        name: 'test-transaction',
        op: 'http.request',
      });
    });

    it('should allow finishing the transaction', () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      const transaction = shim.startTransaction('test-transaction', 'http.request');
      transaction?.finish();

      const mockSpan = client.startInactiveSpan.mock.results[0].value;
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // withSentryErrorHandling()
  // ==========================================================================

  describe('withSentryErrorHandling()', () => {
    it('should execute function and return result', async () => {
      const { shim } = loadShim();
      const fn = jest.fn().mockResolvedValue('result');
      const wrapped = shim.withSentryErrorHandling(fn);

      const result = await wrapped('arg1', 'arg2');

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should capture exception and rethrow on error, without initSentry()', async () => {
      process.env.SENTRY_DSN = DSN;
      const { shim, client } = loadShim();

      const error = new Error('Test error');
      const fn = jest.fn().mockRejectedValue(error);
      const wrapped = shim.withSentryErrorHandling(fn, { action: 'test' });

      await expect(wrapped()).rejects.toThrow('Test error');

      expect(client.init).not.toHaveBeenCalled();
      expect(client.captureException).toHaveBeenCalledWith(error, {
        extra: { action: 'test', args: [] },
      });
    });
  });
});
