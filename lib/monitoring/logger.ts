/**
 * Structured Logger
 *
 * Provides consistent JSON logging with:
 * - Log levels (debug, info, warn, error)
 * - Request context (trace ID, method, path)
 * - Performance timing
 * - Validation failure tracking
 *
 * In production, outputs JSON for log aggregation.
 * In development, outputs human-readable format.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  /** Request trace ID for correlation */
  traceId?: string;
  /** HTTP method */
  method?: string;
  /** Request path */
  path?: string;
  /** HTTP status code */
  statusCode?: number;
  /** Request duration in milliseconds */
  duration?: number;
  /** User or API key identifier */
  userId?: string;
  /** Device ID for device-related operations */
  deviceId?: string;
  /** Additional context fields */
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get configured log level from environment
 */
function getConfiguredLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  return LOG_LEVELS[level] !== undefined ? level : 'info';
}

/**
 * Check if a message at the given level should be logged
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getConfiguredLevel()];
}

/**
 * Format log entry based on environment
 */
function formatLog(entry: LogEntry): string {
  // In production, output JSON for log aggregation
  if (process.env.NODE_ENV === 'production') return JSON.stringify(entry);

  // In development, use readable format
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();
  const levelColor = {
    debug: '\x1b[90m', // gray
    info: '\x1b[36m', // cyan
    warn: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
  }[entry.level];
  const reset = '\x1b[0m';

  let output = `${levelColor}[${timestamp}] ${entry.level.toUpperCase()}${reset}: ${entry.message}`;

  if (entry.context && Object.keys(entry.context).length > 0)
    output += ` ${JSON.stringify(entry.context)}`;

  if (entry.error) {
    output += `\n  Error: ${entry.error.message}`;
    if (entry.error.stack && process.env.LOG_LEVEL === 'debug')
      output += `\n  Stack: ${entry.error.stack}`;
  }

  return output;
}

/**
 * Internal log function
 */
function log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context: context && Object.keys(context).length > 0 ? context : undefined,
  };

  if (error)
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as Error & { code?: string }).code,
    };

  const formatted = formatLog(entry);

  switch (level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

/**
 * Logger instance with convenience methods
 */
export const logger = {
  /**
   * Debug level log - verbose information for debugging
   */
  debug: (message: string, context?: LogContext) => log('debug', message, context),

  /**
   * Info level log - general operational information
   */
  info: (message: string, context?: LogContext) => log('info', message, context),

  /**
   * Warning level log - potentially problematic situations
   */
  warn: (message: string, context?: LogContext, error?: Error) =>
    log('warn', message, context, error),

  /**
   * Error level log - error conditions
   */
  error: (message: string, context?: LogContext, error?: Error) =>
    log('error', message, context, error),

  /**
   * Log API request completion with timing
   */
  request: (
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context?: Partial<LogContext>
  ) => {
    const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    log(level, `${method} ${path} ${statusCode} ${duration}ms`, {
      method,
      path,
      statusCode,
      duration,
      ...context,
    });
  },

  /**
   * Log validation failure with detailed context
   */
  validationFailure: (
    path: string,
    errors: Array<{ path: string; message: string }>,
    context?: Partial<LogContext>
  ) => {
    log('warn', `Validation failed: ${path}`, {
      path,
      validationErrors: errors,
      errorCount: errors.length,
      ...context,
    });
  },

  /**
   * Log slow query warning (queries > threshold)
   */
  slowQuery: (
    operation: string,
    duration: number,
    query?: Record<string, unknown>,
    context?: Partial<LogContext>
  ) => {
    log('warn', `Slow query: ${operation} took ${duration}ms`, {
      operation,
      duration,
      query,
      ...context,
    });
  },

  /**
   * Log rate limit event
   */
  rateLimit: (
    identifier: string,
    endpoint: string,
    current: number,
    limit: number,
    context?: Partial<LogContext>
  ) => {
    log('warn', `Rate limit exceeded: ${endpoint}`, {
      identifier: identifier.slice(0, 8) + '...', // Truncate for privacy
      endpoint,
      current,
      limit,
      ...context,
    });
  },

  /**
   * Log cache event (hit/miss)
   */
  cache: (
    event: 'hit' | 'miss' | 'set' | 'invalidate',
    key: string,
    context?: Partial<LogContext>
  ) => {
    log('debug', `Cache ${event}: ${key}`, {
      cacheEvent: event,
      cacheKey: key,
      ...context,
    });
  },

  /**
   * Log authentication event
   */
  auth: (
    event: 'success' | 'failure' | 'forbidden',
    identifier: string,
    context?: Partial<LogContext>
  ) => {
    const level: LogLevel = event === 'success' ? 'info' : 'warn';
    log(level, `Auth ${event}: ${identifier}`, {
      authEvent: event,
      identifier: identifier.slice(0, 8) + '...', // Truncate for privacy
      ...context,
    });
  },
};

export default logger;
