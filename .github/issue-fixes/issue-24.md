## Task

Update DeviceGrid and FloorPlan components to use v2 API and enhance UX.

## Component Updates

### `components/DeviceGrid.tsx`

New Columns:
- Serial number
- Manufacturer/Model
- Health status (color-coded)
- Last seen (with status indicator)
- Battery level (if available)
- Signal strength (if available)

New Features:
- Advanced filtering: By tags, department, health status, manufacturer, last_seen
- Bulk actions: Update status, Add tags
- Column visibility toggle
- Saved filter presets (localStorage)
- Export filtered data
- Actions menu: View history, Edit config, Schedule maintenance, View audit

### `components/FloorPlan.tsx`

Enhancements:
- Device health color-coding (active=green, maintenance=yellow, offline=gray, error=red)
- Battery warnings visual (health.battery_level < 20%)
- Offline device highlighting (gray out)
- Signal strength indicators on hover
- Last seen timestamp on hover
- Click to open device detail modal
- Show only devices with issues toggle

## Requirements

- Use `/api/v2/devices` with enhanced query params
- Utilize new device fields: serial_number, manufacturer, model, health metrics
- Implement efficient filtering and sorting
- Add proper loading and error states
- Mobile-responsive design

## Acceptance Criteria

- [ ] New columns display correctly
- [ ] Filtering works for all fields
- [ ] Bulk actions functional
- [ ] FloorPlan visual indicators working
- [ ] Click handlers open detail modal
- [ ] Filter presets save/load
- [ ] Mobile responsive
