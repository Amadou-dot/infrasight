/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatCard from '@/components/dashboard/StatCard';

const MockIcon = (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="mock-icon" {...props} />;

describe('StatCard', () => {
  const defaultProps = {
    title: 'Total Devices',
    value: 42,
    icon: MockIcon as unknown as import('lucide-react').LucideIcon,
    iconColor: 'text-blue-500',
    iconBgColor: 'bg-blue-100',
  };

  it('renders title and value', () => {
    render(<StatCard {...defaultProps} />);
    expect(screen.getByText('Total Devices')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders string values', () => {
    render(<StatCard {...defaultProps} value="1,234" />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('renders the icon', () => {
    render(<StatCard {...defaultProps} />);
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('does not show trend indicator when trend is not provided', () => {
    const { container } = render(<StatCard {...defaultProps} />);
    expect(container.querySelector('.bg-green-500\\/10')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-red-500\\/10')).not.toBeInTheDocument();
  });

  it('shows positive trend with up arrow and plus sign', () => {
    render(<StatCard {...defaultProps} trend={{ value: 12, isPositive: true }} />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
  });

  it('shows negative trend with down arrow', () => {
    render(<StatCard {...defaultProps} trend={{ value: -5, isPositive: false }} />);
    expect(screen.getByText('-5%')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = jest.fn();
    render(<StatCard {...defaultProps} onClick={onClick} />);
    const card = screen.getByText('Total Devices').closest('div[class*="bg-card"]');
    fireEvent.click(card!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has cursor-pointer class when onClick is provided', () => {
    const onClick = jest.fn();
    render(<StatCard {...defaultProps} onClick={onClick} />);
    const card = screen.getByText('Total Devices').closest('div[class*="bg-card"]');
    expect(card?.className).toContain('cursor-pointer');
  });

  it('does not have cursor-pointer class when onClick is not provided', () => {
    render(<StatCard {...defaultProps} />);
    const card = screen.getByText('Total Devices').closest('div[class*="bg-card"]');
    expect(card?.className).not.toContain('cursor-pointer');
  });

  it('applies iconBgColor class to icon wrapper', () => {
    const { container } = render(<StatCard {...defaultProps} />);
    const iconWrapper = container.querySelector('.bg-blue-100');
    expect(iconWrapper).toBeInTheDocument();
  });

  it('passes iconColor class to the icon element', () => {
    const { container } = render(<StatCard {...defaultProps} />);
    const icon = screen.getByTestId('mock-icon');
    expect(icon.getAttribute('class')).toContain('text-blue-500');
  });
});
