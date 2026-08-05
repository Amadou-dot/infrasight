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
 *
 * The `scoping` block is about the worst failure this form can produce: a rule
 * the operator scoped to one building silently going fleet-wide, arming every
 * device in the estate. Nothing downstream would flag it — the request is
 * valid, the rule saves, and the first symptom is a pager storm. So each of the
 * four scoping dimensions the form exposes (Building, Floor, Zone, Tags) is
 * asserted to reach `v2Api.alertRules.create`, and the selector is compared
 * with `toEqual` (exact key set) rather than by probing individual keys, so an
 * extra or missing constraint fails too.
 *
 * Its paired fleet-wide test is what makes the scoped ones bite: a genuine
 * fleet-wide rule must submit a selector carrying no scoping keys at all. With
 * both present, "the selector was dropped" is distinguishable from "the user
 * asked for fleet-wide", which a scoped-only test cannot do.
 *
 * `enabled` and `severity` are asserted to travel from the control the user
 * touched into the body, in both directions where the form allows one — a
 * component that hardcoded either would still satisfy a single-value test.
 *
 * Every assertion here is against the arguments the mocked API client received,
 * never against component state.
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

/**
 * The minimum a `metric: 'value'` rule needs to pass validate(): a name, a
 * threshold, and one reading type. Scoping tests layer their own fields on top
 * of this so the only difference between them is the dimension under test.
 */
function fillMinimalValueRule(name = 'High temp') {
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
  fireEvent.click(screen.getByLabelText(/temperature/i));
}

/** TagInput commits on Enter, not on change — a change alone submits no tags. */
function addTag(tag: string) {
  const input = screen.getByLabelText(/tags/i);
  fireEvent.change(input, { target: { value: tag } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: /create rule/i }));
}

/** The body the component actually handed to the API client. */
async function submittedBody() {
  await waitFor(() => expect(v2Api.alertRules.create).toHaveBeenCalled());
  return (v2Api.alertRules.create as jest.Mock).mock.calls[0][0];
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

  // ==========================================================================
  // D2 — scoping. A scoped rule that goes out fleet-wide arms the estate.
  // ==========================================================================

  describe('scoping', () => {
    it('should send a building-scoped rule scoped to that building', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      fireEvent.change(screen.getByLabelText(/building/i), { target: { value: 'bldg-a' } });
      submitForm();

      const body = await submittedBody();
      expect(body.metric).toBe('value'); // the discriminant buildCreateBody branches on
      expect(body.selector).toEqual({ types: ['temperature'], building_id: 'bldg-a' });
    });

    it('should send a floor-scoped rule with the floor as a number, not the raw input string', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      fireEvent.change(screen.getByLabelText(/floor/i), { target: { value: '3' } });
      submitForm();

      const body = await submittedBody();
      expect(body.selector).toEqual({ types: ['temperature'], floor: 3 });
      expect(typeof body.selector.floor).toBe('number');
    });

    it('should send a zone-scoped rule scoped to that zone', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      fireEvent.change(screen.getByLabelText(/zone/i), { target: { value: 'north-wing' } });
      submitForm();

      const body = await submittedBody();
      expect(body.selector).toEqual({ types: ['temperature'], zone: 'north-wing' });
    });

    it('should send a tag-scoped rule scoped to those tags', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      addTag('hvac');
      addTag('critical-path');
      submitForm();

      const body = await submittedBody();
      expect(body.selector).toEqual({
        types: ['temperature'],
        tags: ['hvac', 'critical-path'],
      });
    });

    it('should carry all four scoping dimensions at once', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      fireEvent.change(screen.getByLabelText(/building/i), { target: { value: 'bldg-a' } });
      fireEvent.change(screen.getByLabelText(/floor/i), { target: { value: '2' } });
      fireEvent.change(screen.getByLabelText(/zone/i), { target: { value: 'east' } });
      addTag('hvac');
      submitForm();

      const body = await submittedBody();
      expect(body.selector).toEqual({
        types: ['temperature'],
        building_id: 'bldg-a',
        floor: 2,
        zone: 'east',
        tags: ['hvac'],
      });
    });

    it('should scope a non-value metric too, on buildCreateBody\'s other branch', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Anomaly in B' } });
      chooseSelectOption(/metric/i, /anomaly score/i);
      fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '0.8' } });
      fireEvent.change(screen.getByLabelText(/building/i), { target: { value: 'bldg-b' } });
      submitForm();

      const body = await submittedBody();
      expect(body.metric).toBe('anomaly_score');
      expect(body.selector).toEqual({ building_id: 'bldg-b' });
    });

    /**
     * The pair. Without this, "the selector was dropped" and "the user asked
     * for fleet-wide" produce the same body and no test can tell them apart.
     */
    it('should send NO scoping keys when the user scoped nothing', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule('Fleet-wide high temp');
      submitForm();

      const body = await submittedBody();
      expect(body.selector).toEqual({ types: ['temperature'] });
      expect(body.selector).not.toHaveProperty('building_id');
      expect(body.selector).not.toHaveProperty('floor');
      expect(body.selector).not.toHaveProperty('zone');
      expect(body.selector).not.toHaveProperty('tags');
    });
  });

  // ==========================================================================
  // D2 — enabled and severity travel from the control the user touched
  // ==========================================================================

  describe('enabled', () => {
    it('should submit enabled:true for a rule left enabled', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      submitForm();

      expect((await submittedBody()).enabled).toBe(true);
    });

    it('should submit enabled:false once the user unchecks Enabled', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      fireEvent.click(screen.getByLabelText(/^enabled$/i));
      submitForm();

      expect((await submittedBody()).enabled).toBe(false);
    });
  });

  describe('severity', () => {
    it('should submit the form default of warning when the user does not change it', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      submitForm();

      expect((await submittedBody()).severity).toBe('warning');
    });

    it('should submit critical once the user selects Critical', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      chooseSelectOption(/severity/i, /critical/i);
      submitForm();

      expect((await submittedBody()).severity).toBe('critical');
    });

    it('should submit info once the user selects Info', async () => {
      render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

      fillMinimalValueRule();
      chooseSelectOption(/severity/i, /info/i);
      submitForm();

      expect((await submittedBody()).severity).toBe('info');
    });
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
