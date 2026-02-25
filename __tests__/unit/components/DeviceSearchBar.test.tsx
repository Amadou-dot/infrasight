/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DeviceSearchBar from '@/app/devices/_components/DeviceSearchBar';

jest.mock('lucide-react', () => ({
  Search: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-search" {...props} />,
  SlidersHorizontal: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-sliders" {...props} />,
}));

describe('DeviceSearchBar', () => {
  const defaultProps = {
    searchQuery: '',
    onSearchChange: jest.fn(),
    selectedFloor: 'all' as const,
    onFloorChange: jest.fn(),
    floors: [1, 2, 3],
    activeFilterCount: 0,
    onOpenFilterModal: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders search input with placeholder', () => {
    render(<DeviceSearchBar {...defaultProps} />);
    expect(screen.getByPlaceholderText('Search by Name, IP, or MAC Address')).toBeInTheDocument();
  });

  it('displays the current search query value', () => {
    render(<DeviceSearchBar {...defaultProps} searchQuery="temperature" />);
    const input = screen.getByPlaceholderText('Search by Name, IP, or MAC Address') as HTMLInputElement;
    expect(input.value).toBe('temperature');
  });

  it('calls onSearchChange when typing in search input', () => {
    render(<DeviceSearchBar {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search by Name, IP, or MAC Address');
    fireEvent.change(input, { target: { value: 'sensor' } });
    expect(defaultProps.onSearchChange).toHaveBeenCalledWith('sensor');
  });

  it('renders "All Floors" button', () => {
    render(<DeviceSearchBar {...defaultProps} />);
    expect(screen.getByText('All Floors')).toBeInTheDocument();
  });

  it('renders a button for each floor', () => {
    render(<DeviceSearchBar {...defaultProps} />);
    expect(screen.getByText('Floor 1')).toBeInTheDocument();
    expect(screen.getByText('Floor 2')).toBeInTheDocument();
    expect(screen.getByText('Floor 3')).toBeInTheDocument();
  });

  it('calls onFloorChange with "all" when All Floors is clicked', () => {
    render(<DeviceSearchBar {...defaultProps} selectedFloor={1} />);
    fireEvent.click(screen.getByText('All Floors'));
    expect(defaultProps.onFloorChange).toHaveBeenCalledWith('all');
  });

  it('calls onFloorChange with floor number when a floor button is clicked', () => {
    render(<DeviceSearchBar {...defaultProps} />);
    fireEvent.click(screen.getByText('Floor 2'));
    expect(defaultProps.onFloorChange).toHaveBeenCalledWith(2);
  });

  it('renders the Filter button', () => {
    render(<DeviceSearchBar {...defaultProps} />);
    expect(screen.getByText('Filter')).toBeInTheDocument();
  });

  it('calls onOpenFilterModal when Filter button is clicked', () => {
    render(<DeviceSearchBar {...defaultProps} />);
    fireEvent.click(screen.getByText('Filter'));
    expect(defaultProps.onOpenFilterModal).toHaveBeenCalledTimes(1);
  });

  it('does not show filter badge when activeFilterCount is 0', () => {
    const { container } = render(<DeviceSearchBar {...defaultProps} />);
    // Badge with count should not exist
    const badges = container.querySelectorAll('[data-slot="badge"]');
    expect(badges.length).toBe(0);
  });

  it('shows filter badge with count when activeFilterCount > 0', () => {
    render(<DeviceSearchBar {...defaultProps} activeFilterCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('applies border-primary class to filter button when filters are active', () => {
    render(<DeviceSearchBar {...defaultProps} activeFilterCount={2} />);
    const filterButton = screen.getByText('Filter').closest('button');
    expect(filterButton?.className).toContain('border-primary');
  });
});
