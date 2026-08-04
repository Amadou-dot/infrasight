'use client';

import { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { getPusherClient } from '@/lib/pusher-client';
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

interface PusherContextValue {
  /** Register a callback that fires every time new readings arrive. */
  subscribe: (cb: ReadingsCallback) => void;
  /** Remove a previously registered callback. */
  unsubscribe: (cb: ReadingsCallback) => void;
  /** Register a callback that fires for every alert envelope. */
  subscribeAlerts: (cb: AlertsCallback) => void;
  /** Remove a previously registered alert callback. */
  unsubscribeAlerts: (cb: AlertsCallback) => void;
}

const PusherContext = createContext<PusherContextValue | null>(null);

/**
 * Provides a single Pusher subscription to the `InfraSight` channel and its
 * `new-readings` and `alert-event` events. All consuming components share
 * this one subscription instead of each creating their own, which prevents
 * duplicate event processing and the associated extra re-renders.
 */
export function PusherProvider({ children }: { children: React.ReactNode }) {
  const callbacksRef = useRef<Set<ReadingsCallback>>(new Set());
  const alertCallbacksRef = useRef<Set<AlertsCallback>>(new Set());

  useEffect(() => {
    // Gracefully degrade when Pusher env vars are not configured.
    let pusher: ReturnType<typeof getPusherClient>;
    try {
      pusher = getPusherClient();
    } catch {
      console.warn(
        'PusherProvider: Pusher environment variables are not set. Real-time updates are disabled.'
      );
      return;
    }

    const channel = pusher.subscribe('InfraSight');

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

    channel.bind('new-readings', handler);
    channel.bind('alert-event', alertHandler);

    return () => {
      channel.unbind('new-readings', handler);
      channel.unbind('alert-event', alertHandler);
      pusher.unsubscribe('InfraSight');
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

  return (
    <PusherContext.Provider
      value={{ subscribe, unsubscribe, subscribeAlerts, unsubscribeAlerts }}
    >
      {children}
    </PusherContext.Provider>
  );
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
