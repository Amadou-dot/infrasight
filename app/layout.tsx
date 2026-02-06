'use client';

import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ClerkThemeProvider } from '@/components/clerk-theme-provider';
import { ThemeProvider } from '@/components/theme-provider';
import TopNav from '@/components/TopNav';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/query/queryClient';
import { PusherProvider } from '@/lib/pusher-context';

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
              <PusherProvider>
                <TopNav />
                <main className="min-h-screen">{children}</main>
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
