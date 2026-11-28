import React from 'react';
import { render, screen } from '@testing-library/react';
import DeviceDetailPage from '@/app/devices/[id]/detail/page';
import { useDeviceDetail } from '@/components/devices/useDeviceDetail';

jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'deleted' }) }));
jest.mock('@/components/devices/useDeviceDetail', () => ({ useDeviceDetail: jest.fn() }));

it('opens the reserved device by exact ID without loading an inventory page', () => {
  jest.mocked(useDeviceDetail).mockReturnValue({
    device: null,
    recentReadings: [],
    auditLog: [],
    auditTotal: null,
    readingsTotal: null,
    loading: true,
    error: null,
    notFound: false,
  });
  render(<DeviceDetailPage />);
  expect(screen.getByRole('heading', { name: 'deleted' })).toBeInTheDocument();
  expect(useDeviceDetail).toHaveBeenCalledWith('deleted');
});
