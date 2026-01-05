/**
 * Test Sentry Integration
 *
 * This endpoint intentionally throws an error to test Sentry error capture.
 * Only enabled in development mode.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  // Throw a test error that Sentry should capture
  throw new Error('Test Sentry error from /api/v2/test-sentry - please ignore');
}

export async function POST() {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  // Simulate an async error
  await new Promise((resolve) => setTimeout(resolve, 100));
  throw new Error('Async test error from /api/v2/test-sentry - please ignore');
}
