/**
 * usePusherAlerts Tests
 */

import { render, act } from '@testing-library/react';
import React from 'react';
import { PusherProvider, usePusherAlerts } from '@/lib/pusher-context';
import { getPusherClient } from '@/lib/pusher-client';
import type { AlertEvent } from '@/types/v2/alert.types';

const handlers = new Map<string, (data: unknown) => void>();
const unbind = jest.fn();
const unsubscribe = jest.fn();

jest.mock('@/lib/pusher-client', () => ({
  getPusherClient: jest.fn(() => ({
    subscribe: jest.fn(() => ({
      bind: (event: string, handler: (data: unknown) => void) => {
        handlers.set(event, handler);
      },
      unbind: (event: string) => {
        unbind(event);
        handlers.delete(event);
      },
    })),
    unsubscribe,
  })),
}));

function Consumer({ onEvent }: { onEvent: (e: AlertEvent) => void }) {
  usePusherAlerts(onEvent);
  return null;
}

beforeEach(() => {
  handlers.clear();
  unbind.mockClear();
  unsubscribe.mockClear();
  (getPusherClient as jest.Mock).mockClear();
});

describe('usePusherAlerts', () => {
  it('should bind the alert-event name', () => {
    render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    expect(handlers.has('alert-event')).toBe(true);
  });

  it('should deliver a fired envelope to subscribers', () => {
    const onEvent = jest.fn();
    render(
      <PusherProvider>
        <Consumer onEvent={onEvent} />
      </PusherProvider>
    );

    const envelope: AlertEvent = { kind: 'fired', alerts: [] };
    act(() => handlers.get('alert-event')!(envelope));

    expect(onEvent).toHaveBeenCalledWith(envelope);
  });

  it('should deliver a storm envelope', () => {
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
    act(() => handlers.get('alert-event')!(envelope));

    expect(onEvent).toHaveBeenCalledWith(envelope);
  });

  it('should not break the readings subscription', () => {
    render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    expect(handlers.has('new-readings')).toBe(true);
  });

  it('should unbind both events on unmount', () => {
    const { unmount } = render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    unmount();

    expect(unbind).toHaveBeenCalledWith('alert-event');
    expect(unbind).toHaveBeenCalledWith('new-readings');
    expect(unsubscribe).toHaveBeenCalledWith('InfraSight');
  });

  it('should stop delivering after a subscriber unmounts', () => {
    const onEvent = jest.fn();
    function Toggle({ show }: { show: boolean }) {
      return (
        <PusherProvider>{show ? <Consumer onEvent={onEvent} /> : null}</PusherProvider>
      );
    }

    const { rerender } = render(<Toggle show />);
    rerender(<Toggle show={false} />);

    act(() => handlers.get('alert-event')?.({ kind: 'fired', alerts: [] }));

    expect(onEvent).not.toHaveBeenCalled();
  });
});
