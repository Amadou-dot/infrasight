import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Deleted devices',
  description: 'Soft-deleted devices awaiting restore. Admin only.',
  path: '/devices/deleted',
  index: false,
});

export default function DeletedDevicesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
