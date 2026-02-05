# Schedule Service Feature - Implementation Status

> Last updated: 2026-02-04 (Phases 4 & 5 completed)

## Summary

Implementing device maintenance scheduling for the Infrasight dashboard. Admins can schedule firmware updates, calibration, emergency fixes, and general maintenance for one or more devices.

---

## Completed

### Phase 1: Data Model & Validation ✅

| File | Description |
|------|-------------|
| `models/v2/ScheduleV2.ts` | Mongoose model with schema, indexes, static methods (`findByDevice`, `findUpcoming`, `complete`, `cancel`) |
| `lib/validations/v2/schedule.validation.ts` | Zod schemas: `createScheduleSchema`, `updateScheduleSchema`, `listSchedulesQuerySchema`, `getScheduleQuerySchema` |
| `types/v2/schedule.types.ts` | TypeScript types: `ServiceType`, `ScheduleStatus`, `ScheduleV2Response`, `CreateScheduleInput`, etc. |
| `lib/errors/errorCodes.ts` | Added: `SCHEDULE_NOT_FOUND`, `SCHEDULE_ALREADY_COMPLETED`, `SCHEDULE_ALREADY_CANCELLED`, `INVALID_SCHEDULED_DATE`, `INVALID_SCHEDULE_STATUS_TRANSITION` |
| `models/v2/index.ts` | Exports ScheduleV2 |
| `lib/validations/v2/index.ts` | Exports schedule validations |
| `types/v2/index.ts` | Exports schedule types |

### Phase 2: API Routes ✅

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v2/schedules` | GET | Member | List schedules with filters, pagination, sorting |
| `/api/v2/schedules` | POST | Admin | Bulk create schedules (1-100 devices) |
| `/api/v2/schedules/[id]` | GET | Member | Get single schedule with optional device details |
| `/api/v2/schedules/[id]` | PATCH | Admin | Update/reschedule/complete/cancel |
| `/api/v2/schedules/[id]` | DELETE | Admin | Cancel schedule |

**Files:**
- `app/api/v2/schedules/route.ts`
- `app/api/v2/schedules/[id]/route.ts`

### Phase 3: Frontend Data Layer ✅

| File | Description |
|------|-------------|
| `lib/api/v2-client.ts` | Added `schedulesApi` namespace with `list`, `getById`, `create`, `update`, `complete`, `cancel` methods |
| `lib/query/queryClient.ts` | Added `schedules.all`, `schedules.list(filters)`, `schedules.detail(id)` query keys |
| `lib/query/hooks/useSchedules.ts` | Created hooks: `useSchedulesList`, `useScheduleDetail`, `useCreateSchedule`, `useUpdateSchedule`, `useCompleteSchedule`, `useCancelSchedule` |
| `lib/query/hooks/index.ts` | Exports schedule hooks |

---

## Completed (Phases 4 & 5)

### Phase 4: UI Components ✅

| File | Description |
|------|-------------|
| `components/ScheduleServiceModal.tsx` | Modal for creating schedules: multi-select device picker, service type dropdown, date picker, notes textarea, form validation |
| `components/ScheduleList.tsx` | Table displaying schedules: Device, Service Type, Scheduled Date, Status, Actions (complete/cancel) |
| `components/ScheduleStatusBadge.tsx` | Status badge component (scheduled=blue, completed=green, cancelled=gray) |
| `components/ServiceTypeBadge.tsx` | Service type badge component |

**Implemented features:**
- Multi-select device picker with search (up to 500 devices)
- Date picker that only allows future dates (min=tomorrow)
- Loading/success/error states with toast notifications
- Admin-only action buttons (complete/cancel)
- Empty state and loading skeleton
- Pagination support

### Phase 5: Maintenance Page Integration ✅

**File modified:** `app/maintenance/page.tsx`

**Changes made:**
1. Added `isScheduleModalOpen` state with `useState`
2. Wired "Schedule Service" button to open modal
3. Added `<ScheduleList />` component below the timeline section
4. Modal auto-resets form state when opened/closed
5. Schedule creation shows toast and auto-refetches list via React Query invalidation

---

## Technical Notes

### Service Types
- `firmware_update`
- `calibration`
- `emergency_fix`
- `general_maintenance`

### Status Workflow
```
scheduled → completed
scheduled → cancelled
completed → (immutable)
cancelled → (immutable)
```

### Bulk Creation
POST body accepts `device_ids: string[]` (1-100 devices). Creates one schedule document per device with the same service type, date, and notes.

### Query Defaults
- GET `/api/v2/schedules` defaults to `status: 'scheduled'` unless `include_all=true`
- Sort defaults to `scheduled_date` ascending

---

## Verification Checklist

After completing Phase 4 & 5:
- [ ] Create schedule for single device
- [ ] Create schedule for multiple devices (bulk)
- [ ] Mark schedule as completed
- [ ] Cancel schedule
- [ ] Verify member cannot create/modify (read-only)
- [ ] Verify list filtering works
- [ ] Verify pagination works
- [ ] Verify date picker only allows future dates
