# Task 17 Report: Rule management UI

Branch: `feat/phase-4-alerting` (worktree `/home/yzel/github/infrasight-phase4`)
Commit: `c4964ae` — `feat(alerting): add alert rule management UI`

## Summary

Implemented `components/alerts/CreateAlertRuleModal.tsx`, `components/alerts/AlertRuleList.tsx`,
and `app/alerts/rules/page.tsx` per `task-17-brief.md`, plus
`__tests__/unit/components/CreateAlertRuleModal.test.tsx` (from the brief, extended)
and `__tests__/unit/components/AlertRuleList.test.tsx` (not in the brief's literal
file list — added deliberately; see "Deviations from the brief").

All four gates pass with zero tolerance:

- `npx tsc --noEmit` — 0 errors
- `pnpm lint` — 0 problems (exit 0)
- `pnpm test` — 2569/2569 passing, 111/111 suites (baseline entering this task was
  2552/109; delta is exactly the 17 new tests across 2 new suites — no regressions)
- `pnpm build` — clean; `/alerts/rules` compiles as `○` (static), matching `/alerts`'s
  sibling classification

## What was implemented

### `components/alerts/CreateAlertRuleModal.tsx`

`{ isOpen, onClose }` modal, modelled on `CreateDeviceModal.tsx`:

- Controlled form state (`RuleFormState`): `name`, `description`, `enabled`, `metric`
  (`Select`), `comparison` (`Select`), `threshold` (kept as a string so the number
  input stays a normal controlled field), `severity` (`Select`), `durationMinutes`
  (displayed in minutes, × 60 on submit), `cooldownSeconds`, a reading-types
  multi-select (15 checkboxes, shown only when `metric === 'value'`), and optional
  `buildingId`/`floor`/`zone`/`tags` (`TagInput`).
- `validate(form)` mirrors the server's two cross-field refinements
  (`lib/validations/v2/alert-rule.validation.ts`) as a UX affordance, not a security
  boundary: (1) `metric === 'value'` requires at least one selected type — message
  "Select at least one reading type when the metric is a raw value"; (2) threshold
  bounds — "Threshold must be between 0 and 1 for anomaly_score" /
  "…between 0 and 100 for battery_level".
- `buildCreateBody(form)` is the brief's cast-free discriminated-union construction,
  used verbatim: branches on `form.metric`, and for the `'value'` arm destructures
  `const [firstType, ...restTypes] = form.types` to prove non-emptiness to the
  compiler rather than casting. No `as` anywhere in this file.
- Submits via `useCreateAlertRule()`; `toast.success('Alert rule created')` then
  `onClose()` on success; `toast.error(err.message)` on failure (dialog stays open).
- Every input has a real `<label htmlFor>` paired with a matching `id`, including the
  three `Select`s and `TagInput` — see "Deviations from the brief" for the two small
  shared-component changes this required.

### `components/alerts/AlertRuleList.tsx`

No-props list, modelled on `ScheduleList.tsx`/`AlertList.tsx`: card per rule showing
name, `AlertSeverityBadge`, the condition via `describeCondition` (imported from
`AlertList.tsx`, not reimplemented), the selector flattened into chips (types,
building, `Floor N`, zone, tags), and an enabled toggle. Simple page-based pagination
(`page`/`limit: 10`), matching the sibling lists' convention.

- **Admin gating**: `toggleAction = useAdminAction()`, `deleteAction = useAdminAction()`
  — two separate calls, matching `AlertList.tsx`'s exact pattern (admin →
  visible+enabled; non-admin in demo mode → visible+disabled+tooltip; non-admin
  otherwise → hidden).
- **Toggle**: `useUpdateAlertRule().mutate({ id, data: { enabled: !rule.enabled } })`.
  This is a pure `NoConditionUpdate` (`UpdateAlertRuleBody`'s "leave the condition
  untouched" arm) — no cast needed, since an object literal omitting
  `metric`/`comparison`/`threshold`/`selector` structurally satisfies that arm.
- **Delete**: never `window.confirm` — uses `components/ui/alert-dialog.tsx`, matching
  `app/devices/page.tsx`'s established pattern exactly, including the
  `e.preventDefault()` inside the `AlertDialogAction` handler (Radix's `Action`
  auto-closes on click by default; devices page's own comment — "Prevent
  AlertDialogAction's default close behavior" — is why I looked for and copied this).

### `app/alerts/rules/page.tsx`

Same header shell as `app/alerts/page.tsx` (icon + title), a back link to `/alerts`,
a "New rule" button gated with `useAdminAction()` (matching `app/analytics/page.tsx`'s
report button), `<AlertRuleList />`, and `<CreateAlertRuleModal>`. No Suspense
boundary needed — unlike `/alerts`, `AlertRuleList` keeps its page state in local
`useState`, not `useSearchParams`. `app/alerts/page.tsx` already links here
("Manage rules") from an earlier task, so no changes were needed there.

## TDD evidence

### `CreateAlertRuleModal.tsx`

**Failing run** (before the component existed):

```
FAIL jsdom __tests__/unit/components/CreateAlertRuleModal.test.tsx
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/components/alerts/CreateAlertRuleModal mapped as:
    /home/yzel/github/infrasight-phase4/$1.
      26 | import { CreateAlertRuleModal } from '@/components/alerts/CreateAlertRuleModal';
         | ^

Test Suites: 1 failed, 1 total
Tests:       0 total
```

First real run after creating the component also failed for an unrelated,
environment-level reason (see "A jsdom gap this task uncovered" below).

**Passing run** (after both the component and the jsdom fix):

```
PASS jsdom __tests__/unit/components/CreateAlertRuleModal.test.tsx
  CreateAlertRuleModal
    ✓ should block submit when metric is 'value' and no type is selected (143 ms)
    ✓ should reject an anomaly_score threshold above 1 (124 ms)
    ✓ should reject a battery_level threshold above 100 (106 ms)
    ✓ should submit a valid rule (139 ms)
    ✓ should submit a valid anomaly_score rule with an empty selector object (no types key required) (89 ms)
    ✓ should convert the duration field from minutes to seconds on submit (110 ms)
    ✓ should toast an error and stay open when the API call fails (105 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

### `AlertRuleList.tsx`

**Failing run** (before the component existed):

```
FAIL jsdom __tests__/unit/components/AlertRuleList.test.tsx
  ● Test suite failed to run

    Configuration error:

    Could not locate module @/components/alerts/AlertRuleList mapped as:
    /home/yzel/github/infrasight-phase4/$1.
      29 | import { AlertRuleList } from '@/components/alerts/AlertRuleList';
         | ^

Test Suites: 1 failed, 1 total
Tests:       0 total
```

**Passing run**:

```
PASS jsdom __tests__/unit/components/AlertRuleList.test.tsx
  AlertRuleList
    rendering rows
      ✓ should render name, severity, a plain-language condition, and selector chips (67 ms)
      ✓ should show a loading spinner while loading (6 ms)
      ✓ should show an error message when the query fails (7 ms)
      ✓ should show "No alert rules." when the list is empty (5 ms)
    admin gating on the enabled toggle and delete button (via useAdminAction)
      ✓ should render the toggle and delete control ENABLED for an admin, with no tooltip (19 ms)
      ✓ should render the toggle and delete control PRESENT but DISABLED with a tooltip for a non-admin in demo mode (17 ms)
      ✓ should HIDE the toggle and delete control entirely for a non-admin outside demo mode (8 ms)
    toggling enabled
      ✓ should flip enabled and toast success on completion (14 ms)
    delete confirmation
      ✓ should never call window.confirm, and should not call delete until the dialog is confirmed (46 ms)
      ✓ should not call delete when the confirmation is cancelled (33 ms)

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

## A jsdom gap this task uncovered

`CreateAlertRuleModal` renders 16 `components/ui/checkbox.tsx` instances (15 reading
types + "Enabled"). No existing test in the repo had ever rendered a Radix
`Checkbox` before (`CreateDeviceModal.tsx` and `ScheduleServiceModal.tsx` both use one,
but neither has a test file). First render attempt threw:

```
ReferenceError: ResizeObserver is not defined
  at .../@radix-ui/react-use-size/src/use-size.tsx:14:30
```

`@radix-ui/react-use-size` (used by `Checkbox` to measure itself) calls
`ResizeObserver` unconditionally in a layout effect, and jsdom doesn't implement it.
Diagnosed by rendering the component in isolation and unwrapping the
`AggregateError` React 19's `act()` throws when console errors occur during render
(`agg.errors.forEach(...)`) — Jest's default formatting only showed the outer
`AggregateError:` with no message otherwise. Fixed with a minimal polyfill added to
the **shared** `__tests__/setup/jest.setup.jsdom.ts` (not a local mock in my test
file), since this blocks any future test that renders a Radix `Checkbox`, `Switch`,
or similar:

```ts
if (typeof global.ResizeObserver === 'undefined')
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
```

Confirmed this doesn't affect any other test: full suite before vs. after this one
change stayed at the same pass count (checked in isolation before layering on the
rest of the implementation).

## Deletion-check evidence

Per the task instructions: "For every test you write, ask: would this fail if the
behavior it names were deleted? Delete the line and confirm red before claiming
green." Did this for the two required negative-validation tests and for the
admin-gating tests. Each mutation was applied to the actual production file, run,
confirmed red, then reverted and confirmed green again.

### Negative test 1: "should block submit when metric is 'value' and no type is selected"

This test asserts **both** the message renders **and** `v2Api.alertRules.create` was
**not** called — so I checked both halves independently.

**(a) Message half.** Commented out the `errors.types = '...'` assignment in
`validate()`:

```
✕ should block submit when metric is 'value' and no type is selected

  ● should block submit when metric is 'value' and no type is selected

    (waitFor timed out)
    > expect(screen.getByText(/select at least one reading type/i)).toBeInTheDocument()
```

Reverted; confirmed green again.

**(b) "Not called" half — two-step, because the component has genuine defense in
depth here.** First removed only the outer submit guard
(`if (Object.keys(validationErrors).length > 0) return;`):

```
✓ should block submit when metric is 'value' and no type is selected   ← STAYED GREEN
```

This is a real finding, not a miss: `buildCreateBody`'s own `if (!firstType) return null;`
(the same non-empty-tuple destructure that makes the discriminated union compile)
independently blocks the empty-types case even with the outer guard gone, and
`handleSubmit`'s `if (!body) return;` catches the `null`. So I additionally
commented out that inner guard too, to prove the assertion catches the fully-broken
case:

```
✕ should block submit when metric is 'value' and no type is selected

    expect(jest.fn()).not.toHaveBeenCalled()
    Expected number of calls: 0
    Received number of calls: 1
    1: {..., "metric": "value", "name": "", "selector": {"types": [undefined]}, "threshold": 0}
```

Both guards reverted; confirmed green again (full file: 7/7).

### Negative test 2: "should reject an anomaly_score threshold above 1"

`buildCreateBody` does not re-check threshold bounds at all (only `validate()` does),
so a single guard-removal suffices here. Removed the same outer submit guard:

```
✕ should reject an anomaly_score threshold above 1

    expect(jest.fn()).not.toHaveBeenCalled()
    Expected number of calls: 0
    Received number of calls: 1
    1: {"comparison": "gt", ..., "metric": "anomaly_score", "name": "Bad anomaly rule",
        "selector": {}, "severity": "warning", "threshold": 30}
```

The message assertion (in the same `waitFor`) still passed — this is exactly the
"shows the error and submits anyway" bug the task warns about, and the test catches
it. Reverted; confirmed green again (full file: 7/7).

### Admin gating (`AlertRuleList`)

Replaced both `useAdminAction()` calls with a hardcoded
`{ visible: true, disabled: false }` — simulating the exact regression class
`AlertList.test.tsx`'s docstring names ("previously hand-rolled its own isAdmin
gating instead of using `useAdminAction()`"):

```
✓ should render the toggle and delete control ENABLED for an admin, with no tooltip   ← stayed green (expected)
✕ should render the toggle and delete control PRESENT but DISABLED with a tooltip for a non-admin in demo mode

    expect(element).toBeDisabled()
    Received element is not disabled: <button aria-checked="true" ... role="checkbox" ... />

✕ should HIDE the toggle and delete control entirely for a non-admin outside demo mode

    expect(element).not.toBeInTheDocument()
    expected document not to contain element, found <button aria-checked="true" ... /> instead
```

This also confirms *why* all three branches are needed: the admin-only test alone
cannot catch this regression class (a hardcoded always-visible-always-enabled stub
satisfies it too), only the two non-admin branch tests can. Reverted; confirmed
green again (full file: 10/10).

All reverts were verified with a full-file re-run each time (not just at the very
end), and the final full-suite gate run (below) confirms nothing was left broken.

## Gate output

### `npx tsc --noEmit`

```
(no output — 0 errors, exit 0)
```

### `pnpm lint`

```
$ eslint
(no output — 0 problems, exit 0)
```

(One round-trip needed: the first `pnpm lint` run found 4 `curly` violations —
3 in `CreateAlertRuleModal.tsx`'s `validate()` if/else-if chain, 1 in the
`ResizeObserver` polyfill — fixed with `eslint --fix`, then re-verified `tsc`
was still clean and both new test files still passed after the auto-formatted
if-statements.)

### `pnpm test` (full suite)

```
Test Suites: 111 passed, 111 total
Tests:       2569 passed, 2569 total
Snapshots:   0 total
Time:        41.308 s
Ran all test suites in 2 projects.
```

Baseline entering this task was 2552 tests / 109 suites. Delta: +2 suites
(`CreateAlertRuleModal.test.tsx`, `AlertRuleList.test.tsx`), +17 tests (7 + 10). No
other suite's count changed — no regressions.

### `pnpm build`

```
   ▲ Next.js 16.0.10 (Turbopack)
 ✓ Compiled successfully in 3.8s
   Running next.config.js provided runAfterProductionCompile ...
 ✓ Completed runAfterProductionCompile in 248ms
   Running TypeScript ...
   Collecting page data using 23 workers ...
 ✓ Generating static pages using 23 workers (32/32) in 1163.1ms
   Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /alerts
├ ƒ /alerts/[id]
├ ○ /alerts/rules
├ ○ /analytics
...
├ ƒ /api/v2/alert-rules
├ ƒ /api/v2/alert-rules/[id]
...

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

`/alerts/rules` compiles as `○` (static). Build exit code 0.

## Commit

```
c4964ae feat(alerting): add alert rule management UI
```

8 files changed, 1174 insertions: `components/alerts/CreateAlertRuleModal.tsx`, `components/alerts/AlertRuleList.tsx`,
`app/alerts/rules/page.tsx`, `__tests__/unit/components/CreateAlertRuleModal.test.tsx`,
`__tests__/unit/components/AlertRuleList.test.tsx`, plus three small supporting
diffs: `components/ui/select.tsx` and `components/devices/TagInput.tsx` (both gained
an optional `id?: string` prop, forwarded to their underlying native element) and
`__tests__/setup/jest.setup.jsdom.ts` (the `ResizeObserver` polyfill).

## Deviations from the brief

1. **`AlertRuleList.test.tsx` added** (not in the brief's literal "Files" list, which
   only names `CreateAlertRuleModal.test.tsx`). Required by the outer task
   instructions' explicit demand for deletion-check evidence "for the admin gating,"
   which lives entirely in `AlertRuleList`, not the modal. Precedent: Task 16 added
   `AlertDetailPage.test.tsx` beyond its brief's file list under the same kind of
   instruction.

2. **`components/ui/select.tsx` and `components/devices/TagInput.tsx` each gained an
   optional `id?: string` prop.** Not mentioned anywhere in the brief or interface
   notes. Necessary because the task's explicit requirement — "Every input needs a
   `<label htmlFor>` so tests and screen readers can find it" — extends to the
   `Select`-based fields (metric/comparison/severity) and the `TagInput` field, and
   neither component had any way to receive a matching `id` before this change.
   Both changes are purely additive (new optional prop, forwarded to the existing
   underlying native element, default `undefined` preserves all current behavior for
   every existing caller: `CreateDeviceModal`, `ScheduleList`, `AlertList`,
   `app/analytics/page.tsx`). Confirmed via the full test suite that no existing
   consumer's test broke.

3. **The brief's literal `CreateAlertRuleModal.test.tsx` code does not compile
   against the real `Select` contract** and was rewritten rather than used verbatim.
   The brief's Step 1 test does
   `fireEvent.change(screen.getByLabelText(/metric/i), { target: { value: 'anomaly_score' } })`
   — but the interface notes are explicit that `components/ui/select.tsx` is "NOT a
   native `<select>`: ... No `onChange`, no `event.target.value`," and the notes say
   plainly "the interface notes win" when they disagree with the brief's code. My
   test file instead opens the dropdown (found via its `<label htmlFor>` association)
   and clicks the matching `role="option"` entry — see `chooseSelectOption()` in the
   test file.

4. **Two extra tests beyond the brief's three** in `CreateAlertRuleModal.test.tsx`:
   a `battery_level` bounds-rejection test (mirrors the required `anomaly_score` one,
   completing the pair the validator actually implements) and a duration-minutes-to-
   seconds conversion test (the brief calls this out as a specific numeric transform
   worth getting right — "minutes in the UI × 60 on submit" — so I gave it its own
   assertion rather than leaving it implicitly covered). Also added a test for the
   `anomaly_score`/`battery_level` empty-selector-object shape and an API-failure
   toast test, both directly named in the brief's prose ("`toast.error(err.message)`
   on failure"; the `selector?: AlertRuleSelector` optional-but-present-as-`{}`
   shape) but not in its literal three-test list.

## Uncertain / worth flagging

- **The `id` additions to `Select`/`TagInput`** are the one change in this task that
  touches shared components used elsewhere. I judged this lower-risk than the
  alternative (relying on jsdom's nested-`<label>`-wraps-a-labelable-descendant
  resolution, which I was not fully confident would behave predictably across Radix's
  internal DOM structure, especially once a dropdown is open and additional
  `role="option"` buttons — also labelable elements — exist as later siblings in tree
  order). If a reviewer prefers the wrapping-label approach instead, it would let
  these two files revert, at the cost of relying on that jsdom/testing-library
  resolution behavior I didn't fully verify against the open-dropdown case.
- **AlertRuleList's pagination** (`page`/`limit: 10`, no filter dropdowns) is my own
  addition beyond the brief's literal description ("card per rule showing name,
  severity, condition, chips, enabled toggle" — no pagination mentioned). Added it
  because every sibling list (`AlertList`, `ScheduleList`) paginates and rule counts
  could plausibly exceed one page; omitted filter-by-severity/enabled dropdowns since
  neither the brief nor any test calls for them, to avoid scope creep.
- Did not attempt a live browser/E2E walkthrough (Task 20 is explicitly "End-to-end
  coverage" as its own later task); verification here is unit tests + the four
  strict gates only.
