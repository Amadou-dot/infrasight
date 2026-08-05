'use client';

import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
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
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

/**
 * Cap on simultaneously visible toasts.
 *
 * Alerts are produced by a background evaluator, not by a click: one ingest can
 * fire up to ALERT_EVENT_MAX (20) at once. Without a limit those stack past the
 * top of the viewport and cover the app. Overflow is queued by react-toastify
 * and shown as earlier toasts expire.
 */
const MAX_VISIBLE_TOASTS = 4;

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>InfraSight</title>
        <meta
          name="description"
          content="Real-time sensor data and analytics for infrastructure monitoring."
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
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
                  autoClose={false} stays as the CONTAINER default so
                  user-initiated toasts raised elsewhere in the app keep the
                  behaviour they were written against. AlertToaster overrides it
                  per toast, and per-toast options win over container props.
                */}
                <ToastContainer
                  position="bottom-center"
                  autoClose={false}
                  limit={MAX_VISIBLE_TOASTS}
                  pauseOnFocusLoss
                  pauseOnHover
                  theme="colored"
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
          </ThemeProvider>
          {/* Dev tools only in development */}
          {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
        </QueryClientProvider>
      </body>
    </html>
  );
}
