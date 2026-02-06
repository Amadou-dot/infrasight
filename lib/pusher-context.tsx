'use client';

import { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { getPusherClient } from '@/lib/pusher-client';

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

interface PusherContextValue {
  /** Register a callback that fires every time new readings arrive. */
  subscribe: (cb: ReadingsCallback) => void;
  /** Remove a previously registered callback. */
  unsubscribe: (cb: ReadingsCallback) => void;
}

const PusherContext = createContext<PusherContextValue | null>(null);

/**
 * Provides a single Pusher subscription to the `InfraSight` channel and
 * `new-readings` event. All consuming components share this one subscription
 * instead of each creating their own, which prevents duplicate event
 * processing and the associated extra re-renders.
 */
export function PusherProvider({ children }: { children: React.ReactNode }) {
  const callbacksRef = useRef<Set<ReadingsCallback>>(new Set());

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

    channel.bind('new-readings', handler);

    return () => {
      channel.unbind('new-readings', handler);
      pusher.unsubscribe('InfraSight');
    };
  }, []);

  const subscribe = useCallback((cb: ReadingsCallback) => {
    callbacksRef.current.add(cb);
  }, []);

  const unsubscribe = useCallback((cb: ReadingsCallback) => {
    callbacksRef.current.delete(cb);
  }, []);

  return (
    <PusherContext.Provider value={{ subscribe, unsubscribe }}>
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
  callbackRef.current = callback;

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
