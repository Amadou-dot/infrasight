/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TagInput } from '@/components/devices/TagInput';

jest.mock('lucide-react', () => ({
  X: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-x" {...props} />,
  Plus: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="icon-plus" {...props} />,
}));

describe('TagInput', () => {
  const defaultProps = {
    value: [] as string[],
    onChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the input field', () => {
    render(<TagInput {...defaultProps} />);
    expect(screen.getByPlaceholderText('Add tag...')).toBeInTheDocument();
  });

  it('renders custom placeholder', () => {
    render(<TagInput {...defaultProps} placeholder="Enter keyword..." />);
    expect(screen.getByPlaceholderText('Enter keyword...')).toBeInTheDocument();
  });

  it('renders existing tags', () => {
    render(<TagInput {...defaultProps} value={['alpha', 'beta']} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('shows tag count when tags exist', () => {
    render(<TagInput {...defaultProps} value={['alpha', 'beta']} maxTags={10} />);
    expect(screen.getByText('2/10 tags')).toBeInTheDocument();
  });

  it('adds a tag on Enter key press', () => {
    render(<TagInput {...defaultProps} />);
    const input = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(input, { target: { value: 'NewTag' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onChange).toHaveBeenCalledWith(['newtag']);
  });

  it('trims and lowercases input before adding', () => {
    render(<TagInput {...defaultProps} />);
    const input = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(input, { target: { value: '  MyTag  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onChange).toHaveBeenCalledWith(['mytag']);
  });

  it('does not add empty or whitespace-only tags', () => {
    render(<TagInput {...defaultProps} />);
    const input = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  it('does not add duplicate tags', () => {
    render(<TagInput {...defaultProps} value={['existing']} />);
    const input = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(input, { target: { value: 'existing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  it('adds a tag when the Plus button is clicked', () => {
    render(<TagInput {...defaultProps} />);
    const input = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(input, { target: { value: 'clicked' } });
    // The Plus button is the one with the Plus icon
    const addButton = screen.getByTestId('icon-plus').closest('button');
    fireEvent.click(addButton!);
    expect(defaultProps.onChange).toHaveBeenCalledWith(['clicked']);
  });

  it('removes a tag when X button is clicked', () => {
    render(<TagInput {...defaultProps} value={['alpha', 'beta']} />);
    // There should be two X buttons, one per tag
    const removeButtons = screen.getAllByTestId('icon-x');
    fireEvent.click(removeButtons[0].closest('button')!);
    expect(defaultProps.onChange).toHaveBeenCalledWith(['beta']);
  });

  it('removes last tag on Backspace when input is empty', () => {
    render(<TagInput {...defaultProps} value={['alpha', 'beta']} />);
    const input = screen.getByPlaceholderText('Add tag...');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(defaultProps.onChange).toHaveBeenCalledWith(['alpha']);
  });

  it('does not remove tag on Backspace when input has text', () => {
    render(<TagInput {...defaultProps} value={['alpha']} />);
    const input = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(input, { target: { value: 'some text' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  it('disables input when maxTags is reached', () => {
    render(<TagInput {...defaultProps} value={['a', 'b', 'c']} maxTags={3} />);
    const input = screen.getByPlaceholderText('Max tags reached');
    expect(input).toBeDisabled();
  });

  it('disables input when disabled prop is true', () => {
    render(<TagInput {...defaultProps} disabled />);
    const input = screen.getByPlaceholderText('Add tag...');
    expect(input).toBeDisabled();
  });

  it('does not add tag when maxTags is reached', () => {
    render(<TagInput {...defaultProps} value={['a', 'b', 'c']} maxTags={3} />);
    // The add button should be disabled
    const addButton = screen.getByTestId('icon-plus').closest('button');
    expect(addButton).toBeDisabled();
  });

  it('disables remove buttons when disabled', () => {
    render(<TagInput {...defaultProps} value={['alpha']} disabled />);
    const removeButton = screen.getByTestId('icon-x').closest('button');
    expect(removeButton).toBeDisabled();
  });
});
