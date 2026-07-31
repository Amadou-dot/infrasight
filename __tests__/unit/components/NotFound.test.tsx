/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import NotFound from '@/app/not-found';

jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  Link.displayName = 'Link';
  return Link;
});

jest.mock('lucide-react', () => ({
  Compass: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="compass" {...props} />,
  LayoutDashboard: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="dashboard-icon" {...props} />
  ),
  Monitor: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="monitor-icon" {...props} />,
}));

describe('NotFound', () => {
  it('should offer a route back into the app', () => {
    render(<NotFound />);

    const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
    expect(dashboardLink).toHaveAttribute('href', '/');
  });

  it('should link to devices so a mistyped device URL has somewhere to go', () => {
    render(<NotFound />);

    expect(screen.getByRole('link', { name: /devices/i })).toHaveAttribute('href', '/devices');
  });

  it('should use theme tokens so it renders correctly in dark mode', () => {
    const { container } = render(<NotFound />);
    const markup = container.innerHTML;

    // The previous implementation hardcoded bg-gray-100 and text-blue-500, which ignored
    // the theme entirely and rendered as an unstyled page in dark mode.
    expect(markup).not.toMatch(/bg-gray-\d/);
    expect(markup).not.toMatch(/text-blue-\d/);
    expect(markup).toMatch(/bg-background/);
  });
});
