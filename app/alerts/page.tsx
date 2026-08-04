'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertList } from '@/components/alerts/AlertList';

/**
 * Active alerts. History is a filter value on the same page rather than a
 * separate route (`/alerts?status=resolved`), following the Phase 3 URL-sync
 * precedent in app/devices/_components/useDeviceFilterParams.ts.
 */
function AlertsPageContent() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Alerts</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/alerts/rules">
            <SlidersHorizontal className="h-4 w-4 mr-2" />
            Manage rules
          </Link>
        </Button>
      </header>

      <AlertList onDeviceClick={deviceId => router.push(`/devices/${deviceId}`)} />
    </div>
  );
}

export default function AlertsPage() {
  // AlertList reads its filter state from the URL via useAlertFilterParams
  // (useSearchParams), which requires a Suspense boundary or the production
  // build fails with a prerender error. Mirrors app/devices/page.tsx.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </div>
      }
    >
      <AlertsPageContent />
    </Suspense>
  );
}
