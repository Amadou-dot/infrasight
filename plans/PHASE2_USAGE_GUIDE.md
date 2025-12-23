# Phase 2 Components - Quick Usage Guide

## Quick Integration Examples

### 1. Using MaintenanceForecastWidget

```tsx
import MaintenanceForecastWidget from '@/components/MaintenanceForecastWidget';

function Dashboard() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [gridFilter, setGridFilter] = useState<any>(null);

  const handleDeviceClick = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  const handleFilterBySeverity = (severity: 'critical' | 'warning' | 'watch') => {
    setGridFilter({ severity });
    // Your DeviceGrid component should react to this filter
  };

  return (
    <MaintenanceForecastWidget
      onDeviceClick={handleDeviceClick}
      onFilterBySeverity={handleFilterBySeverity}
      daysAhead={7}
    />
  );
}
```

### 2. Using PrioritySummaryCards

```tsx
import PrioritySummaryCards, { type CardFilter } from '@/components/PrioritySummaryCards';

function Dashboard() {
  const handleCardClick = (filter: CardFilter) => {
    switch (filter.type) {
      case 'critical':
        // Filter DeviceGrid to show only critical devices
        setDeviceFilter({ severity: 'critical' });
        break;
      case 'maintenance':
        // Filter DeviceGrid to show devices needing maintenance
        setDeviceFilter({ maintenanceDue: true });
        break;
      case 'health':
        // Scroll to or highlight health section
        break;
      case 'anomalies':
        // Filter to show only devices with anomalies
        setDeviceFilter({ hasAnomalies: true });
        break;
    }
  };

  return (
    <PrioritySummaryCards onCardClick={handleCardClick} />
  );
}
```

### 3. Using TemperatureCorrelationPanel

```tsx
import TemperatureCorrelationPanel from '@/components/TemperatureCorrelationPanel';

// Already integrated into DeviceDetailModal for temperature devices
// Can also be used standalone:

function TemperatureDiagnostics({ deviceId }: { deviceId: string }) {
  return (
    <div className="space-y-4">
      <h2>Temperature Analysis</h2>
      <TemperatureCorrelationPanel deviceId={deviceId} />
    </div>
  );
}
```

### 4. DeviceDetailModal with New Features

The modal automatically shows:
- **Security badges** in Overview tab (all devices)
- **Temperature correlation** in Readings tab (temperature devices only)

No changes needed - just use the existing modal:

```tsx
import DeviceDetailModal from '@/components/DeviceDetailModal';

function Dashboard() {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      {/* Your dashboard content */}
      
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

### 5. Using Severity Utilities

```tsx
import {
  calculateDeviceSeverity,
  getSeverityColor,
  categorizeDevicesBySeverity,
  formatRelativeDate,
} from '@/lib/utils/severity';
import type { DeviceV2Response } from '@/types/v2';

function DeviceCard({ device }: { device: DeviceV2Response }) {
  const { severity, reasons } = calculateDeviceSeverity(device);
  const colors = getSeverityColor(severity);

  return (
    <div className={`border-2 ${colors.border} ${colors.bg} p-4 rounded-lg`}>
      <h3>{device._id}</h3>
      <Badge className={colors.badge}>{severity.toUpperCase()}</Badge>
      
      {reasons.map((reason, i) => (
        <p key={i} className="text-sm">{reason.message}</p>
      ))}
      
      {device.metadata.next_maintenance && (
        <p className="text-xs">
          Maintenance: {formatRelativeDate(device.metadata.next_maintenance)}
        </p>
      )}
    </div>
  );
}

// Batch categorization
function DeviceList({ devices }: { devices: DeviceV2Response[] }) {
  const { critical, warning, healthy } = categorizeDevicesBySeverity(devices);
  
  return (
    <div>
      <h3>Critical ({critical.length})</h3>
      {critical.map(device => <DeviceCard key={device._id} device={device} />)}
      
      <h3>Warning ({warning.length})</h3>
      {warning.map(device => <DeviceCard key={device._id} device={device} />)}
      
      <h3>Healthy ({healthy.length})</h3>
      {healthy.map(device => <DeviceCard key={device._id} device={device} />)}
    </div>
  );
}
```

---

## Complete Dashboard Integration Example

```tsx
'use client';

import { useState } from 'react';
import PrioritySummaryCards, { type CardFilter } from '@/components/PrioritySummaryCards';
import MaintenanceForecastWidget from '@/components/MaintenanceForecastWidget';
import DeviceHealthWidget from '@/components/DeviceHealthWidget';
import AlertsPanel from '@/components/AlertsPanel';
import FloorPlan from '@/components/FloorPlan';
import AnomalyChart from '@/components/AnomalyChart';
import DeviceGrid from '@/components/DeviceGrid';
import DeviceDetailModal from '@/components/DeviceDetailModal';

export default function Dashboard() {
  // State management
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [selectedRoom, setSelectedRoom] = useState<string | 'all'>('all');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [deviceFilter, setDeviceFilter] = useState<any>(null);

  // Handlers
  const openDeviceDetail = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceModalOpen(true);
  };

  const closeDeviceDetail = () => {
    setDeviceModalOpen(false);
    setSelectedDeviceId(null);
  };

  const handleCardClick = (filter: CardFilter) => {
    setDeviceFilter(filter);
  };

  const handleSeverityFilter = (severity: 'critical' | 'warning' | 'watch') => {
    setDeviceFilter({ severity });
  };

  return (
    <main className="p-4 md:p-8 space-y-6">
      {/* Header with Floor Selector */}
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">IoT Dashboard</h1>
        <select
          value={selectedFloor}
          onChange={(e) => setSelectedFloor(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
          className="px-4 py-2 rounded-lg border"
        >
          <option value="all">All Floors</option>
          <option value="1">Floor 1</option>
          <option value="2">Floor 2</option>
          <option value="3">Floor 3</option>
        </select>
      </header>

      {/* NEW: Priority Summary Cards (Hero Section) */}
      <PrioritySummaryCards onCardClick={handleCardClick} />

      {/* Row 1: Maintenance Forecast + Device Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MaintenanceForecastWidget
          onDeviceClick={openDeviceDetail}
          onFilterBySeverity={handleSeverityFilter}
          daysAhead={7}
        />
        <DeviceHealthWidget onFilterDevices={setDeviceFilter} />
      </div>

      {/* Row 2: Alerts + Anomaly Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AlertsPanel onDeviceClick={openDeviceDetail} maxAlerts={5} />
        <AnomalyChart selectedFloor={selectedFloor} />
      </div>

      {/* Row 3: Floor Plan (Full Width, Collapsible) */}
      <FloorPlan
        selectedFloor={selectedFloor}
        onDeviceClick={setSelectedRoom}
        onDeviceDetailClick={openDeviceDetail}
      />

      {/* Row 4: Device Grid */}
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

---

## Component Props Reference

### MaintenanceForecastWidget
```typescript
interface MaintenanceForecastWidgetProps {
  onDeviceClick?: (deviceId: string) => void;
  onFilterBySeverity?: (severity: 'critical' | 'warning' | 'watch') => void;
  daysAhead?: number; // default: 7
}
```

### PrioritySummaryCards
```typescript
interface PrioritySummaryCardsProps {
  onCardClick?: (filter: CardFilter) => void;
}

type CardFilter = 
  | { type: 'critical' }
  | { type: 'maintenance' }
  | { type: 'health' }
  | { type: 'anomalies' };
```

### TemperatureCorrelationPanel
```typescript
interface TemperatureCorrelationPanelProps {
  deviceId: string;
}
```

---

## Styling Notes

All components use:
- **Tailwind CSS** for styling
- **shadcn/ui** components (Card, Badge, Button, Dialog)
- **lucide-react** icons
- **Recharts** for visualizations
- Dark mode via `dark:` variants

Color scheme:
- Critical/Error: Red (`red-500`, `red-600`)
- Warning/Maintenance: Amber (`amber-500`, `amber-600`)
- Healthy/Success: Green (`green-500`, `green-600`)
- Info/Watch: Blue (`blue-500`, `blue-600`)
- Anomalies: Purple (`purple-500`, `purple-600`)

---

## Testing Checklist

- [ ] PrioritySummaryCards shows correct counts
- [ ] Clicking cards filters DeviceGrid
- [ ] MaintenanceForecastWidget auto-refreshes
- [ ] Clicking devices opens modal
- [ ] TemperatureCorrelationPanel shows chart
- [ ] Security badges display with correct colors
- [ ] All components handle loading states
- [ ] Error states show retry buttons
- [ ] Dark mode works throughout
- [ ] Mobile responsive layouts stack correctly

---

**Ready for Phase 3!**
