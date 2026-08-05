/**
 * RealtimeStatusBanner Tests
 *
 * The banner exists to make an invisible failure visible: a dead socket and a
 * quiet building render the same "No open alerts." screen. Two negative rows
 * carry most of the weight — it must stay silent while healthy AND while
 * merely connecting, or it fires on every cold page load and gets ignored the
 * one time it matters.
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { RealtimeStatusBanner } from '@/components/alerts/RealtimeStatusBanner';
import { useRealtimeConnection, type RealtimeConnection } from '@/lib/pusher-context';

jest.mock('@/lib/pusher-context', () => ({
  useRealtimeConnection: jest.fn(),
}));

const mockConnection = useRealtimeConnection as jest.Mock;

function connection(overrides: Partial<RealtimeConnection> = {}): RealtimeConnection {
  return {
    connected: true,
    state: 'connected',
    degraded: false,
    message: null,
    terminal: false,
    ...overrides,
  };
}

describe('RealtimeStatusBanner', () => {
  it('renders nothing while the connection is healthy', () => {
    mockConnection.mockReturnValue(connection());

    const { container } = render(<RealtimeStatusBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing during the ordinary connecting window', () => {
    // Not connected, but nothing is wrong yet. A banner here would appear on
    // every page load and train viewers to ignore it.
    mockConnection.mockReturnValue(
      connection({ connected: false, state: 'connecting', degraded: false })
    );

    const { container } = render(<RealtimeStatusBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('announces a degraded connection with its explanation', () => {
    mockConnection.mockReturnValue(
      connection({
        connected: false,
        state: 'reconnecting',
        degraded: true,
        message: 'Lost the real-time connection — retrying.',
      })
    );

    render(<RealtimeStatusBanner />);

    expect(screen.getByTestId('realtime-status-banner')).toBeInTheDocument();
    expect(screen.getByText(/Live updates unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Lost the real-time connection/i)).toBeInTheDocument();
  });

  it('is announced to assistive technology', () => {
    mockConnection.mockReturnValue(
      connection({ connected: false, state: 'failed', degraded: true, terminal: true, message: 'x' })
    );

    render(<RealtimeStatusBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('still renders when the degraded state carries no message', () => {
    mockConnection.mockReturnValue(
      connection({ connected: false, state: 'failed', degraded: true, message: null })
    );

    render(<RealtimeStatusBanner />);

    expect(screen.getByTestId('realtime-status-banner')).toBeInTheDocument();
  });
});
