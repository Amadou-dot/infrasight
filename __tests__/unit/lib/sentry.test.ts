/**
 * Sentry Integration Tests
 *
 * Tests for optional Sentry error tracking and performance monitoring.
 */

import {
  isSentryConfigured,
  initSentry,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setExtra,
  startTransaction,
  withSentryErrorHandling,
} from '@/lib/monitoring/sentry';

// Mock Sentry
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

describe('Sentry Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ==========================================================================
  // isSentryConfigured()
  // ==========================================================================

  describe('isSentryConfigured()', () => {
    it('should return false when SENTRY_DSN is not set', () => {
      delete process.env.SENTRY_DSN;

      expect(isSentryConfigured()).toBe(false);
    });

    it('should return true when SENTRY_DSN is set', () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      expect(isSentryConfigured()).toBe(true);
    });

    it('should return false for empty string', () => {
      process.env.SENTRY_DSN = '';

      expect(isSentryConfigured()).toBe(false);
    });
  });

  // ==========================================================================
  // initSentry()
  // ==========================================================================

  describe('initSentry()', () => {
    it('should return false when SENTRY_DSN is not set', async () => {
      delete process.env.SENTRY_DSN;

      const result = await initSentry();

      expect(result).toBe(false);
    });

    it('should initialize Sentry when DSN is configured', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      const result = await initSentry();

      expect(result).toBe(true);
      const Sentry = require('@sentry/nextjs');
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://key@sentry.io/project',
        })
      );
    });

    it('should return true on subsequent calls (already initialized)', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      await initSentry();
      const result = await initSentry();

      expect(result).toBe(true);
    });

    it('should use production sample rate in production', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';
      process.env.NODE_ENV = 'production';

      // Reset module to get fresh initialization
      jest.resetModules();
      const { initSentry: init } = require('@/lib/monitoring/sentry');

      await init();

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          tracesSampleRate: 0.1,
        })
      );
    });
  });

  // ==========================================================================
  // captureException()
  // ==========================================================================

  describe('captureException()', () => {
    it('should return undefined when Sentry not initialized', () => {
      // Reset module state - Sentry not initialized
      jest.resetModules();
      const { captureException: capture } = require('@/lib/monitoring/sentry');

      const result = capture(new Error('Test error'));

      expect(result).toBeUndefined();
    });

    it('should capture exception with context after initialization', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      // Re-import to get fresh module
      jest.resetModules();
      const { initSentry: init, captureException: capture } = require('@/lib/monitoring/sentry');

      await init();

      const error = new Error('Test error');
      const context = { userId: '123', action: 'test' };
      const result = capture(error, context);

      expect(result).toBe('event-id-123');
      const Sentry = require('@sentry/nextjs');
      expect(Sentry.captureException).toHaveBeenCalledWith(error, {
        extra: context,
      });
    });
  });

  // ==========================================================================
  // captureMessage()
  // ==========================================================================

  describe('captureMessage()', () => {
    it('should return undefined when Sentry not initialized', () => {
      jest.resetModules();
      const { captureMessage: capture } = require('@/lib/monitoring/sentry');

      const result = capture('Test message');

      expect(result).toBeUndefined();
    });

    it('should capture message with level and context', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, captureMessage: capture } = require('@/lib/monitoring/sentry');

      await init();

      const result = capture('Test message', 'warning', { key: 'value' });

      expect(result).toBe('message-id-456');
      const Sentry = require('@sentry/nextjs');
      expect(Sentry.captureMessage).toHaveBeenCalledWith('Test message', {
        level: 'warning',
        extra: { key: 'value' },
      });
    });
  });

  // ==========================================================================
  // addBreadcrumb()
  // ==========================================================================

  describe('addBreadcrumb()', () => {
    it('should do nothing when Sentry not initialized', () => {
      jest.resetModules();
      const { addBreadcrumb: add } = require('@/lib/monitoring/sentry');

      // Should not throw
      add('Test breadcrumb', 'test');

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
    });

    it('should add breadcrumb when initialized', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, addBreadcrumb: add } = require('@/lib/monitoring/sentry');

      await init();
      add('Test breadcrumb', 'navigation', { page: '/home' }, 'info');

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
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
    it('should do nothing when Sentry not initialized', () => {
      jest.resetModules();
      const { setUser: set } = require('@/lib/monitoring/sentry');

      set({ id: '123', email: 'test@example.com' });

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.setUser).not.toHaveBeenCalled();
    });

    it('should set user when initialized', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, setUser: set } = require('@/lib/monitoring/sentry');

      await init();
      const user = { id: '123', email: 'test@example.com' };
      set(user);

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.setUser).toHaveBeenCalledWith(user);
    });

    it('should clear user when null is passed', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, setUser: set } = require('@/lib/monitoring/sentry');

      await init();
      set(null);

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.setUser).toHaveBeenCalledWith(null);
    });
  });

  // ==========================================================================
  // setTag()
  // ==========================================================================

  describe('setTag()', () => {
    it('should do nothing when Sentry not initialized', () => {
      jest.resetModules();
      const { setTag: set } = require('@/lib/monitoring/sentry');

      set('version', '1.0.0');

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.setTag).not.toHaveBeenCalled();
    });

    it('should set tag when initialized', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, setTag: set } = require('@/lib/monitoring/sentry');

      await init();
      set('version', '1.0.0');

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.setTag).toHaveBeenCalledWith('version', '1.0.0');
    });
  });

  // ==========================================================================
  // setExtra()
  // ==========================================================================

  describe('setExtra()', () => {
    it('should do nothing when Sentry not initialized', () => {
      jest.resetModules();
      const { setExtra: set } = require('@/lib/monitoring/sentry');

      set('metadata', { key: 'value' });

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.setExtra).not.toHaveBeenCalled();
    });

    it('should set extra when initialized', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, setExtra: set } = require('@/lib/monitoring/sentry');

      await init();
      set('metadata', { key: 'value' });

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.setExtra).toHaveBeenCalledWith('metadata', { key: 'value' });
    });
  });

  // ==========================================================================
  // startTransaction()
  // ==========================================================================

  describe('startTransaction()', () => {
    it('should return undefined when Sentry not initialized', () => {
      jest.resetModules();
      const { startTransaction: start } = require('@/lib/monitoring/sentry');

      const result = start('test-transaction', 'http.request');

      expect(result).toBeUndefined();
    });

    it('should start transaction when initialized', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, startTransaction: start } = require('@/lib/monitoring/sentry');

      await init();
      const transaction = start('test-transaction', 'http.request');

      expect(transaction).toBeDefined();
      expect(transaction?.finish).toBeDefined();

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.startInactiveSpan).toHaveBeenCalledWith({
        name: 'test-transaction',
        op: 'http.request',
      });
    });

    it('should allow finishing the transaction', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, startTransaction: start } = require('@/lib/monitoring/sentry');

      await init();
      const transaction = start('test-transaction', 'http.request');

      // Should not throw
      transaction?.finish();

      const Sentry = require('@sentry/nextjs');
      const mockSpan = Sentry.startInactiveSpan.mock.results[0].value;
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // withSentryErrorHandling()
  // ==========================================================================

  describe('withSentryErrorHandling()', () => {
    it('should execute function and return result', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const wrapped = withSentryErrorHandling(fn);

      const result = await wrapped('arg1', 'arg2');

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should capture exception and rethrow on error', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      jest.resetModules();
      const { initSentry: init, withSentryErrorHandling: wrap } = require('@/lib/monitoring/sentry');

      await init();

      const error = new Error('Test error');
      const fn = jest.fn().mockRejectedValue(error);
      const wrapped = wrap(fn, { action: 'test' });

      await expect(wrapped()).rejects.toThrow('Test error');

      const Sentry = require('@sentry/nextjs');
      expect(Sentry.captureException).toHaveBeenCalledWith(error, {
        extra: { action: 'test', args: [] },
      });
    });
  });
});
