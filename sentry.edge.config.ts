/**
 * Sentry Edge Configuration
 *
 * This file configures the initialization of Sentry for edge features (middleware, edge routes).
 * The config you add here will be used whenever one of the edge features is loaded.
 * https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Set tracesSampleRate to 1.0 to capture 100% of transactions for tracing.
  // In production, you may want to lower this value.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Filter out known operational errors
  beforeSend(event) {
    const errorMessage = event.exception?.values?.[0]?.value;
    // Don't send rate limit errors to Sentry (expected behavior)
    if (errorMessage?.includes('RATE_LIMIT')) {
      return null;
    }
    // Don't send validation errors (user input issues)
    if (errorMessage?.includes('VALIDATION_ERROR')) {
      return null;
    }
    return event;
  },
});
