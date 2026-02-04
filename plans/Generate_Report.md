# Plan: Generate Report Feature

## Problem & Approach

Add an admin-only "Generate Report" flow that produces a downloadable PDF with device health summary stats (counts only — no device names/IDs). The dashboard already has a non-functional "Generate Report" button (`app/page.tsx:97-102`); this plan wires it up and adds the same capability to the Analytics page.

**Approach:** New `GET /api/v2/reports/device-health` endpoint aggregates device counts from `DeviceV2`, generates a PDF via `pdf-lib`, and streams it back. A shared `<GenerateReportModal>` component lets the admin pick scope (all buildings or one building) and triggers the download.

---

## Workplan

### 1. Install dependency

- [ ] `pnpm add pdf-lib` — lightweight (~200 KB), zero native deps, works in Node.

### 2. Validation schema — `lib/validations/v2/report.validation.ts`

- [ ] Create Zod schema following the pattern in `lib/validations/v2/device.validation.ts`:
  ```ts
  export const reportGenerateQuerySchema = z.object({
    scope: z.enum(['all', 'building']),
    building_id: z.string().optional(),
  }).refine(
    d => d.scope === 'all' || !!d.building_id,
    { message: 'building_id is required when scope is "building"', path: ['building_id'] }
  );
  export type ReportGenerateQuery = z.infer<typeof reportGenerateQuerySchema>;
  ```

### 3. API types — `types/v2/api.types.ts`

- [ ] Add `ReportGenerateQuery` re-export (or inline) so the client can import the shape.
- [ ] No response type needed (response is `application/pdf`, not JSON).

### 4. API route — `app/api/v2/reports/device-health/route.ts`

- [ ] Follow the standard v2 route pattern (`withErrorHandler`, `dbConnect`, `validateQuery`, `requireAdmin`). Reference `app/api/v2/analytics/health/route.ts` for structure.
- [ ] **Auth:** `requireAdmin()` — report generation is admin-only.
- [ ] **Validation:** `validateQuery(searchParams, reportGenerateQuerySchema)`.
- [ ] **Aggregation** — single `DeviceV2.aggregate()` pipeline:
  - Match: exclude soft-deleted (`audit.deleted_at: { $exists: false }`). For decommissioned/deleted count, run a separate match that includes deleted devices.
  - Group by `location.building_id`, `location.floor`, `status`.
  - Reshape in JS into:
    ```
    {
      generated_at: string,
      scope: 'all' | 'building',
      building_id?: string,
      summary: { total, active, maintenance, offline, error, decommissioned },
      breakdowns: [{ building_id, summary, floors: [{ floor, summary }] }]
    }
    ```
  - When `scope=building`, filter the pipeline to `location.building_id === building_id` and include per-floor breakdowns.
  - When `scope=all`, include per-building summaries (no per-floor).
- [ ] **Decommissioned count:** devices where `status === 'decommissioned'` OR `audit.deleted_at` exists. These two sets may overlap; use `$or` and deduplicate in the pipeline.
- [ ] **PDF generation:** build PDF with `pdf-lib`:
  - Title: "Infrasight Device Health Report"
  - Subtitle: scope description + generation date
  - Summary table: status → count
  - Breakdown tables (per-building or per-floor depending on scope)
  - No device IDs, serial numbers, or room names.
- [ ] **Response:** return raw `Response` with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="infrasight-report-<scope>-<YYYY-MM-DD>.pdf"`. Do **not** use `jsonSuccess` (binary payload).
- [ ] **No caching** — reports should reflect live data.

### 5. API client method — `lib/api/v2-client.ts`

- [ ] Add `reports` namespace to `v2Api`:
  ```ts
  const reportsApi = {
    async generateDeviceHealth(query: ReportGenerateQuery): Promise<Blob> {
      const qs = buildQueryString(query);
      const res = await fetch(`/api/v2/reports/device-health${qs}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error?.message ?? 'Report generation failed');
      }
      return res.blob();
    },
  };
  ```
  Then add `reports: reportsApi` to the `v2Api` export.

### 6. Report modal component — `components/GenerateReportModal.tsx`

- [ ] Use the `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` pattern from `components/ui/dialog.tsx` (same pattern as `DeviceDetailModal`).
- [ ] Props: `isOpen: boolean`, `onClose: () => void`.
- [ ] Internal state: `scope` (default `'all'`), `selectedBuildingId`, `isGenerating`.
- [ ] Use `useMetadata()` hook (from `lib/query/hooks`) to populate building dropdown.
- [ ] On submit: call `v2Api.reports.generateDeviceHealth(...)`, create a blob URL, trigger `<a download>` click, show success toast (`react-toastify`). On error, show error toast.
- [ ] Admin guard: component assumes caller already checked `isAdmin`; no redundant check inside.

### 7. Wire up Dashboard — `app/page.tsx`

- [ ] Import `GenerateReportModal`.
- [ ] Add state: `const [reportModalOpen, setReportModalOpen] = useState(false);`
- [ ] Replace the existing static button (line 98) with `onClick={() => setReportModalOpen(true)}`.
- [ ] Render `<GenerateReportModal isOpen={reportModalOpen} onClose={() => setReportModalOpen(false)} />`.

### 8. Wire up Analytics page — `app/analytics/page.tsx`

- [ ] Import `useRbac` from `lib/auth/rbac-client`, `GenerateReportModal`, `FileText` from `lucide-react`.
- [ ] Add the same modal state + button pattern as Dashboard (admin-gated).
- [ ] Place the button next to the existing floor filter in the header area.

### 9. Tests

- [ ] **Integration test** — `__tests__/integration/api/reports.test.ts`:
  - `GET /api/v2/reports/device-health?scope=all` returns `200` with `content-type: application/pdf`.
  - `GET /api/v2/reports/device-health?scope=building&building_id=BLDG-001` returns `200`.
  - `GET /api/v2/reports/device-health?scope=building` (missing building_id) returns `400`.
  - Non-admin user receives `403`.
- [ ] **Unit test** — `__tests__/unit/validations/report.validation.test.ts`:
  - Validate `reportGenerateQuerySchema` accepts/rejects expected inputs.
- [ ] Run `pnpm test` to check for regressions.

---

## Files Created / Modified

| Action | Path |
|--------|------|
| Create | `lib/validations/v2/report.validation.ts` |
| Create | `app/api/v2/reports/device-health/route.ts` |
| Create | `components/GenerateReportModal.tsx` |
| Create | `__tests__/integration/api/reports.test.ts` |
| Create | `__tests__/unit/validations/report.validation.test.ts` |
| Modify | `types/v2/api.types.ts` — add `ReportGenerateQuery` |
| Modify | `lib/api/v2-client.ts` — add `reports` namespace |
| Modify | `app/page.tsx` — wire button + modal |
| Modify | `app/analytics/page.tsx` — add button + modal |
| Modify | `package.json` — add `pdf-lib` |

## Notes

- **V2 only** — never read from deprecated v1 models.
- **No device identifiers in output** — report contains only aggregate counts by status, building, and floor.
- **Deleted semantics** — "decommissioned/deleted" = `status === 'decommissioned'` OR `audit.deleted_at` exists. Use `$or` in the aggregation pipeline.
- **PDF lib choice** — `pdf-lib` is pure JS, no native bindings, small footprint. Sufficient for tables and text.
- **No caching** — fresh aggregation on every request.
- **RBAC** — server enforces via `requireAdmin()`; client hides UI via `useRbac().isAdmin`.
