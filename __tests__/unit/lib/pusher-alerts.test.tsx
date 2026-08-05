/**
 * PusherProvider realtime boundary tests.
 *
 * Two things are under test here and they are easy to confuse:
 *
 * 1. CHANNEL SPLIT. Readings stay on the public `InfraSight` channel (the
 *    simulate route publishes there by that name and predates alerting);
 *    alerts move to the `private-alerts` channel, whose `private-` prefix is
 *    what forces pusher-js through /api/pusher/auth. A test that only checked
 *    "alert-event is bound somewhere" would pass against the leaky
 *    single-public-channel arrangement this replaced, so the assertions below
 *    are about WHICH channel each event is bound to.
 *
 * 2. CONNECTION HEALTH. A dead socket and a quiet building look identical on
 *    screen. The provider therefore has to distinguish connecting (normal, say
 *    nothing) from unavailable/failed/unauthorized (degraded, say so), and a
 *    terminal Pusher close code from a retryable blip.
 */

import { render, act } from '@testing-library/react';
import React from 'react';
import {
  PusherProvider,
  usePusherAlerts,
  useRealtimeConnection,
  type RealtimeConnection,
} from '@/lib/pusher-context';
import { ALERT_CHANNEL, READINGS_CHANNEL } from '@/lib/pusher-channels';
import { getPusherClient } from '@/lib/pusher-client';
import type { AlertEvent } from '@/types/v2/alert.types';

type Handler = (data?: unknown) => void;

/** Handlers keyed `channel:event`, so a test can assert WHERE a bind landed. */
const handlers = new Map<string, Handler>();
const connectionHandlers = new Map<string, Handler>();
const unbind = jest.fn();
const unsubscribe = jest.fn();
let socketState = 'initialized';

jest.mock('@/lib/pusher-client', () => ({
  getPusherClient: jest.fn(),
}));

function makeClient() {
  return {
    subscribe: (channelName: string) => ({
      subscribed: false,
      bind: (event: string, handler: Handler) => {
        handlers.set(`${channelName}:${event}`, handler);
      },
      unbind: (event: string) => {
        unbind(`${channelName}:${event}`);
        handlers.delete(`${channelName}:${event}`);
      },
    }),
    unsubscribe,
    connection: {
      get state() {
        return socketState;
      },
      bind: (event: string, handler: Handler) => {
        connectionHandlers.set(event, handler);
      },
      unbind: (event: string) => {
        connectionHandlers.delete(event);
      },
    },
  };
}

function Consumer({ onEvent }: { onEvent: (e: AlertEvent) => void }) {
  usePusherAlerts(onEvent);
  return null;
}

/**
 * Publishes the live connection value so assertions can read it directly.
 * Written from an effect rather than during render — assigning to a module
 * variable mid-render is a side effect React makes no promises about.
 */
let latestConnection: RealtimeConnection | null = null;
function ConnectionProbe() {
  const connection = useRealtimeConnection();
  React.useEffect(() => {
    latestConnection = connection;
  }, [connection]);
  return null;
}

/** Drives the socket through pusher-js's own state_change event. */
function moveSocketTo(state: string) {
  socketState = state;
  act(() => connectionHandlers.get('state_change')?.({ current: state }));
}

function renderProvider() {
  return render(
    <PusherProvider>
      <Consumer onEvent={jest.fn()} />
      <ConnectionProbe />
    </PusherProvider>
  );
}

beforeEach(() => {
  handlers.clear();
  connectionHandlers.clear();
  unbind.mockClear();
  unsubscribe.mockClear();
  latestConnection = null;
  socketState = 'initialized';
  (getPusherClient as jest.Mock).mockReset();
  (getPusherClient as jest.Mock).mockImplementation(() => makeClient());
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('channel split', () => {
  it('keeps the alert channel private', () => {
    // If this ever loses its prefix, pusher-js stops calling /api/pusher/auth
    // and the whole authorization story silently evaporates.
    expect(ALERT_CHANNEL.startsWith('private-')).toBe(true);
  });

  it('leaves readings on the public channel the simulate route publishes to', () => {
    expect(READINGS_CHANNEL).toBe('InfraSight');
  });

  it('binds alert-event on the PRIVATE channel, not the readings channel', () => {
    renderProvider();

    expect(handlers.has(`${ALERT_CHANNEL}:alert-event`)).toBe(true);
    expect(handlers.has(`${READINGS_CHANNEL}:alert-event`)).toBe(false);
  });

  it('binds new-readings on the PUBLIC channel, not the alert channel', () => {
    renderProvider();

    expect(handlers.has(`${READINGS_CHANNEL}:new-readings`)).toBe(true);
    expect(handlers.has(`${ALERT_CHANNEL}:new-readings`)).toBe(false);
  });

  it('delivers a fired envelope to subscribers', () => {
    const onEvent = jest.fn();
    render(
      <PusherProvider>
        <Consumer onEvent={onEvent} />
      </PusherProvider>
    );

    const envelope: AlertEvent = { kind: 'fired', alerts: [] };
    act(() => handlers.get(`${ALERT_CHANNEL}:alert-event`)!(envelope));

    expect(onEvent).toHaveBeenCalledWith(envelope);
  });

  it('delivers a storm envelope', () => {
    const onEvent = jest.fn();
    render(
      <PusherProvider>
        <Consumer onEvent={onEvent} />
      </PusherProvider>
    );

    const envelope: AlertEvent = {
      kind: 'storm',
      of: 'fired',
      count: 312,
      by_severity: { info: 0, warning: 12, critical: 300 },
      since: '2026-08-01T12:00:00.000Z',
    };
    act(() => handlers.get(`${ALERT_CHANNEL}:alert-event`)!(envelope));

    expect(onEvent).toHaveBeenCalledWith(envelope);
  });

  it('unbinds both events and unsubscribes both channels on unmount', () => {
    const { unmount } = renderProvider();

    unmount();

    expect(unbind).toHaveBeenCalledWith(`${ALERT_CHANNEL}:alert-event`);
    expect(unbind).toHaveBeenCalledWith(`${READINGS_CHANNEL}:new-readings`);
    expect(unsubscribe).toHaveBeenCalledWith(READINGS_CHANNEL);
    expect(unsubscribe).toHaveBeenCalledWith(ALERT_CHANNEL);
  });

  it('unbinds the connection handlers on unmount', () => {
    const { unmount } = renderProvider();
    expect(connectionHandlers.has('state_change')).toBe(true);

    unmount();

    expect(connectionHandlers.has('state_change')).toBe(false);
    expect(connectionHandlers.has('error')).toBe(false);
  });

  it('stops delivering after a subscriber unmounts', () => {
    const onEvent = jest.fn();
    function Toggle({ show }: { show: boolean }) {
      return <PusherProvider>{show ? <Consumer onEvent={onEvent} /> : null}</PusherProvider>;
    }

    const { rerender } = render(<Toggle show />);
    rerender(<Toggle show={false} />);

    act(() => handlers.get(`${ALERT_CHANNEL}:alert-event`)?.({ kind: 'fired', alerts: [] }));

    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('connection health', () => {
  /** Socket up AND the private channel accepted us. */
  function reachHealthy() {
    moveSocketTo('connected');
    act(() => handlers.get(`${ALERT_CHANNEL}:pusher:subscription_succeeded`)?.());
  }

  it('reports connected once the socket is up and the private channel accepted', () => {
    renderProvider();

    reachHealthy();

    expect(latestConnection).toMatchObject({
      connected: true,
      state: 'connected',
      degraded: false,
    });
  });

  it('is not connected, but also not degraded, while still connecting', () => {
    renderProvider();

    moveSocketTo('connecting');

    // Nothing is wrong yet — a banner here would fire on every cold page load.
    expect(latestConnection).toMatchObject({ connected: false, degraded: false });
  });

  it('goes degraded and retryable when the socket becomes unavailable', () => {
    renderProvider();
    reachHealthy();

    moveSocketTo('unavailable');

    expect(latestConnection).toMatchObject({
      connected: false,
      state: 'reconnecting',
      degraded: true,
      terminal: false,
    });
    expect(latestConnection!.message).toEqual(expect.any(String));
  });

  it('marks a terminal Pusher close code as failed and not self-healing', () => {
    renderProvider();
    reachHealthy();

    // 4004 = quota exceeded. pusher-js will not retry a 4000-4099 close, so
    // without this the app looks connected forever while receiving nothing.
    act(() =>
      connectionHandlers.get('error')?.({
        error: { data: { code: 4004, message: 'over quota' } },
      })
    );

    expect(latestConnection).toMatchObject({
      connected: false,
      state: 'failed',
      degraded: true,
      terminal: true,
    });
    expect(latestConnection!.message).toContain('4004');
  });

  it('treats a retryable close code as a blip, not a failure', () => {
    renderProvider();
    reachHealthy();

    // 4100+ means "reconnect after a backoff" — pusher-js handles it itself.
    act(() => connectionHandlers.get('error')?.({ error: { data: { code: 4200 } } }));

    expect(latestConnection).toMatchObject({ connected: true, terminal: false });
  });

  it('goes unauthorized when the private alert channel refuses the subscription', () => {
    renderProvider();
    moveSocketTo('connected');

    act(() =>
      handlers.get(`${ALERT_CHANNEL}:pusher:subscription_error`)?.({ status: 403 })
    );

    // The socket itself is fine — readings keep flowing — but alerts are dead,
    // which is precisely the case that must still drive the poll fallback.
    expect(latestConnection).toMatchObject({
      connected: false,
      state: 'unauthorized',
      degraded: true,
    });
  });

  it('surfaces missing Pusher env vars as a degraded state, not just a console warning', () => {
    (getPusherClient as jest.Mock).mockImplementation(() => {
      throw new Error('Missing required Pusher environment variables.');
    });

    render(
      <PusherProvider>
        <ConnectionProbe />
      </PusherProvider>
    );

    expect(latestConnection).toMatchObject({
      connected: false,
      state: 'not-configured',
      degraded: true,
      terminal: true,
    });
  });

  it('reports not-connected with no provider in the tree', () => {
    render(<ConnectionProbe />);

    expect(latestConnection).toMatchObject({ connected: false, state: 'no-provider' });
  });
});
