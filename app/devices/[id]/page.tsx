'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { ArrowLeft, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DeviceDetailView from '@/components/devices/DeviceDetailView';
import { useDeviceDetail } from '@/components/devices/useDeviceDetail';

/**
 * Canonical, shareable device page. The grid also opens a modal for quick inspection,
 * but this route is what survives a refresh and can be pasted into a chat during an
 * incident.
 */
export default function DeviceDetailPage() {
  const params = useParams<{ id: string }>();
  const deviceId = params?.id ? decodeURIComponent(params.id) : null;

  const {
    device,
    recentReadings,
    auditLog,
    loading,
    error,
    notFound: missing,
  } = useDeviceDetail(deviceId);

  // Renders the styled app-wide 404 for ids that do not resolve.
  if (missing) notFound();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6 space-y-4">
        <Link
          href="/devices"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to devices
        </Link>
        <div className="flex items-center gap-3">
          <Monitor className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground break-all">
            {deviceId ?? 'Device'}
          </h1>
        </div>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      )}

      {error && !loading && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
          {error}
          <Button
            variant="outline"
            size="sm"
            className="ml-4"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      )}

      {device && !loading && (
        <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <DeviceDetailView device={device} recentReadings={recentReadings} auditLog={auditLog} />
        </div>
      )}
    </div>
  );
}
