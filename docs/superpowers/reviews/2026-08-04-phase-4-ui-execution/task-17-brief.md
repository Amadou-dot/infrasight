### Task 17: Rule management UI

**Files:**
- Create: `components/alerts/AlertRuleList.tsx`
- Create: `components/alerts/CreateAlertRuleModal.tsx`
- Create: `app/alerts/rules/page.tsx`
- Test: `__tests__/unit/components/CreateAlertRuleModal.test.tsx`

`CreateAlertRuleModal` is modelled on `components/devices/CreateDeviceModal.tsx`. The one piece of real logic in it is mirroring the two server-side cross-field refinements client-side, so a user is told *before* submitting rather than getting a 400 back:

1. When `metric` is `value`, at least one `selector.types` entry is required.
2. `anomaly_score` thresholds are bounded 0–1; `battery_level` 0–100; `value` unconstrained.

The server remains the enforcement point — this is a UX affordance, not a security boundary.

**Interfaces:**
- Consumes: `useAlertRulesList`, `useCreateAlertRule`, `useUpdateAlertRule`, `useDeleteAlertRule` (Task 12); `useAdminAction`.
- Produces:
  - `export function AlertRuleList()`
  - `export function CreateAlertRuleModal({ isOpen, onClose })`
  - Default-exported `AlertRulesPage` at `/alerts/rules`

- [ ] **Step 1: Write the failing modal test**

Create `__tests__/unit/components/CreateAlertRuleModal.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { CreateAlertRuleModal } from '@/components/alerts/CreateAlertRuleModal';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: { alertRules: { create: jest.fn().mockResolvedValue({ data: { _id: 'r1' } }) } },
}));

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('CreateAlertRuleModal', () => {
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

    fireEvent.change(screen.getByLabelText(/metric/i), { target: { value: 'anomaly_score' } });
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(screen.getByText(/between 0 and 1/i)).toBeInTheDocument());
    expect(v2Api.alertRules.create).not.toHaveBeenCalled();
  });

  it('should submit a valid rule', async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'High temp' } });
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/temperature/i));
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(v2Api.alertRules.create).toHaveBeenCalled());

    const payload = (v2Api.alertRules.create as jest.Mock).mock.calls[0][0];
    expect(payload.name).toBe('High temp');
    expect(payload.selector.types).toContain('temperature');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/components/CreateAlertRuleModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the modal**

Create `components/alerts/CreateAlertRuleModal.tsx` following `components/devices/CreateDeviceModal.tsx`:

- Controlled form state; fields: name, description, metric (`Select`), comparison (`Select`), threshold (number), severity (`Select`), `for_duration_seconds` (number, minutes in the UI × 60 on submit), `cooldown_seconds`, and a selector block with a multi-select of the 15 reading types plus optional building/floor/zone/tags (reuse `components/devices/TagInput.tsx` for tags)
- A `validate()` returning `Record<string, string>` implementing the two refinements above, with messages "Select at least one reading type when the metric is a raw value" and "Threshold must be between 0 and 1 for anomaly_score" / "…between 0 and 100 for battery_level"
- Submit via `useCreateAlertRule()`; `toast.success('Alert rule created')` on success then `onClose()`; `toast.error(err.message)` on failure
- Every input carries a `<label htmlFor>` so the tests above (and screen readers) can find it
- `metric` / `comparison` / `severity` use `components/ui/select.tsx`, whose contract is `{ value, onValueChange, options, label?, size? }` — **not** a native `<select>`, so there is no `onChange` and no `event.target.value`

**Building the request body needs care — a flat object literal will not compile.** `CreateAlertRuleBody` (`types/v2/alert.types.ts:121`) is `AlertRuleBodyBase & CreateAlertRuleCondition`, and `CreateAlertRuleCondition` is a **discriminated union on `metric`** where the `'value'` arm requires `selector.types` to be a non-empty tuple `[ReadingTypeName, ...ReadingTypeName[]]`. Two consequences:

1. Assembling `{ ...base, metric, comparison, threshold, selector }` from a `metric: AlertMetric` state variable fails: TypeScript cannot pick an arm from a union-typed discriminant.
2. Form state holds `types: ReadingTypeName[]`, which is not assignable to a non-empty tuple no matter which arm is chosen.

Branch on the discriminant and destructure the array to produce a genuinely non-empty tuple — **no `as` cast, which would defeat the type that exists precisely to make this state unrepresentable**:

```typescript
function buildCreateBody(form: RuleFormState): CreateAlertRuleBody | null {
  const base = {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    for_duration_seconds: form.durationMinutes * 60,
    severity: form.severity,
    cooldown_seconds: form.cooldownSeconds,
  };

  const selector = {
    ...(form.buildingId ? { building_id: form.buildingId } : {}),
    ...(form.floor !== '' ? { floor: Number(form.floor) } : {}),
    ...(form.zone ? { zone: form.zone } : {}),
    ...(form.tags.length ? { tags: form.tags } : {}),
  };

  if (form.metric === 'value') {
    // The destructure is what proves non-emptiness to the compiler.
    // validate() has already blocked this branch, so null is unreachable.
    const [firstType, ...restTypes] = form.types;
    if (!firstType) return null;

    return {
      ...base,
      metric: 'value',
      comparison: form.comparison,
      threshold: Number(form.threshold),
      selector: { ...selector, types: [firstType, ...restTypes] },
    };
  }

  return {
    ...base,
    metric: form.metric, // narrowed to 'anomaly_score' | 'battery_level'
    comparison: form.comparison,
    threshold: Number(form.threshold),
    selector,
  };
}
```

If you also build an edit path, note `UpdateAlertRuleBody` differs deliberately: whenever the condition is being changed, `selector` must be an **explicit key for every metric** — send `{}` for `anomaly_score`/`battery_level` rather than omitting it — because `updateAlertRuleSchema` gives `selector` no default and its atomic-group refinement tests `data.selector !== undefined`. The rationale is documented at `types/v2/alert.types.ts:123-139`.

- [ ] **Step 4: Write the rule list and page**

Create `components/alerts/AlertRuleList.tsx` following `ScheduleList`: card per rule showing name, `AlertSeverityBadge`, the condition via `describeCondition`, the selector rendered as chips, and an enabled toggle. Admin-only actions (toggle enabled, delete) render disabled with a tooltip for non-admins. Delete asks for confirmation via an inline confirm state — **never `window.confirm`**, which blocks the page.

Create `app/alerts/rules/page.tsx` with the same header shell as `app/alerts/page.tsx`, a back link to `/alerts`, a "New rule" button gated with `useAdminAction()` (matching `app/analytics/page.tsx`'s report button), `<AlertRuleList />`, and the modal.

- [ ] **Step 5: Run tests and build**

Run: `pnpm test __tests__/unit/components && npx tsc --noEmit && pnpm build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/alerts/AlertRuleList.tsx components/alerts/CreateAlertRuleModal.tsx app/alerts/rules/page.tsx __tests__/unit/components/CreateAlertRuleModal.test.tsx
git commit -m "feat(alerting): add alert rule management UI"
```

---

