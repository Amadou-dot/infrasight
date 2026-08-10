import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Devices',
  description:
    'Browse and filter the 500-device sensor fleet — status, type, building, floor, and battery at a glance.',
  path: '/devices',
});

export default function DevicesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
