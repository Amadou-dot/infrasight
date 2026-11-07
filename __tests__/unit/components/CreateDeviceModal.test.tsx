import { fireEvent, render, screen } from '@testing-library/react';
import { CreateDeviceModal } from '@/components/devices/CreateDeviceModal';

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

describe('CreateDeviceModal lifecycle', () => {
  it('resets fields and validation errors after the parent closes and reopens it', () => {
    const props = { onClose: jest.fn(), onSuccess: jest.fn() };
    const { rerender } = render(<CreateDeviceModal isOpen {...props} />);
    fireEvent.change(screen.getByPlaceholderText('e.g., device_001'), {
      target: { value: 'device_draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Device' }));
    const errorMessages = screen
      .getAllByText(/required|at least/i)
      .filter(element => element.classList.contains('text-destructive'));
    expect(errorMessages.length).toBeGreaterThan(0);

    rerender(<CreateDeviceModal isOpen={false} {...props} />);
    rerender(<CreateDeviceModal isOpen {...props} />);

    expect(screen.getByPlaceholderText('e.g., device_001')).toHaveValue('');
    for (const error of errorMessages) expect(error).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
