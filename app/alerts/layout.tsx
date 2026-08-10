import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Alerts',
  description:
    'Open and historical alerts raised by threshold rules, with acknowledge and resolve workflows.',
  path: '/alerts',
});

export default function AlertsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
