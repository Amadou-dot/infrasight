/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ScheduleStatusBadge } from '@/components/ScheduleStatusBadge';

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Clock: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-clock" {...props} />,
  CheckCircle: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-check" {...props} />,
  XCircle: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-x" {...props} />,
}));

describe('ScheduleStatusBadge', () => {
  it('renders "Scheduled" label for scheduled status', () => {
    render(<ScheduleStatusBadge status="scheduled" />);
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('renders "Completed" label for completed status', () => {
    render(<ScheduleStatusBadge status="completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders "Cancelled" label for cancelled status', () => {
    render(<ScheduleStatusBadge status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows the icon by default', () => {
    render(<ScheduleStatusBadge status="scheduled" />);
    expect(screen.getByTestId('icon-clock')).toBeInTheDocument();
  });

  it('shows CheckCircle icon for completed status', () => {
    render(<ScheduleStatusBadge status="completed" />);
    expect(screen.getByTestId('icon-check')).toBeInTheDocument();
  });

  it('shows XCircle icon for cancelled status', () => {
    render(<ScheduleStatusBadge status="cancelled" />);
    expect(screen.getByTestId('icon-x')).toBeInTheDocument();
  });

  it('hides the icon when showIcon is false', () => {
    render(<ScheduleStatusBadge status="scheduled" showIcon={false} />);
    expect(screen.queryByTestId('icon-clock')).not.toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('applies blue classes for scheduled status', () => {
    const { container } = render(<ScheduleStatusBadge status="scheduled" />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain('bg-blue-100');
    expect(badge?.className).toContain('text-blue-700');
  });

  it('applies green classes for completed status', () => {
    const { container } = render(<ScheduleStatusBadge status="completed" />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain('bg-green-100');
    expect(badge?.className).toContain('text-green-700');
  });

  it('applies gray classes for cancelled status', () => {
    const { container } = render(<ScheduleStatusBadge status="cancelled" />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain('bg-gray-100');
    expect(badge?.className).toContain('text-gray-600');
  });

  it('applies custom className', () => {
    const { container } = render(<ScheduleStatusBadge status="scheduled" className="my-custom" />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain('my-custom');
  });
});
