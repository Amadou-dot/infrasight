# Add Device Feature Implementation Plan (Revised)

## Goal

Allow users to create new devices from the Devices page using a modal form that validates input, submits to the v2 API, and refreshes the list on success.

## Current State

- “Add Device” button exists but has no handler.
- `POST /api/v2/devices` is implemented with validation, rate limiting, and auth.
- `lib/api/v2-client.ts` lacks a `deviceApi.create()` method.
- UI uses shadcn/ui; no form library is in use (use `useState`).

## Scope

**In scope**
- Modal form with required fields + optional sections.
- Client-side validation using existing Zod schema.
- Error handling for API responses.
- Refresh device list after creation.

**Out of scope**
- Bulk import, templates, cloning, grouping, external registries.

## Implementation Plan

### 1) API Client + Types

**Files**
- `lib/api/v2-client.ts`
- `types/v2/api.types.ts`

**Add**
- `CreateDevicePayload` interface (aligned with API contract).
- `deviceApi.create()` that POSTs to `/api/v2/devices` and returns `ApiResponse<DeviceV2Response>`.

### 2) UI Building Blocks

**Add UI components if missing**
- `components/ui/label.tsx`
- `components/ui/input.tsx`
- `components/ui/collapsible.tsx`
- `components/ui/checkbox.tsx`

**New custom component**
- `components/devices/TagInput.tsx` for `metadata.tags`.

### 3) CreateDeviceModal

**File**
- `components/devices/CreateDeviceModal.tsx`

**Props**
```ts
interface CreateDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (device: DeviceV2Response) => void;
}
```

**Form sections** (collapsible groups)
1. **Basic Information** (always visible)
   - `_id`, `serial_number`, `manufacturer`, `device_model`, `firmware_version`, `type`
2. **Location** (default open)
   - `building_id`, `floor`, `room_name`, `zone`, `coordinates`
3. **Configuration** (default open)
   - `threshold_warning`, `threshold_critical`, `sampling_interval`, `calibration_date`, `calibration_offset`
4. **Metadata** (default collapsed)
   - `department`, `tags`, `cost_center`, `warranty_expiry`, `last_maintenance`, `next_maintenance`
5. **Compliance** (default collapsed)
   - `requires_encryption`, `data_classification`, `retention_days`

**State defaults**
- Start with minimal required values plus safe defaults (e.g., `sampling_interval: 60`, `department: 'unknown'`, `retention_days: 90`).

**Validation**
- Use `createDeviceSchema.safeParse(formData)` and show field-level errors.

**Submission**
- Disable submit while loading.
- On success: call `onSuccess()`, clear draft, close modal.

### 4) Devices Page Wiring

**File**
- `app/devices/page.tsx`

**Add**
- Modal open state.
- Render `CreateDeviceModal`.
- Hook “Add Device” button to open the modal.
- Refresh list on success (React Query invalidate or existing refetch path).

### 5) Error Handling

**Map API errors to UX**

| Code | Status | UX message |
|------|--------|------------|
| `SERIAL_NUMBER_EXISTS` | 409 | Serial number already exists |
| `DEVICE_ID_EXISTS` | 409 | Device ID already exists |
| `VALIDATION_ERROR` | 400 | Show field errors |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests. Try again. |
| `UNAUTHORIZED` | 401 | Redirect to sign-in |

**Display**
- Field errors below inputs.
- General error banner at top of modal.

### 6) UX Enhancements (Optional, if time permits)

1. **Generate Device ID** button.
2. **Type-based defaults** for thresholds.
3. **Draft persistence** in localStorage.
4. **Success toast** on creation.

## File Change Summary

| File | Action | Summary |
|------|--------|---------|
| `lib/api/v2-client.ts` | Modify | Add `deviceApi.create()` |
| `types/v2/api.types.ts` | Modify | Add `CreateDevicePayload` |
| `components/devices/CreateDeviceModal.tsx` | Create | Device creation modal |
| `components/devices/TagInput.tsx` | Create | Tag input for metadata.tags |
| `components/ui/label.tsx` | Create | Field labels |
| `components/ui/input.tsx` | Create | Text/number inputs |
| `components/ui/collapsible.tsx` | Create | Collapsible sections |
| `components/ui/checkbox.tsx` | Create | Boolean input |
| `app/devices/page.tsx` | Modify | Wire up modal + refresh |

## Testing Checklist

- Required fields validate on submit.
- Device ID/serial uniqueness errors render correctly.
- All device types selectable.
- Minimal + full payload submissions succeed.
- Modal closes on success and list refreshes.
- Loading/disabled submit state works.
- Escape closes; Enter submits.
