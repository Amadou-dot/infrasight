'use client';

import { Suspense } from 'react';
import { ClerkThemeProvider } from '@/components/clerk-theme-provider';
import { ThemeProvider } from '@/components/theme-provider';
import TopNav from '@/components/TopNav';
import DemoBanner from '@/components/DemoBanner';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/query/queryClient';
import { PusherProvider } from '@/lib/pusher-context';
import { AlertToaster } from '@/components/alerts/AlertToaster';
import { RealtimeStatusBanner } from '@/components/alerts/RealtimeStatusBanner';
import { SignedIn } from '@clerk/nextjs';
import { Toaster } from '@/components/ui/sonner';

/**
 * Cap on simultaneously visible toasts.
 *
 * Alerts are produced by a background evaluator, not by a click: one ingest can
 * fire up to ALERT_EVENT_MAX (20) at once. Without a limit those stack past the
 * top of the viewport and cover the app. Sonner collapses the overflow into the
 * stack behind the front toasts, expanded on hover.
 */
const MAX_VISIBLE_TOASTS = 4;

/**
 * The client boundary under the server root layout. This carries the app
 * chrome (DemoBanner, TopNav, banners, toasts) along with the providers
 * because the chrome has to sit between specific providers — TopNav needs
 * Clerk and Pusher context above it, the toasters need the ToastContainer's
 * position in the tree — so splitting them would only scatter the ordering
 * constraints this file keeps in one place.
 */
export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {/*
          cacheComponents: ClerkProvider (inside ClerkThemeProvider) and
          TopNav read usePathname(), and the [id] pages read useParams().
          On routes with dynamic params those hooks suspend while the
          static shell is prerendered, so a Suspense boundary must sit
          above them or the build fails. Static routes prerender fully and
          never show this fallback.
        */}
        <Suspense fallback={null}>
          <ClerkThemeProvider>
            {/*
            PusherProvider stays an ancestor of {children}: DeviceGrid,
            FloorPlan and AnomalyChart read live readings through its
            context, and readings are public (they were before alerting
            existed). What is gated below is everything that receives or
            renders ALERT data.

            Note the provider is not itself wrapped in <SignedIn>: that
            component renders nothing until Clerk has loaded, so gating the
            provider would blank the whole app on every cold load and cut
            the readings context off from the pages inside it. The alert
            feed is gated twice instead — visibly here, and at the source by
            the private channel, whose /api/pusher/auth endpoint refuses a
            signed-out socket outright.
          */}
            <PusherProvider>
              <DemoBanner />
              <TopNav />
              <SignedIn>
                <RealtimeStatusBanner />
              </SignedIn>
              <main className="min-h-screen">{children}</main>
              {/*
              duration={Infinity} stays as the CONTAINER default so
              user-initiated toasts raised elsewhere in the app keep the
              behaviour they were written against (persist until dismissed —
              hence closeButton). AlertToaster overrides it per toast, and
              per-toast options win over Toaster props.
            */}
              <Toaster
                position="bottom-center"
                duration={Infinity}
                visibleToasts={MAX_VISIBLE_TOASTS}
                closeButton
                richColors
              />
              {/*
              Gated: AlertToaster is what turns an alert envelope into a
              visible popup carrying rule_name, device_id and trigger_value.
              /sign-in renders inside this layout, so before this gate a
              signed-out visitor sitting on the login page was shown the
              fleet's live alert traffic.
            */}
              <SignedIn>
                <AlertToaster />
              </SignedIn>
            </PusherProvider>
          </ClerkThemeProvider>
        </Suspense>
      </ThemeProvider>
      {/* Dev tools only in development */}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
