/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ServiceTypeBadge } from '@/components/ServiceTypeBadge';

jest.mock('lucide-react', () => ({
  Download: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-download" {...props} />,
  Crosshair: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-crosshair" {...props} />,
  AlertTriangle: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-alert" {...props} />,
  Wrench: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-wrench" {...props} />,
}));

describe('ServiceTypeBadge', () => {
  const serviceTypes = [
    { type: 'firmware_update' as const, label: 'Firmware Update', icon: 'icon-download', colorClass: 'bg-purple-100' },
    { type: 'calibration' as const, label: 'Calibration', icon: 'icon-crosshair', colorClass: 'bg-cyan-100' },
    { type: 'emergency_fix' as const, label: 'Emergency Fix', icon: 'icon-alert', colorClass: 'bg-red-100' },
    { type: 'general_maintenance' as const, label: 'General Maintenance', icon: 'icon-wrench', colorClass: 'bg-amber-100' },
  ];

  it.each(serviceTypes)('renders "$label" for $type', ({ type, label }) => {
    render(<ServiceTypeBadge serviceType={type} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each(serviceTypes)('shows the correct icon for $type', ({ type, icon }) => {
    render(<ServiceTypeBadge serviceType={type} />);
    expect(screen.getByTestId(icon)).toBeInTheDocument();
  });

  it.each(serviceTypes)('applies correct color class for $type', ({ type, colorClass }) => {
    const { container } = render(<ServiceTypeBadge serviceType={type} />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain(colorClass);
  });

  it('hides the icon when showIcon is false', () => {
    render(<ServiceTypeBadge serviceType="firmware_update" showIcon={false} />);
    expect(screen.queryByTestId('icon-download')).not.toBeInTheDocument();
    expect(screen.getByText('Firmware Update')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<ServiceTypeBadge serviceType="calibration" className="extra-class" />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain('extra-class');
  });
});
