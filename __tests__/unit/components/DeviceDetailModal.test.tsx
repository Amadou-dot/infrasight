/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DeviceDetail } from '@/components/devices/useDeviceDetail';
import DeviceDetailModal from '@/components/DeviceDetailModal';

const detail: DeviceDetail = {
  device: null,
  recentReadings: [],
  auditLog: [],
  loading: false,
  error: null,
  notFound: false,
};

let currentDetail: DeviceDetail = detail;

jest.mock('@/components/devices/useDeviceDetail', () => ({
  useDeviceDetail: () => currentDetail,
}));

jest.mock('@/components/devices/DeviceDetailView', () => {
  const DeviceDetailView = ({ headerAction }: { headerAction?: React.ReactNode }) => (
    <div data-testid="device-detail-view">{headerAction}</div>
  );
  DeviceDetailView.displayName = 'DeviceDetailView';
  return DeviceDetailView;
});

jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  Link.displayName = 'Link';
  return Link;
});

describe('DeviceDetailModal', () => {
  beforeEach(() => {
    currentDetail = { ...detail };
  });

  it('should render nothing while closed', () => {
    const { container } = render(
      <DeviceDetailModal deviceId="device_001" isOpen={false} onClose={jest.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('should link out to the canonical device page', () => {
    currentDetail = {
      ...detail,
      device: { _id: 'device_001' } as DeviceDetail['device'],
    };

    render(<DeviceDetailModal deviceId="device_001" isOpen onClose={jest.fn()} />);

    expect(screen.getByRole('link', { name: /open full page/i })).toHaveAttribute(
      'href',
      '/devices/device_001'
    );
  });

  it('should reuse the shared detail view rather than its own markup', () => {
    currentDetail = {
      ...detail,
      device: { _id: 'device_001' } as DeviceDetail['device'],
    };

    render(<DeviceDetailModal deviceId="device_001" isOpen onClose={jest.fn()} />);

    expect(screen.getByTestId('device-detail-view')).toBeInTheDocument();
  });

  it('should report a device that could not be found', () => {
    currentDetail = { ...detail, notFound: true };

    render(<DeviceDetailModal deviceId="device_ghost" isOpen onClose={jest.fn()} />);

    expect(screen.getByText(/device_ghost could not be found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('device-detail-view')).not.toBeInTheDocument();
  });

  it('should surface a load failure', () => {
    currentDetail = { ...detail, error: 'Database unavailable' };

    render(<DeviceDetailModal deviceId="device_001" isOpen onClose={jest.fn()} />);

    expect(screen.getByText('Database unavailable')).toBeInTheDocument();
  });
});
