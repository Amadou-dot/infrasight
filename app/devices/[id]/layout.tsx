import type { Metadata } from 'next';
import { routeMetadata } from '@/lib/seo';

/**
 * Title derives from the device id in the URL — the same value the page's own
 * <h1> renders — so no database round-trip is needed to stream metadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const deviceId = decodeURIComponent(id);
  return routeMetadata({
    title: deviceId,
    description: `Live readings, health metrics, and audit trail for ${deviceId}.`,
    path: `/devices/${encodeURIComponent(deviceId)}`,
  });
}

export default function DeviceDetailLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
