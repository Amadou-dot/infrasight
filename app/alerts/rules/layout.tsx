import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Alert rules',
  description:
    'Threshold alert rules: which metrics they watch, which devices they cover, and when they fire.',
  path: '/alerts/rules',
});

export default function AlertRulesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
