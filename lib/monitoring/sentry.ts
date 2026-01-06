/**
 * Optional Sentry Integration
 *
 * Conditionally initializes Sentry if SENTRY_DSN is configured.
 * Provides error tracking and performance monitoring.
 */

import type * as SentryTypes from '@sentry/nextjs';

let sentryInitialized = false;
let Sentry: typeof SentryTypes | null = null;

/**
 * Check if Sentry is configured
 */
export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

/**
 * Initialize Sentry if configured
 * Should be called early in the application lifecycle
 */
export async function initSentry(): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) 
    return false;
  

  if (sentryInitialized) 
    return true;
  

  try {
    // Dynamic import for optional Sentry dependency
    Sentry = await import('@sentry/nextjs');

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      // Sample rate for performance monitoring (10% in production)
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      // Capture unhandled promise rejections
      integrations: [],
      // Filter out known operational errors
      beforeSend(event) {
        // Don't send rate limit errors to Sentry (expected behavior)
        if (event.exception?.values?.[0]?.value?.includes('RATE_LIMIT')) 
          return null;
        
        // Don't send validation errors (user input issues)
        if (event.exception?.values?.[0]?.value?.includes('VALIDATION_ERROR')) 
          return null;
        
        return event;
      },
    });

    sentryInitialized = true;
    console.log('[Sentry] Initialized successfully');
    return true;
  } catch (error) {
    console.warn('[Sentry] Failed to initialize:', (error as Error).message);
    return false;
  }
}

/**
 * Capture an exception to Sentry
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>
): string | undefined {
  if (!Sentry || !sentryInitialized) 
    return undefined;
  

  return Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message to Sentry
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>
): string | undefined {
  if (!Sentry || !sentryInitialized) 
    return undefined;
  

  return Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info'
): void {
  if (!Sentry || !sentryInitialized) 
    return;
  

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level,
  });
}

/**
 * Set user context for error tracking
 */
export function setUser(user: {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
} | null): void {
  if (!Sentry || !sentryInitialized) 
    return;
  

  Sentry.setUser(user);
}

/**
 * Set additional context tags
 */
export function setTag(key: string, value: string): void {
  if (!Sentry || !sentryInitialized) 
    return;
  

  Sentry.setTag(key, value);
}

/**
 * Set extra context data
 */
export function setExtra(key: string, value: unknown): void {
  if (!Sentry || !sentryInitialized) 
    return;
  

  Sentry.setExtra(key, value);
}

/**
 * Start a new transaction for performance monitoring
 */
export function startTransaction(
  name: string,
  op: string
): { finish: () => void } | undefined {
  if (!Sentry || !sentryInitialized) 
    return undefined;
  

  const transaction = Sentry.startInactiveSpan({
    name,
    op,
  });

  return {
    finish: () => transaction?.end(),
  };
}

/**
 * Wrap a function with Sentry error handling
 */
export function withSentryErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: Record<string, unknown>
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      captureException(error as Error, { ...context, args });
      throw error;
    }
  }) as T;
}
