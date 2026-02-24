/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import Pagination from '@/components/Pagination';

jest.mock('lucide-react', () => ({
  ChevronLeft: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="chevron-left" {...props} />,
  ChevronRight: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="chevron-right" {...props} />,
}));

describe('Pagination', () => {
  const defaultProps = {
    currentPage: 1,
    totalPages: 5,
    totalItems: 50,
    itemsPerPage: 10,
    onPageChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when totalItems is 0', () => {
    const { container } = render(
      <Pagination {...defaultProps} totalItems={0} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows item range text', () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByText(/Showing 1–10 of 50 items/)).toBeInTheDocument();
  });

  it('calculates correct end item on last page', () => {
    render(<Pagination {...defaultProps} currentPage={5} totalItems={47} totalPages={5} />);
    expect(screen.getByText(/Showing 41–47 of 47 items/)).toBeInTheDocument();
  });

  it('renders Previous and Next buttons', () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('disables Previous button on first page', () => {
    render(<Pagination {...defaultProps} currentPage={1} />);
    const prevButton = screen.getByText('Previous').closest('button');
    expect(prevButton).toBeDisabled();
  });

  it('disables Next button on last page', () => {
    render(<Pagination {...defaultProps} currentPage={5} totalPages={5} />);
    const nextButton = screen.getByText('Next').closest('button');
    expect(nextButton).toBeDisabled();
  });

  it('enables Previous button when not on first page', () => {
    render(<Pagination {...defaultProps} currentPage={3} />);
    const prevButton = screen.getByText('Previous').closest('button');
    expect(prevButton).not.toBeDisabled();
  });

  it('enables Next button when not on last page', () => {
    render(<Pagination {...defaultProps} currentPage={3} />);
    const nextButton = screen.getByText('Next').closest('button');
    expect(nextButton).not.toBeDisabled();
  });

  it('calls onPageChange with previous page when Previous is clicked', () => {
    render(<Pagination {...defaultProps} currentPage={3} />);
    fireEvent.click(screen.getByText('Previous'));
    expect(defaultProps.onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with next page when Next is clicked', () => {
    render(<Pagination {...defaultProps} currentPage={3} />);
    fireEvent.click(screen.getByText('Next'));
    expect(defaultProps.onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onPageChange with correct page when a page number button is clicked', () => {
    render(<Pagination {...defaultProps} currentPage={3} />);
    fireEvent.click(screen.getByText('4'));
    expect(defaultProps.onPageChange).toHaveBeenCalledWith(4);
  });

  it('always renders first and last page buttons', () => {
    render(<Pagination {...defaultProps} currentPage={3} totalPages={10} totalItems={100} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders current and adjacent pages', () => {
    render(<Pagination {...defaultProps} currentPage={3} totalPages={10} totalItems={100} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows ellipsis for large page ranges', () => {
    render(<Pagination {...defaultProps} currentPage={5} totalPages={10} totalItems={100} />);
    const ellipses = screen.getAllByText('...');
    expect(ellipses.length).toBeGreaterThanOrEqual(1);
  });

  it('does not render page number buttons when totalPages is 1', () => {
    render(<Pagination {...defaultProps} totalPages={1} totalItems={5} />);
    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  describe('compact variant', () => {
    it('renders compact layout with item range', () => {
      render(<Pagination {...defaultProps} compact />);
      expect(screen.getByText(/Showing 1–10 of 50/)).toBeInTheDocument();
    });

    it('does not render "Previous" or "Next" text labels in compact mode', () => {
      render(<Pagination {...defaultProps} compact />);
      expect(screen.queryByText('Previous')).not.toBeInTheDocument();
      expect(screen.queryByText('Next')).not.toBeInTheDocument();
    });

    it('disables previous chevron on first page in compact mode', () => {
      render(<Pagination {...defaultProps} compact currentPage={1} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toBeDisabled();
    });

    it('disables next chevron on last page in compact mode', () => {
      render(<Pagination {...defaultProps} compact currentPage={5} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[1]).toBeDisabled();
    });

    it('calls onPageChange when compact chevrons are clicked', () => {
      render(<Pagination {...defaultProps} compact currentPage={3} />);
      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[0]); // previous
      expect(defaultProps.onPageChange).toHaveBeenCalledWith(2);
      fireEvent.click(buttons[1]); // next
      expect(defaultProps.onPageChange).toHaveBeenCalledWith(4);
    });
  });

  it('applies custom className', () => {
    const { container } = render(<Pagination {...defaultProps} className="my-class" />);
    expect(container.firstChild).toHaveClass('my-class');
  });
});
