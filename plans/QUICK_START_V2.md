# Quick Start Guide: V2 UI Components

## Component Usage Examples

### 1. Using the V2 API Client

```typescript
import { v2Api } from '@/lib/api/v2-client';

// Get all devices on floor 1
const response = await v2Api.devices.list({ floor: 1 });
console.log(response.data); // Array of DeviceV2Response

// Get device health
const health = await v2Api.analytics.health();
console.log(health.data.healthScore); // 95.5

// Get anomalies
const anomalies = await v2Api.analytics.anomalies({ limit: 10 });

// Error handling
try {
  const device = await v2Api.devices.getById('device_001');
} catch (error) {
  if (error instanceof ApiClientError) {
    console.error(`${error.errorCode}: ${error.message}`);
  }
}
```

### 2. Device Health Widget

```typescript
import DeviceHealthWidget from '@/components/DeviceHealthWidget';

function Dashboard() {
  const handleFilterDevices = (filter: { status?: string; hasIssues?: boolean }) => {
    console.log('Filter devices by:', filter);
    // Update your device grid filter
  };

  return (
    <DeviceHealthWidget onFilterDevices={handleFilterDevices} />
  );
}
```

### 3. Alerts Panel

```typescript
import AlertsPanel from '@/components/AlertsPanel';

function Dashboard() {
  const handleDeviceClick = (deviceId: string) => {
    console.log('Open device:', deviceId);
    // Open device detail modal
  };

  return (
    <AlertsPanel 
      onDeviceClick={handleDeviceClick}
      maxAlerts={5}
    />
  );
}
```

### 4. Device Detail Modal

```typescript
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { useState } from 'react';

function Dashboard() {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const openDevice = (deviceId: string) => {
    setSelectedDevice(deviceId);
    setModalOpen(true);
  };

  return (
    <>
      <button onClick={() => openDevice('device_001')}>
        View Device
      </button>
      
      <DeviceDetailModal
        deviceId={selectedDevice}
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedDevice(null);
        }}
      />
    </>
  );
}
```

### 5. Audit Log Viewer

```typescript
import AuditLogViewer from '@/components/AuditLogViewer';
import { v2Api } from '@/lib/api/v2-client';
import { useEffect, useState } from 'react';

function DeviceAuditPage({ deviceId }: { deviceId: string }) {
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAudit = async () => {
      try {
        const response = await v2Api.devices.getHistory(deviceId);
        setAuditLog(response.data);
      } finally {
        setLoading(false);
      }
    };
    fetchAudit();
  }, [deviceId]);

  return (
    <AuditLogViewer 
      deviceId={deviceId}
      entries={auditLog}
      loading={loading}
    />
  );
}
```

### 6. Updated Device Grid (with v2 props)

```typescript
import DeviceGrid from '@/components/DeviceGrid';

function Dashboard() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [selectedRoom, setSelectedRoom] = useState<string | 'all'>('all');
  const [deviceFilter, setDeviceFilter] = useState(null);

  const handleDeviceClick = (deviceId: string) => {
    console.log('Open device:', deviceId);
    // Open device detail modal
  };

  return (
    <DeviceGrid
      selectedFloor={selectedFloor}
      selectedRoom={selectedRoom}
      onClearRoomFilter={() => setSelectedRoom('all')}
      onDeviceClick={handleDeviceClick}
      externalFilter={deviceFilter}
    />
  );
}
```

### 7. Updated Floor Plan (with v2 props)

```typescript
import FloorPlan from '@/components/FloorPlan';

function Dashboard() {
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');

  const handleRoomClick = (roomName: string) => {
    console.log('Filter by room:', roomName);
  };

  const handleDeviceDetailClick = (deviceId: string) => {
    console.log('Open device:', deviceId);
    // Open device detail modal
  };

  return (
    <FloorPlan
      selectedFloor={selectedFloor}
      onDeviceClick={handleRoomClick}
      onDeviceDetailClick={handleDeviceDetailClick}
    />
  );
}
```

## Complete Dashboard Integration Example

```typescript
'use client';

import { useState } from 'react';
import DeviceHealthWidget from '@/components/DeviceHealthWidget';
import AlertsPanel from '@/components/AlertsPanel';
import DeviceGrid from '@/components/DeviceGrid';
import FloorPlan from '@/components/FloorPlan';
import AnomalyChart from '@/components/AnomalyChart';
import DeviceDetailModal from '@/components/DeviceDetailModal';

export default function Dashboard() {
  // Floor/Room filtering
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [selectedRoom, setSelectedRoom] = useState<string | 'all'>('all');
  
  // Device detail modal
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  
  // Device filtering
  const [deviceFilter, setDeviceFilter] = useState<any>(null);

  const openDeviceDetail = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  const closeDeviceDetail = () => {
    setDeviceModalOpen(false);
    setSelectedDeviceId(null);
  };

  return (
    <main className="p-8 space-y-8">
      {/* Header with Floor Selector */}
      <header>
        <select 
          value={selectedFloor}
          onChange={(e) => setSelectedFloor(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
        >
          <option value="all">All Floors</option>
          <option value="1">Floor 1</option>
          <option value="2">Floor 2</option>
        </select>
      </header>

      {/* Health Overview Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <DeviceHealthWidget onFilterDevices={setDeviceFilter} />
        <AlertsPanel onDeviceClick={openDeviceDetail} maxAlerts={5} />
      </div>

      {/* Visualization Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <FloorPlan
          selectedFloor={selectedFloor}
          onDeviceClick={setSelectedRoom}
          onDeviceDetailClick={openDeviceDetail}
        />
        <AnomalyChart selectedFloor={selectedFloor} />
      </div>

      {/* Device Grid */}
      <DeviceGrid
        selectedFloor={selectedFloor}
        selectedRoom={selectedRoom}
        onClearRoomFilter={() => setSelectedRoom('all')}
        onDeviceClick={openDeviceDetail}
        externalFilter={deviceFilter}
      />

      {/* Device Detail Modal */}
      <DeviceDetailModal
        deviceId={selectedDeviceId}
        isOpen={deviceModalOpen}
        onClose={closeDeviceDetail}
      />
    </main>
  );
}
```

## Key Features

### Responsive Design
All components are fully responsive:
- Mobile: Card-based layouts with expand/collapse
- Tablet: 2-column grids
- Desktop: Full table layouts

### Dark Mode
All components support dark mode via Tailwind's `dark:` variants.

### Real-time Updates
Components auto-refresh:
- DeviceHealthWidget: Every 30s
- AlertsPanel: Every 30s
- DeviceDetailModal: On open

### Error Handling
All components handle errors gracefully:
- Loading states with spinners
- Error states with messages
- Fallback to v1 API where applicable

### Type Safety
All props and responses are fully typed using TypeScript types from `types/v2/`.

## Testing Checklist

- [ ] Health widget displays correctly
- [ ] Clicking health status filters device grid
- [ ] Alerts panel shows recent anomalies
- [ ] Clicking alert opens device detail
- [ ] Device detail modal loads all tabs
- [ ] Audit log displays and filters work
- [ ] Device grid cards are clickable
- [ ] Table rows open device details
- [ ] Floor plan device clicks work
- [ ] All components handle loading states
- [ ] Error states display properly
- [ ] Dark mode works throughout
- [ ] Mobile responsive layouts work
- [ ] Auto-refresh updates data

## Troubleshooting

### "API endpoint not found" errors
The v2 API backend is not yet implemented. Components will show errors or fall back to v1 where available.

**Solution:** Complete Phase 3 of plan.md to implement v2 API endpoints.

### TypeScript errors about missing types
Ensure you've imported types from the correct location:
```typescript
import type { DeviceV2Response } from '@/types/v2';
```

### Components not updating in real-time
Check that Pusher is properly configured and the `NEXT_PUBLIC_PUSHER_*` env vars are set.

### Modal not opening
Ensure state management is correct:
```typescript
const [isOpen, setIsOpen] = useState(false);
const [deviceId, setDeviceId] = useState<string | null>(null);

// Both must be set
setDeviceId('device_001');
setIsOpen(true);
```

## Next Steps

1. **Implement v2 API Backend** (Phase 3)
2. **Migrate remaining components** to v2 API once backend is ready
3. **Add advanced features** like column visibility, export, bulk actions
4. **Performance optimization** with proper memoization
5. **Add unit tests** for all components
6. **Add E2E tests** for user flows

---

For more details, see [PHASE4_IMPLEMENTATION.md](./PHASE4_IMPLEMENTATION.md)
