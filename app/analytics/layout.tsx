import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Analytics',
  description:
    'Energy usage, device health, anomaly detection, and temperature correlation across the sensor fleet.',
  path: '/analytics',
});

export default function AnalyticsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
