/**
 * V2 Metrics API Route
 *
 * GET /api/v2/metrics - Prometheus-compatible metrics export
 *
 * Provides application metrics for monitoring:
 * - Request latency histograms
 * - Error counts by code
 * - Rate limit hits
 * - Cache hit/miss rates
 * - Ingestion statistics
 * - Database query statistics
 */

import { NextResponse } from 'next/server';
import { getPrometheusMetrics, getMetricsSnapshot } from '@/lib/monitoring';
import { requireAdmin } from '@/lib/auth';
import { withErrorHandler } from '@/lib/errors';

export async function GET(request: Request) {
  return withErrorHandler(async () => {
    await requireAdmin();
    const url = new URL(request.url);
    const format = url.searchParams.get('format');

    // Check if metrics are enabled
    if (process.env.ENABLE_METRICS !== 'true')
      return NextResponse.json(
        { error: 'Metrics are disabled. Set ENABLE_METRICS=true to enable.' },
        { status: 404 }
      );

    // Return JSON format if requested
    if (format === 'json') {
      const metrics = getMetricsSnapshot();
      return NextResponse.json(metrics);
    }

    // Default: Prometheus text format
    const prometheusMetrics = getPrometheusMetrics();

    return new NextResponse(prometheusMetrics, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      },
    });
  })();
}
