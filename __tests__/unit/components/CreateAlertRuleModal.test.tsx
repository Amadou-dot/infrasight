/**
 * CreateAlertRuleModal Tests
 *
 * `@/lib/api/v2-client` is mocked (not `@/lib/query/hooks`) so the real
 * `useCreateAlertRule` mutation hook runs, exercising the actual wiring from
 * form submit through the hook to the API client — the class of bug this
 * phase keeps hitting is a mock that never intercepts the code under test.
 *
 * `components/ui/select.tsx` is NOT a native `<select>` (no onChange, no
 * event.target.value): the metric field is a custom listbox button. Tests
 * interact with it via `chooseSelectOption`, which clicks the trigger (found
 * by its associated `<label htmlFor>`) then clicks the matching
 * `role="option"` entry — never `fireEvent.change`.
 *
 * The two negative-validation tests ("blocks submit when metric is 'value'
 * and no type is selected" and "rejects an anomaly_score threshold above 1")
 * each assert BOTH that the error message renders AND that
 * `v2Api.alertRules.create` was NOT called — asserting only the message would
 * pass against a component that shows the error and submits anyway.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { CreateAlertRuleModal } from '@/components/alerts/CreateAlertRuleModal';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: { alertRules: { create: jest.fn().mockResolvedValue({ data: { _id: 'r1' } }) } },
}));

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
}

/**
 * Opens a components/ui/select.tsx dropdown (found via its <label htmlFor>
 * association, matching the accessibility requirement every input in this
 * form must satisfy) and picks an option by its visible listbox-option text.
 */
function chooseSelectOption(labelMatch: RegExp, optionName: RegExp) {
  fireEvent.click(screen.getByLabelText(labelMatch));
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}

describe('CreateAlertRuleModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should block submit when metric is 'value' and no type is selected", async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() =>
      expect(screen.getByText(/select at least one reading type/i)).toBeInTheDocument()
    );
    expect(v2Api.alertRules.create).not.toHaveBeenCalled();
  });

  it('should reject an anomaly_score threshold above 1', async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Bad anomaly rule' } });
    chooseSelectOption(/metric/i, /anomaly score/i);
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(screen.getByText(/between 0 and 1/i)).toBeInTheDocument());
    expect(v2Api.alertRules.create).not.toHaveBeenCalled();
  });

  it('should reject a battery_level threshold above 100', async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Bad battery rule' } });
    chooseSelectOption(/metric/i, /battery level/i);
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(screen.getByText(/between 0 and 100/i)).toBeInTheDocument());
    expect(v2Api.alertRules.create).not.toHaveBeenCalled();
  });

  it('should submit a valid rule', async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'High temp' } });
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/temperature/i));
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(v2Api.alertRules.create).toHaveBeenCalled());

    const payload = (v2Api.alertRules.create as jest.Mock).mock.calls[0][0];
    expect(payload.name).toBe('High temp');
    expect(payload.metric).toBe('value');
    expect(payload.threshold).toBe(30);
    expect(payload.selector.types).toContain('temperature');
  });

  it('should submit a valid anomaly_score rule with an empty selector object (no types key required)', async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Anomaly rule' } });
    chooseSelectOption(/metric/i, /anomaly score/i);
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(v2Api.alertRules.create).toHaveBeenCalled());

    const payload = (v2Api.alertRules.create as jest.Mock).mock.calls[0][0];
    expect(payload.metric).toBe('anomaly_score');
    expect(payload.threshold).toBe(0.8);
    expect(payload.selector).toEqual({});
  });

  it('should convert the duration field from minutes to seconds on submit', async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'High temp' } });
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/temperature/i));
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(v2Api.alertRules.create).toHaveBeenCalled());

    const payload = (v2Api.alertRules.create as jest.Mock).mock.calls[0][0];
    expect(payload.for_duration_seconds).toBe(300);
  });

  it('should toast an error and stay open when the API call fails', async () => {
    (v2Api.alertRules.create as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const onClose = jest.fn();
    const { toast } = jest.requireMock('react-toastify');

    render(<CreateAlertRuleModal isOpen onClose={onClose} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'High temp' } });
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/temperature/i));
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
