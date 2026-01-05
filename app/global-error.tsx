'use client';

/**
 * Global Error Boundary for App Router
 *
 * This component catches errors in the root layout and reports them to Sentry.
 * It must be a Client Component ('use client').
 */

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report the error to Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
            <div className="text-center">
              <h1 className="mb-4 text-4xl font-bold text-destructive">
                Something went wrong!
              </h1>
              <p className="mb-6 text-muted-foreground">
                An unexpected error has occurred. Our team has been notified.
              </p>
              {error.digest && (
                <p className="mb-4 font-mono text-sm text-muted-foreground">
                  Error ID: {error.digest}
                </p>
              )}
              <button
                onClick={() => reset()}
                className="rounded bg-primary px-6 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Try again
              </button>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
