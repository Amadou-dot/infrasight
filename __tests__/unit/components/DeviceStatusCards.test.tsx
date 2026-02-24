/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DeviceStatusCards from '@/app/devices/_components/DeviceStatusCards';

jest.mock('lucide-react', () => ({
  Monitor: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-monitor" {...props} />,
}));

describe('DeviceStatusCards', () => {
  const defaultProps = {
    loading: false,
    totalCount: 100,
    onlineCount: 85,
    attentionCount: 10,
    offlineCount: 5,
    lowBatteryCount: 5,
  };

  it('shows dash placeholders when loading', () => {
    render(<DeviceStatusCards {...defaultProps} loading={true} />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(3);
  });

  it('renders total device count when not loading', () => {
    render(<DeviceStatusCards {...defaultProps} />);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders online count with total', () => {
    render(<DeviceStatusCards {...defaultProps} />);
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText(/\/ 100/)).toBeInTheDocument();
  });

  it('renders attention count', () => {
    render(<DeviceStatusCards {...defaultProps} />);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('shows offline and low battery breakdown', () => {
    render(<DeviceStatusCards {...defaultProps} />);
    expect(screen.getByText('5 Offline, 5 Low Battery')).toBeInTheDocument();
  });

  it('renders progress bar with correct width', () => {
    const { container } = render(<DeviceStatusCards {...defaultProps} />);
    const progressBar = container.querySelector('[style]');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar?.getAttribute('style')).toContain('width: 85%');
  });

  it('renders 0% progress bar when totalCount is 0', () => {
    const { container } = render(
      <DeviceStatusCards {...defaultProps} totalCount={0} onlineCount={0} />
    );
    const progressBar = container.querySelector('[style]');
    expect(progressBar?.getAttribute('style')).toContain('width: 0%');
  });

  it('renders card labels', () => {
    render(<DeviceStatusCards {...defaultProps} />);
    expect(screen.getByText('Total Devices')).toBeInTheDocument();
    expect(screen.getByText('Online Status')).toBeInTheDocument();
    expect(screen.getByText('Attention Needed')).toBeInTheDocument();
  });
});
