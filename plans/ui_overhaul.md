## Plan: Dashboard UI Overhaul - From "Table Fatigue" to "Command Center"

**Objective:** Transform the Infrasight dashboard from a passive data display into an intelligent Command Center that prioritizes critical issues, surfaces actionable insights, and eliminates "Table Fatigue" through hierarchical information architecture and predictive analytics.

---

### Context

**Current State:**

- **Entry Point:** page.tsx - Main dashboard container
- **Core Components:**
  - DeviceGrid.tsx - TanStack table displaying all devices equally (678 lines)
  - DeviceHealthWidget.tsx - Status counts (249 lines)
  - AlertsPanel.tsx - Anomaly alerts (222 lines)
  - FloorPlan.tsx - Visual floor layout (392 lines)
  - DeviceDetailModal.tsx - Device drill-down (491 lines)

**Available Data (V2 Schema):**

- **DeviceV2:** `metadata.next_maintenance`, `metadata.warranty_expiry`, `health.battery_level`, `health.last_seen`, `compliance.data_classification`, `compliance.requires_encryption`, `health.error_count`, `health.uptime_percentage`
- **ReadingV2:** `context.ambient_temp`, `value` (device CPU temp), `quality.is_anomaly`, `quality.anomaly_score`, `context.battery_level`, `context.signal_strength`

**Key Dependencies:**

- v2-client.ts - Typed API client with `devices`, `readings`, `analytics`, `metadata` modules
- DeviceV2.ts & ReadingV2.ts - Data schemas
- route.ts - Health analytics endpoint (already supports `offline_threshold_minutes`, `battery_warning_threshold`)

---

### Architectural Principles

1. **Inverted Pyramid:** Critical → Urgent → Healthy (top-to-bottom)
2. **Progressive Disclosure:** Summary cards → detailed views → drill-down modals
3. **Visual Hierarchy:** Color-coded severity (Red → Amber → Green → Gray)
4. **Contextual Intelligence:** Surface WHY, not just WHAT (correlation, trends)
5. **Mobile-First Command Center:** Works on tablets in the field

---

### Execution Steps

#### **Phase 1: New API Endpoints for Predictive Analytics**

**1.1. Create Maintenance Forecast API**

- **File:** route.ts (NEW)
- **Logic:**

  ```typescript
  GET /api/v2/analytics/maintenance-forecast
  Query params: days_ahead (default: 7), severity_threshold (default: 'medium')

  Returns:
  {
    critical: Device[] // battery < 15% OR next_maintenance < 3 days
    warning: Device[] // battery < 30% OR next_maintenance < 7 days
    watch: Device[] // warranty_expiry < 30 days
    summary: {
      total_at_risk: number
      critical_count: number
      avg_battery_all: number
      maintenance_overdue: Device[] // next_maintenance < NOW
    }
  }
  ```

- **Implementation:** Aggregate query on DeviceV2 with date arithmetic for `next_maintenance`, `warranty_expiry`, and battery thresholds.

**1.2. Create Temperature Correlation API**

- **File:** route.ts (NEW)
- **Logic:**

  ```typescript
  GET /api/v2/analytics/temperature-correlation?device_id={id}

  Returns:
  {
    device_id: string
    device_temp_series: Array<{timestamp, value}> // last 24h
    ambient_temp_series: Array<{timestamp, value}> // last 24h from context
    correlation_score: number // -1 to 1
    diagnosis: 'device_failure' | 'environmental' | 'normal'
    threshold_breaches: Array<{timestamp, device_temp, ambient_temp}>
  }
  ```

- **Implementation:**
  - Query ReadingV2 for device's temperature readings (type='temperature')
  - Extract `context.ambient_temp` from same readings
  - Calculate Pearson correlation coefficient
  - Diagnosis logic:
    - If device_temp > 80°C and ambient_temp < 30°C → `device_failure`
    - If device_temp > 50°C and ambient_temp > 35°C → `environmental`
    - Else → `normal`

**1.3. Extend Health Analytics Endpoint**

- **File:** route.ts (MODIFY)
- **Add to response:**
  ```typescript
  alerts: {
    // ... existing alerts
    predictive_maintenance: {
      count: number;
      devices: Array<{ id; issue_type; days_until; severity }>;
    }
  }
  ```

---

#### **Phase 2: New UI Components**

**2.1. Create "Impending Doom" Widget**

- **File:** `components/MaintenanceForecastWidget.tsx` (NEW)
- **Design:**
  ```
  ┌─────────────────────────────────────────┐
  │ ⚠️ Maintenance Forecast                  │
  │                                          │
  │ 🔴 CRITICAL (2)                         │
  │   • device_050: Battery 8% (2h left)    │
  │   • device_023: Maintenance overdue 3d  │
  │                                          │
  │ 🟡 WARNING (5)                          │
  │   • device_012: Maintenance in 4 days   │
  │   • device_044: Battery 18%             │
  │   [Show 3 more...]                      │
  │                                          │
  │ 👁️ WATCH (8)                            │
  │   • Warranty expiring soon              │
  └─────────────────────────────────────────┘
  ```
- **Data Source:** `v2Api.analytics.maintenanceForecast()`
- **Interactions:**
  - Click device → Open DeviceDetailModal
  - Click section → Filter DeviceGrid by severity
- **Auto-refresh:** 60 seconds
- **Props:**
  ```typescript
  interface MaintenanceForecastWidgetProps {
    onDeviceClick?: (deviceId: string) => void;
    onFilterBySeverity?: (severity: 'critical' | 'warning' | 'watch') => void;
    daysAhead?: number; // default 7
  }
  ```

**2.2. Create Priority Summary Cards (Hero Section)**

- **File:** `components/PrioritySummaryCards.tsx` (NEW)
- **Layout:** 4 cards in a row (responsive grid)
  1. **Critical Issues** (Red)
     - Icon: AlertTriangle
     - Metric: Count of devices with `status='error'` OR `battery < 15%` OR `maintenance overdue`
     - Subtext: "Require immediate attention"
  2. **Maintenance Due** (Amber)
     - Icon: Wrench
     - Metric: Count from maintenance forecast (critical + warning)
     - Subtext: "Within 7 days"
  3. **System Health** (Green/Amber/Red based on score)
     - Icon: Activity
     - Metric: Overall health score %
     - Subtext: "Uptime average"
  4. **Anomalies** (Purple)
     - Icon: TrendingUp
     - Metric: Count of anomalous readings in last 24h
     - Subtext: "Pattern deviations"
- **Interactions:** Click → Filter DeviceGrid OR scroll to relevant section
- **Data Source:** Parallel calls to `health()`, `maintenanceForecast()`, `anomalies()`

**2.3. Create Temperature Correlation Panel**

- **File:** `components/TemperatureCorrelationPanel.tsx` (NEW)
- **Design:**
  ```
  ┌─────────────────────────────────────────────────┐
  │ 🌡️ Temperature Analysis: device_023             │
  │                                                  │
  │ Device Temp: 85°C ━━━━━━━━━━●                  │
  │ Ambient Temp: 22°C ━━●                          │
  │                                                  │
  │ 📊 [Dual-line chart: 24h history]              │
  │    - Red line: Device CPU temp                  │
  │    - Blue line: Ambient temp                    │
  │                                                  │
  │ 🔍 Diagnosis: Device Failure Likely             │
  │    Ambient is normal but device is overheating  │
  │    → Schedule immediate inspection              │
  └─────────────────────────────────────────────────┘
  ```
- **Trigger:** Shown in DeviceDetailModal when `device.type = 'temperature'` OR device has temperature readings
- **Data Source:** `v2Api.analytics.temperatureCorrelation({ device_id })`
- **Visualization:** Recharts with dual Y-axes

**2.4. Enhance DeviceDetailModal with Security Badge**

- **File:** DeviceDetailModal.tsx (MODIFY)
- **Changes:**
  1. Add compliance section to "Overview" tab:
     ```tsx
     {
       device.compliance.data_classification === 'restricted' && (
         <div className="border-2 border-purple-500 rounded-lg p-4 bg-purple-50 dark:bg-purple-900/20">
           <Lock className="h-5 w-5 text-purple-600" />
           <Badge className="bg-purple-600">RESTRICTED</Badge>
           <p>Sensitive data - encryption required</p>
         </div>
       );
     }
     ```
  2. Border styling based on classification:
     - `restricted` → Gold/Purple gradient border
     - `confidential` → Orange border
     - `internal` → Default
     - `public` → Green border
  3. Add encryption icon if `compliance.requires_encryption === true`

**2.5. Overhaul DeviceGrid with Priority Sections**

- **File:** DeviceGrid.tsx (MAJOR REFACTOR)
- **New Structure:**
  ```
  ┌─────────────────────────────────────────┐
  │ 🚨 CRITICAL ISSUES (2)                  │ ← Collapsible, default OPEN
  │   [Device cards with red border]        │
  │                                          │
  │ ⚠️ NEEDS ATTENTION (5)                  │ ← Collapsible, default OPEN
  │   [Device cards with amber border]      │
  │                                          │
  │ ✅ HEALTHY (43)                         │ ← Collapsible, default CLOSED
  │   [Minimized view or table]             │
  └─────────────────────────────────────────┘
  ```
- **Categorization Logic:**
  - **Critical:** `status='error'` OR `battery < 15%` OR `maintenance_overdue` OR `error_count > 10`
  - **Attention:** `status='maintenance'` OR `battery < 30%` OR `maintenance < 7 days` OR `offline > 1h` OR `has_anomalies`
  - **Healthy:** Everything else
- **Visual Treatment:**
  - Critical/Attention: Card-based layout with prominent metrics
  - Healthy: Collapsed table view (TanStack table preserved for sorting/filtering)
- **Keep Existing Features:**
  - Real-time Pusher updates
  - Sorting, filtering, search
  - Room/floor/type filters
  - Click to open DeviceDetailModal

---

#### **Phase 3: Layout Restructuring**

**3.1. Update page.tsx Layout**

- **File:** page.tsx (MODIFY)
- **New Layout Order (top to bottom):**
  1. Header (existing, keep as-is)
  2. **NEW: Priority Summary Cards** (4-card row)
  3. **Row 1:** MaintenanceForecastWidget (left) + DeviceHealthWidget (right)
  4. **Row 2:** AlertsPanel (left) + AnomalyChart (right)
  5. **Row 3:** FloorPlan (full width, collapsible)
  6. **Row 4:** DeviceGrid (refactored with priority sections)
- **Mobile Responsiveness:** Stack vertically, maintain priority order

**3.2. Add Global Filters & Search**

- **File:** page.tsx (MODIFY)
- **Add to header:**
  - Quick filters: "Show Critical Only" | "Show All"
  - Global search: Search across device IDs, serial numbers, rooms
  - Time range selector: "Last 1h" | "Last 24h" | "Last 7d"
- **Behavior:** Filters propagate to all child components via context or props

---

#### **Phase 4: Supporting Utilities**

**4.1. Create Severity Calculator Utility**

- **File:** `lib/utils/severity.ts` (NEW)
- **Functions:**

  ```typescript
  export type Severity = 'critical' | 'warning' | 'healthy';

  export function calculateDeviceSeverity(device: DeviceV2Response): Severity {
    // Battery critical
    if (device.health.battery_level && device.health.battery_level < 15) return 'critical';

    // Maintenance overdue
    const nextMaint = device.metadata.next_maintenance;
    if (nextMaint && new Date(nextMaint) < new Date()) return 'critical';

    // Error status or high error count
    if (device.status === 'error' || device.health.error_count > 10) return 'critical';

    // Warning conditions
    if (device.health.battery_level && device.health.battery_level < 30) return 'warning';
    if (nextMaint && isWithinDays(nextMaint, 7)) return 'warning';
    if (device.status === 'maintenance') return 'warning';

    return 'healthy';
  }

  export function getSeverityColor(severity: Severity): string {
    // Returns Tailwind classes
  }

  export function isWithinDays(date: string | Date, days: number): boolean {
    // Date math helper
  }
  ```

**4.2. Create Correlation Utility**

- **File:** `lib/utils/correlation.ts` (NEW)
- **Function:**
  ```typescript
  export function calculatePearsonCorrelation(x: number[], y: number[]): number {
    // Standard Pearson correlation coefficient calculation
    // Returns value between -1 and 1
  }
  ```

**4.3. Update v2-client with New Endpoints**

- **File:** v2-client.ts (MODIFY)
- **Add to `analyticsApi`:**
  ```typescript
  maintenanceForecast(query: MaintenanceForecastQuery): Promise<...>
  temperatureCorrelation(query: { device_id: string }): Promise<...>
  ```

---

#### **Phase 5: Type Definitions**

**5.1. Add New Types**

- **File:** api.types.ts (MODIFY)
- **Add:**

  ```typescript
  export interface MaintenanceForecastQuery {
    days_ahead?: number;
    severity_threshold?: 'critical' | 'warning' | 'all';
  }

  export interface MaintenanceForecastResponse {
    critical: DeviceV2Response[];
    warning: DeviceV2Response[];
    watch: DeviceV2Response[];
    summary: {
      total_at_risk: number;
      critical_count: number;
      avg_battery_all: number;
      maintenance_overdue: DeviceV2Response[];
    };
  }

  export interface TemperatureCorrelationResponse {
    device_id: string;
    device_temp_series: Array<{ timestamp: string; value: number }>;
    ambient_temp_series: Array<{ timestamp: string; value: number }>;
    correlation_score: number;
    diagnosis: 'device_failure' | 'environmental' | 'normal';
    threshold_breaches: Array<{
      timestamp: string;
      device_temp: number;
      ambient_temp: number;
    }>;
  }
  ```

---

### Verification Steps

1. **API Verification:**
   - Test new endpoints: `pnpm tsx scripts/v2/test-api.ts`
   - Verify maintenance forecast returns correct devices based on battery/date thresholds
   - Verify correlation calculation with known datasets

2. **Component Isolation:**
   - Build each new component in isolation with mock data
   - Verify responsive behavior (desktop, tablet, mobile)
   - Test dark mode compatibility

3. **Integration Testing:**
   - Verify DeviceGrid categorization logic with seeded data
   - Test filter propagation from PrioritySummaryCards → DeviceGrid
   - Verify real-time updates still work with new layout
   - Test modal interactions (MaintenanceForecast → DeviceDetailModal)

4. **Performance:**
   - Measure load time of new dashboard (should be < 2s on 3G)
   - Verify no memory leaks from auto-refresh intervals
   - Check bundle size increase (target < +100KB)

5. **User Flow Testing:**
   - Scenario 1: User logs in, sees 2 critical issues in hero cards, clicks → filtered grid
   - Scenario 2: Device shows high temp, user clicks → sees correlation panel → identifies room AC failure
   - Scenario 3: Maintenance forecast shows battery warning → user clicks device → schedules maintenance

---

### Unknowns / Risks

**1. Data Availability:**

- **Risk:** Current devices may not have `next_maintenance` or `warranty_expiry` populated
- **Mitigation:** Update seed-v2.ts to ensure these fields are populated. Add migration script to backfill production data.

**2. Correlation Accuracy:**

- **Risk:** Ambient temp may not be available for all devices (depends on sensor type)
- **Mitigation:** Only show correlation panel when both `device.type = 'temperature'` AND `context.ambient_temp` exists in readings. Otherwise, show "Insufficient data" message.

**3. Performance of Aggregations:**

- **Risk:** Maintenance forecast query may be slow with large device counts (> 10,000 devices)
- **Mitigation:** Add MongoDB indexes on `metadata.next_maintenance`, `metadata.warranty_expiry`, `health.battery_level`. Consider caching forecast results for 5 minutes.

**4. UI Complexity:**

- **Risk:** DeviceGrid refactor is substantial (678 lines) - could break existing features
- **Mitigation:** Create components/DeviceGrid.v2.tsx as separate file initially, test thoroughly, then swap. Keep DeviceGrid.v1.backup.tsx as rollback.

**5. Mobile Layout:**

- **Risk:** 4-card hero section may not fit well on mobile
- **Mitigation:** Use responsive grid (2x2 on mobile, 4x1 on desktop). Test on iPhone SE (smallest viewport).

**6. Compliance Visualization:**

- **Risk:** Gold/Purple borders may clash with existing design system
- **Mitigation:** Use subtle gradient borders only for `restricted`, solid colors for others. Add design review step.

---

### Implementation Phases

**Phase 1 (Backend):** API endpoints → 2-3 days  
**Phase 2 (Components):** New widgets → 3-4 days  
**Phase 3 (Refactor):** DeviceGrid overhaul → 2-3 days  
**Phase 4 (Integration):** Layout & testing → 2 days  
**Phase 5 (Polish):** Dark mode, mobile, performance → 1-2 days

**Total Estimate:** 10-14 days

---

### Success Metrics

1. **Time to Critical Issue:** User identifies critical issue in < 5 seconds (vs. current scrolling)
2. **Click Reduction:** 50% fewer clicks to reach actionable information
3. **Mobile Usability:** Full functionality on tablets (currently desktop-only)
4. **Predictive Accuracy:** Maintenance forecast catches 90%+ of failures before they occur
5. **User Feedback:** "Command Center" feel vs. "data dump"

---

**Plan Author:** GitHub Copilot (Architect Agent)  
**Plan Version:** 1.0  
**Date:** December 22, 2025  
**Target Completion:** January 5, 2026
