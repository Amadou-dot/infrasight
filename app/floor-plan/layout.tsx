import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Floor plan',
  description:
    'Live floor plan of every building — sensors update in place as readings arrive in real time.',
  path: '/floor-plan',
});

export default function FloorPlanLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
