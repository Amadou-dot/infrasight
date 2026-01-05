/**
 * Sentry Client Configuration
 *
 * This file configures the initialization of Sentry on the client.
 * The config you add here will be used whenever a user loads a page in their browser.
 * https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Set tracesSampleRate to 1.0 to capture 100% of transactions for tracing.
  // In production, you may want to lower this value.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Replay is only available in the client
  replaysOnErrorSampleRate: 1.0,

  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  integrations: [
    Sentry.replayIntegration({
      // Additional Replay configuration goes in here, for example:
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

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
