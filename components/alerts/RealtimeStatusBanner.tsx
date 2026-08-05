'use client';

import { WifiOff } from 'lucide-react';
import { useRealtimeConnection } from '@/lib/pusher-context';

/**
 * Tells the viewer when live alert delivery is down.
 *
 * Exists because the failure it reports is invisible by construction: a dead
 * Pusher socket and a genuinely quiet building both render "No open alerts."
 * Terminal Pusher close codes (4004 quota exceeded, 4001 bad app key) never
 * auto-reconnect, so a wall display can sit on that screen indefinitely with
 * nothing on it suggesting anything is wrong.
 *
 * Renders nothing while healthy, and nothing during the ordinary
 * connecting/handshaking window on page load — see `degraded` vs `connected` in
 * lib/pusher-context.tsx. It is mounted in the root layout inside `<SignedIn>`,
 * so every alert surface (the alerts list, device pages, the dashboard) is
 * covered by one instance without any page having to opt in.
 */
export function RealtimeStatusBanner() {
  const { degraded, message } = useRealtimeConnection();

  if (!degraded) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="realtime-status-banner"
      className="flex w-full items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">Live updates unavailable.</span>
      {message ? <span className="text-amber-800/90 dark:text-amber-200/80">{message}</span> : null}
    </div>
  );
}

export default RealtimeStatusBanner;
