import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Maintenance',
  description:
    'Maintenance schedules and predictive forecasts for the device fleet — firmware, calibration, and emergency fixes.',
  path: '/maintenance',
});

export default function MaintenanceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
