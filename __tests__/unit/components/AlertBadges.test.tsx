import { render, screen } from '@testing-library/react';
import { AlertSeverityBadge } from '@/components/alerts/AlertSeverityBadge';
import { AlertStatusBadge } from '@/components/alerts/AlertStatusBadge';

describe('AlertSeverityBadge', () => {
  it.each(['info', 'warning', 'critical'] as const)('should render %s', severity => {
    render(<AlertSeverityBadge severity={severity} />);
    expect(screen.getByText(new RegExp(severity, 'i'))).toBeInTheDocument();
  });

  it('should hide the icon when showIcon is false', () => {
    const { container } = render(<AlertSeverityBadge severity="critical" showIcon={false} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('AlertStatusBadge', () => {
  it.each([
    ['firing', /firing/i],
    ['acknowledged', /acknowledged/i],
    ['resolved', /resolved/i],
    ['pending', /pending/i],
  ] as const)('should render %s', (status, pattern) => {
    render(<AlertStatusBadge status={status} />);
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });
});
