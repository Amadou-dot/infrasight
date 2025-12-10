## Task

Create new dashboard components for health monitoring, alerts, and audit logs.

## Components to Create

### `/components/DeviceHealthWidget.tsx`

Displays:
- System-wide health score (% devices with status='active')
- Device status breakdown (pie chart: active, maintenance, offline, error)
- Critical alerts count
- Devices needing maintenance (metadata.next_maintenance < 7 days)
- Offline devices list (with links to details)
- Battery warnings (health.battery_level < 20%)
- Click handlers to filter main grid

Data source: `/api/v2/analytics/health`

### `/components/DeviceDetailModal.tsx`

Displays:
- Full device information (all fields)
- Configuration editor (edit threshold, sampling_interval, etc.)
- Recent readings chart (last 100 readings)
- Health metrics history visualization
- Audit log viewer (linked to AuditLogViewer component)
- Maintenance schedule (last_maintenance, next_maintenance)
- Actions: Edit, Delete (soft delete), Schedule maintenance

Data sources:
- `/api/v2/devices/[id]` for device info
- `/api/v2/readings?device_id=[id]&limit=100` for readings
- `/api/v2/devices/[id]/history` for audit log

### `/components/AlertsPanel.tsx`

Displays:
- Recent anomalies (quality.is_anomaly=true, sorted by timestamp)
- Critical threshold breaches (reading.value > device.configuration.threshold_critical)
- Device offline alerts (health.last_seen > 5 minutes)
- Battery warnings (health.battery_level < 20%)
- Maintenance due notifications (metadata.next_maintenance < today)
- Dismissible alerts (stored in localStorage)
- Click to view device details

Data source: `/api/v2/analytics/anomalies`

### `/components/AuditLogViewer.tsx`

Displays:
- Filterable audit log table
- Filters: date range, user (created_by/updated_by/deleted_by), action type
- Change history with visual diffs (before/after values)
- Export functionality (JSON format)
- Pagination support
- Search by device, user, action type, date

Data source: `/api/v2/audit` or `/api/v2/devices/[id]/history`

## Requirements

- All components should use v2 API client
- Proper error handling and loading states
- Type-safe props and data
- Responsive design
- Real-time updates where applicable (Pusher integration)

## Acceptance Criteria

- [ ] All 4 components implemented
- [ ] Data fetched correctly from v2 API
- [ ] Error handling in place
- [ ] Loading states visible
- [ ] Modals/panels open/close correctly
- [ ] All interactive features work
- [ ] Responsive on mobile
