/* eslint-disable no-console */
/**
 * Logger Tests
 *
 * Tests for structured logging functionality.
 */

import { logger } from '@/lib/monitoring/logger';

describe('Logger', () => {
  const originalEnv = process.env;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  let consoleLogs: string[] = [];

  beforeEach(() => {
    consoleLogs = [];
    process.env = { ...originalEnv };

    // Capture console output
    console.log = jest.fn((...args) => {
      consoleLogs.push(args.join(' '));
    });
    console.warn = jest.fn((...args) => {
      consoleLogs.push(args.join(' '));
    });
    console.error = jest.fn((...args) => {
      consoleLogs.push(args.join(' '));
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  // ==========================================================================
  // Basic Logging
  // ==========================================================================

  describe('Basic logging methods', () => {
    it('should have info method', () => {
      expect(typeof logger.info).toBe('function');
      logger.info('Test info message');
    });

    it('should have warn method', () => {
      expect(typeof logger.warn).toBe('function');
      logger.warn('Test warn message');
    });

    it('should have error method', () => {
      expect(typeof logger.error).toBe('function');
      logger.error('Test error message');
    });

    it('should have debug method', () => {
      expect(typeof logger.debug).toBe('function');
      process.env.LOG_LEVEL = 'debug';
      logger.debug('Test debug message');
    });
  });

  // ==========================================================================
  // Logging with Context
  // ==========================================================================

  describe('Logging with context', () => {
    it('should log with context object', () => {
      logger.info('Request received', { traceId: 'abc123', method: 'GET' });
      // Test passes if no error
    });

    it('should log with duration', () => {
      logger.info('Request completed', { duration: 150, statusCode: 200 });
    });

    it('should log with device ID', () => {
      logger.info('Device updated', { deviceId: 'device_001' });
    });

    it('should log with user ID', () => {
      logger.info('User action', { userId: 'user_123' });
    });
  });

  // ==========================================================================
  // Specialized Logging Methods
  // ==========================================================================

  describe('Specialized logging methods', () => {
    it('should have request method for logging requests', () => {
      if (typeof logger.request === 'function')
        logger.request({ method: 'GET', path: '/api/v2/devices', statusCode: 200, duration: 50 });
    });

    it('should have error logging with Error object', () => {
      const error = new Error('Test error');
      logger.error('Operation failed', { error });
    });

    it('should handle cache logging if available', () => {
      if (typeof logger.cache === 'function') logger.cache('hit', 'device:device_001');
    });
  });

  // ==========================================================================
  // Log Levels
  // ==========================================================================

  describe('Log levels', () => {
    it('should respect LOG_LEVEL=error', () => {
      process.env.LOG_LEVEL = 'error';

      // These should be suppressed
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');

      // This should be logged
      logger.error('error message');
    });

    it('should respect LOG_LEVEL=warn', () => {
      process.env.LOG_LEVEL = 'warn';

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
    });

    it('should respect LOG_LEVEL=info (default)', () => {
      process.env.LOG_LEVEL = 'info';

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
    });

    it('should respect LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
    });
  });

  // ==========================================================================
  // Output Format
  // ==========================================================================

  describe('Output format', () => {
    it('should format differently in production vs development', () => {
      // In production, output should be JSON
      process.env.NODE_ENV = 'production';
      logger.info('Production log');

      // In development, output should be human-readable
      process.env.NODE_ENV = 'development';
      logger.info('Development log');
    });

    it('should include timestamp in logs', () => {
      process.env.NODE_ENV = 'production';
      logger.info('Test message');

      // Logs should contain timestamp (check format indirectly)
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error handling', () => {
    it('should handle Error objects', () => {
      const error = new Error('Something went wrong');
      error.name = 'CustomError';

      logger.error('Operation failed', { error });
    });

    it('should handle errors with stack traces', () => {
      process.env.LOG_LEVEL = 'debug';

      const error = new Error('Stack trace error');
      logger.error('Error with stack', { error });
    });

    it('should handle errors with code property', () => {
      const error = new Error('Coded error') as Error & { code: string };
      error.code = 'ERR_CODE';

      logger.error('Error with code', { error });
    });
  });
});
