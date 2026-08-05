'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { getPusherClient } from '@/lib/pusher-client';
import { ALERT_CHANNEL, READINGS_CHANNEL } from '@/lib/pusher-channels';
import type { AlertEvent } from '@/types/v2/alert.types';

/**
 * Shape of a reading received from Pusher on the 'new-readings' event.
 * This is the single source of truth for the PusherReading type -- components
 * should import it from here instead of defining their own copies.
 */
export interface PusherReading {
  metadata: {
    device_id: string;
    type: 'temperature' | 'humidity' | 'occupancy' | 'power';
  };
  timestamp: string;
  value: number;
}

type ReadingsCallback = (readings: PusherReading[]) => void;
export type AlertsCallback = (event: AlertEvent) => void;

// ============================================================================
// CONNECTION HEALTH
// ============================================================================

/**
 * What the realtime layer is currently doing, from the app's point of view.
 *
 * Not a straight copy of pusher-js's own connection states: `no-provider` and
 * `not-configured` are conditions pusher-js never reports (there is no client
 * to report them), and `unauthorized` is a channel-level failure that leaves
 * the socket itself perfectly healthy.
 */
export type RealtimeState =
  | 'connecting'
  | 'connected'
  /** Socket dropped; pusher-js is retrying on its own. */
  | 'reconnecting'
  /** Socket closed and pusher-js will NOT retry (4000-4099 close codes). */
  | 'failed'
  /** NEXT_PUBLIC_PUSHER_* not set — the client was never constructed. */
  | 'not-configured'
  /** Socket is up but the private alert channel refused us. */
  | 'unauthorized'
  /** No PusherProvider above this component. */
  | 'no-provider';

export interface RealtimeConnection {
  /** True only when alerts are genuinely arriving live. Drives the poll fallback. */
  connected: boolean;
  state: RealtimeState;
  /**
   * True when the user should be told. Distinct from `!connected` so the first
   * second of every page load — a perfectly normal `connecting` — does not
   * flash a scary banner at everyone.
   */
  degraded: boolean;
  /** Operator-facing explanation. Null while healthy. */
  message: string | null;
  /** True when nothing will recover this without a reload. */
  terminal: boolean;
}

/** Internal state the provider tracks; `RealtimeConnection` is derived from it. */
interface RealtimeStatus {
  /** Raw pusher-js connection state, or null before the client exists. */
  socket: string | null;
  /** Whether the private alert channel subscription succeeded. */
  alerts: 'pending' | 'subscribed' | 'rejected';
  configured: boolean;
  /** Set when Pusher reports a close code it will not retry. */
  fatal: string | null;
}

const INITIAL_STATUS: RealtimeStatus = {
  socket: null,
  alerts: 'pending',
  configured: true,
  fatal: null,
};

/**
 * Pusher close codes 4000-4099 are terminal by protocol: the client is told not
 * to retry. 4004 (quota exceeded) and 4001 (unknown app key) both land here, and
 * both otherwise present as a socket that simply stops delivering forever.
 */
function isTerminalCloseCode(code: number | undefined): boolean {
  return typeof code === 'number' && code >= 4000 && code <= 4099;
}

function deriveConnection(status: RealtimeStatus): RealtimeConnection {
  if (!status.configured)
    return {
      connected: false,
      state: 'not-configured',
      degraded: true,
      message:
        'Real-time updates are not configured on this deployment. Data refreshes on a timer instead.',
      terminal: true,
    };

  if (status.fatal)
    return {
      connected: false,
      state: 'failed',
      degraded: true,
      message: `${status.fatal} Reload the page to try again. Data refreshes on a timer meanwhile.`,
      terminal: true,
    };

  if (status.socket === 'failed' || status.socket === 'disconnected')
    return {
      connected: false,
      state: 'failed',
      degraded: true,
      message:
        'The real-time connection closed and will not reopen on its own. Reload the page to restore live updates.',
      terminal: true,
    };

  if (status.socket === 'unavailable')
    return {
      connected: false,
      state: 'reconnecting',
      degraded: true,
      message:
        'Lost the real-time connection — retrying. Data refreshes on a timer until it is back.',
      terminal: false,
    };

  if (status.socket !== 'connected')
    return {
      connected: false,
      state: 'connecting',
      degraded: false,
      message: null,
      terminal: false,
    };

  // Socket is up. The alert channel can still have been refused on its own —
  // an expired session, or a member removed from the org — and that leaves
  // readings flowing while alerts silently stop.
  if (status.alerts === 'rejected')
    return {
      connected: false,
      state: 'unauthorized',
      degraded: true,
      message:
        'Not authorized for live alerts. Your session may have expired — sign in again. Alerts refresh on a timer meanwhile.',
      terminal: true,
    };

  if (status.alerts === 'pending')
    return {
      connected: false,
      state: 'connecting',
      degraded: false,
      message: null,
      terminal: false,
    };

  return { connected: true, state: 'connected', degraded: false, message: null, terminal: false };
}

/**
 * What a consumer sees with no provider above it. A frozen module constant
 * rather than a fresh object per call so it is referentially stable — hooks
 * feed it straight into React Query options.
 */
const NO_PROVIDER_CONNECTION: RealtimeConnection = Object.freeze({
  connected: false,
  state: 'no-provider' as const,
  degraded: false,
  message: null,
  terminal: false,
});

interface PusherContextValue {
  /** Register a callback that fires every time new readings arrive. */
  subscribe: (cb: ReadingsCallback) => void;
  /** Remove a previously registered callback. */
  unsubscribe: (cb: ReadingsCallback) => void;
  /** Register a callback that fires for every alert envelope. */
  subscribeAlerts: (cb: AlertsCallback) => void;
  /** Remove a previously registered alert callback. */
  unsubscribeAlerts: (cb: AlertsCallback) => void;
  /** Live health of the realtime layer. */
  connection: RealtimeConnection;
}

const PusherContext = createContext<PusherContextValue | null>(null);

/**
 * Provides the app's Pusher subscriptions and reports their health.
 *
 * TWO channels, deliberately:
 *   - `InfraSight` (public) carries `new-readings`. It predates alerting and
 *     `app/api/v2/cron/simulate/route.ts` publishes to it by that name.
 *   - `private-alerts` carries `alert-event`. Alert payloads name a rule, a
 *     device and the value that tripped it, so they are gated behind
 *     `/api/pusher/auth`.
 *
 * All consuming components share these subscriptions instead of each creating
 * their own, which prevents duplicate event processing and the associated extra
 * re-renders.
 */
export function PusherProvider({ children }: { children: React.ReactNode }) {
  const callbacksRef = useRef<Set<ReadingsCallback>>(new Set());
  const alertCallbacksRef = useRef<Set<AlertsCallback>>(new Set());
  const [status, setStatus] = useState<RealtimeStatus>(INITIAL_STATUS);

  useEffect(() => {
    // Gracefully degrade when Pusher env vars are not configured. This used to
    // be a console.warn and nothing else, which meant a misconfigured
    // deployment looked identical to a quiet one: "No open alerts." forever.
    let pusher: ReturnType<typeof getPusherClient>;
    try {
      pusher = getPusherClient();
    } catch {
      console.warn(
        'PusherProvider: Pusher environment variables are not set. Real-time updates are disabled.'
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reflecting the state of an external system (the Pusher client) into React at subscribe time; it cannot be read during render because getPusherClient() must not run on the server.
      setStatus(prev => ({ ...prev, configured: false }));
      return;
    }

    const readingsChannel = pusher.subscribe(READINGS_CHANNEL);
    const alertChannel = pusher.subscribe(ALERT_CHANNEL);

    const handler = (newReadings: PusherReading[]) => {
      callbacksRef.current.forEach(cb => {
        try {
          cb(newReadings);
        } catch (err) {
          console.error('PusherProvider: error in subscriber callback', err);
        }
      });
    };

    const alertHandler = (event: AlertEvent) => {
      alertCallbacksRef.current.forEach(cb => {
        try {
          cb(event);
        } catch (err) {
          console.error('PusherProvider: error in alert subscriber callback', err);
        }
      });
    };

    const stateChangeHandler = ({ current }: { current: string }) => {
      setStatus(prev => ({
        ...prev,
        socket: current,
        // A fresh connection clears a previous fatal and gives a previously
        // refused alert channel another chance — pusher-js re-authorizes every
        // channel on reconnect, so a rejection from an expired session should
        // not outlive the session it was about.
        ...(current === 'connected'
          ? { fatal: null, alerts: prev.alerts === 'rejected' ? ('pending' as const) : prev.alerts }
          : {}),
      }));
    };

    // pusher-js reports transport failures here. The payload for a protocol
    // close carries the code under error.data.code.
    const errorHandler = (err: unknown) => {
      const data = (err as { error?: { data?: { code?: number; message?: string } } })?.error?.data;
      console.error('PusherProvider: connection error', err);

      if (isTerminalCloseCode(data?.code))
        setStatus(prev => ({
          ...prev,
          fatal: `Real-time updates stopped (Pusher error ${data?.code}${
            data?.message ? `: ${data.message}` : ''
          }).`,
        }));
    };

    const subscriptionSucceeded = () => setStatus(prev => ({ ...prev, alerts: 'subscribed' }));

    const subscriptionError = (err: unknown) => {
      console.error('PusherProvider: alert channel subscription failed', err);
      setStatus(prev => ({ ...prev, alerts: 'rejected' }));
    };

    readingsChannel.bind('new-readings', handler);
    alertChannel.bind('alert-event', alertHandler);
    alertChannel.bind('pusher:subscription_succeeded', subscriptionSucceeded);
    alertChannel.bind('pusher:subscription_error', subscriptionError);
    pusher.connection.bind('state_change', stateChangeHandler);
    pusher.connection.bind('error', errorHandler);

    // Seed from the live socket. getPusherClient() is a singleton, so on a
    // remount it may already be connected and already subscribed — in which
    // case neither state_change nor subscription_succeeded is coming, and
    // waiting for them would leave the app polling forever.
    setStatus(prev => ({
      ...prev,
      socket: pusher.connection.state ?? prev.socket,
      alerts: alertChannel.subscribed ? 'subscribed' : prev.alerts,
    }));

    return () => {
      readingsChannel.unbind('new-readings', handler);
      alertChannel.unbind('alert-event', alertHandler);
      alertChannel.unbind('pusher:subscription_succeeded', subscriptionSucceeded);
      alertChannel.unbind('pusher:subscription_error', subscriptionError);
      pusher.connection.unbind('state_change', stateChangeHandler);
      pusher.connection.unbind('error', errorHandler);
      pusher.unsubscribe(READINGS_CHANNEL);
      pusher.unsubscribe(ALERT_CHANNEL);
    };
  }, []);

  const subscribe = useCallback((cb: ReadingsCallback) => {
    callbacksRef.current.add(cb);
  }, []);

  const unsubscribe = useCallback((cb: ReadingsCallback) => {
    callbacksRef.current.delete(cb);
  }, []);

  const subscribeAlerts = useCallback((cb: AlertsCallback) => {
    alertCallbacksRef.current.add(cb);
  }, []);

  const unsubscribeAlerts = useCallback((cb: AlertsCallback) => {
    alertCallbacksRef.current.delete(cb);
  }, []);

  const connection = useMemo(() => deriveConnection(status), [status]);

  const value = useMemo(
    () => ({ subscribe, unsubscribe, subscribeAlerts, unsubscribeAlerts, connection }),
    [subscribe, unsubscribe, subscribeAlerts, unsubscribeAlerts, connection]
  );

  return <PusherContext.Provider value={value}>{children}</PusherContext.Provider>;
}

/**
 * Health of the realtime layer, for anything that needs to behave differently
 * when live updates are not arriving — the degraded banner, and the poll
 * fallback in `lib/query/hooks/useAlerts.ts`.
 *
 * Returns a "not connected" reading rather than throwing when there is no
 * provider: a component rendered outside the provider genuinely is not
 * receiving live updates, and the honest answer makes callers fall back to
 * polling instead of trusting a socket that isn't there.
 */
export function useRealtimeConnection(): RealtimeConnection {
  const ctx = useContext(PusherContext);
  return ctx?.connection ?? NO_PROVIDER_CONNECTION;
}

/**
 * Hook for components that need to react to real-time Pusher readings.
 *
 * Usage:
 * ```ts
 * usePusherReadings((newReadings) => {
 *   // process newReadings
 * });
 * ```
 *
 * The callback is stable-reference safe: if the caller wraps it in
 * useCallback the effect will not re-subscribe on every render.
 */
export function usePusherReadings(callback: ReadingsCallback): void {
  const ctx = useContext(PusherContext);

  // Keep a mutable ref so the effect closure always calls the latest callback
  // without needing to re-subscribe on every render.
  const callbackRef = useRef<ReadingsCallback>(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!ctx) {
      console.warn(
        'usePusherReadings: PusherProvider is not in the component tree. Real-time updates are disabled.'
      );
      return;
    }

    const stableCallback: ReadingsCallback = (readings) => {
      callbackRef.current(readings);
    };

    ctx.subscribe(stableCallback);
    return () => {
      ctx.unsubscribe(stableCallback);
    };
  }, [ctx]);
}

/**
 * Hook for components that need to react to real-time alert envelopes.
 *
 * The callback is held in a ref so a caller that does not memoize will not cause
 * a re-subscribe on every render. The ref is refreshed in a commit-phase effect
 * rather than assigned during render: assigning during render violates
 * react-hooks/refs, and Pusher handlers only ever read the ref asynchronously,
 * long after commit.
 */
export function usePusherAlerts(callback: AlertsCallback): void {
  const ctx = useContext(PusherContext);

  const callbackRef = useRef<AlertsCallback>(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!ctx) {
      console.warn(
        'usePusherAlerts: PusherProvider is not in the component tree. Real-time alerts are disabled.'
      );
      return;
    }

    const stableCallback: AlertsCallback = event => {
      callbackRef.current(event);
    };

    ctx.subscribeAlerts(stableCallback);
    return () => {
      ctx.unsubscribeAlerts(stableCallback);
    };
  }, [ctx]);
}
