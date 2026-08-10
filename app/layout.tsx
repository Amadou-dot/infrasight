import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { SITE_NAME, SITE_URL, TITLE_TEMPLATE } from '@/lib/seo';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const TITLE = `${SITE_NAME} — Real-time IoT building monitoring`;
const DESCRIPTION =
  'Real-time IoT sensor monitoring for building management: 500 sensors streamed ' +
  'over WebSockets into a dashboard with threshold alerting, anomaly detection, ' +
  'and predictive maintenance.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: TITLE_TEMPLATE,
  },
  description: DESCRIPTION,
  keywords: [
    'IoT monitoring',
    'building management',
    'sensor dashboard',
    'real-time analytics',
    'threshold alerting',
    'anomaly detection',
    'predictive maintenance',
  ],
  authors: [{ name: 'Amadou Seck', url: 'https://github.com/Amadou-dot' }],
  creator: 'Amadou Seck',
  // Root-page canonical. Child routes override this (and openGraph) through
  // routeMetadata() in their own layouts — see lib/seo.ts for why it cannot
  // be inherited from here.
  alternates: { canonical: '/' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    siteName: SITE_NAME,
    type: 'website',
  },
  // Images come from the app/opengraph-image.png and app/twitter-image.png
  // file conventions, which apply to every route.
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
