export function deviceDetailHref(id: string): string {
  const path = `/devices/${encodeURIComponent(id)}`;
  // The static trash page owns /devices/deleted.
  return id === 'deleted' ? `${path}/detail` : path;
}
