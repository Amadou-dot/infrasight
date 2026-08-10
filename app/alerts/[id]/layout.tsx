import type { Metadata } from 'next';
import { routeMetadata } from '@/lib/seo';

/**
 * The param is a MongoDB ObjectId — meaningless in a tab title — so the title
 * stays constant and the id goes into the description and canonical only.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const alertId = decodeURIComponent(id);
  return routeMetadata({
    title: 'Alert details',
    description: `Timeline, context readings, and resolution history for alert ${alertId}.`,
    path: `/alerts/${encodeURIComponent(alertId)}`,
  });
}

export default function AlertDetailLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
