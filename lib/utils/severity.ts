/**
 * Device Severity Calculator Utility
 *
 * Determines the severity level of a device based on multiple factors:
 * - Battery level
 * - Maintenance schedule
 * - Device status
 * - Error counts
 */

import type { DeviceV2Response } from '@/types/v2';

// ============================================================================
// TYPES
// ============================================================================

export type Severity = 'critical' | 'warning' | 'healthy';

export interface SeverityReason {
  code: string;
  message: string;
}

export interface SeverityResult {
  severity: Severity;
  reasons: SeverityReason[];
}

// ============================================================================
// SEVERITY CALCULATION
// ============================================================================

/**
 * Calculate device severity based on multiple health factors
 */
export function calculateDeviceSeverity(device: DeviceV2Response): SeverityResult {
  const reasons: SeverityReason[] = [];
  let severity: Severity = 'healthy';

  // Critical conditions (highest priority)
  if (device.status === 'error') {
    severity = 'critical';
    reasons.push({
      code: 'STATUS_ERROR',
      message: 'Device is in error state',
    });
  }

  if (device.health.battery_level && device.health.battery_level < 15) {
    severity = 'critical';
    reasons.push({
      code: 'BATTERY_CRITICAL',
      message: `Battery critically low: ${device.health.battery_level}%`,
    });
  }

  if (device.health.error_count > 10) {
    severity = 'critical';
    reasons.push({
      code: 'HIGH_ERROR_COUNT',
      message: `High error count: ${device.health.error_count} errors`,
    });
  }

  // Check for overdue maintenance
  const nextMaint = device.metadata.next_maintenance;
  if (nextMaint && new Date(nextMaint) < new Date()) {
    severity = 'critical';
    const daysOverdue = Math.floor(
      (new Date().getTime() - new Date(nextMaint).getTime()) / (1000 * 60 * 60 * 24)
    );
    reasons.push({
      code: 'MAINTENANCE_OVERDUE',
      message: `Maintenance overdue by ${daysOverdue} days`,
    });
  }

  // If already critical, return early
  if (severity === 'critical') {
    return { severity, reasons };
  }

  // Warning conditions
  if (device.status === 'maintenance') {
    severity = 'warning';
    reasons.push({
      code: 'IN_MAINTENANCE',
      message: 'Device is in maintenance mode',
    });
  }

  if (device.health.battery_level && device.health.battery_level < 30) {
    severity = 'warning';
    reasons.push({
      code: 'BATTERY_LOW',
      message: `Battery low: ${device.health.battery_level}%`,
    });
  }

  // Check maintenance due within 7 days
  if (nextMaint && isWithinDays(nextMaint, 7) && new Date(nextMaint) >= new Date()) {
    severity = 'warning';
    const daysUntil = Math.ceil(
      (new Date(nextMaint).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );
    reasons.push({
      code: 'MAINTENANCE_DUE',
      message: `Maintenance due in ${daysUntil} days`,
    });
  }

  // Check if device is offline (last seen > 1 hour ago)
  if (device.health.last_seen) {
    const hoursSinceLastSeen =
      (new Date().getTime() - new Date(device.health.last_seen).getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceLastSeen > 1 && device.status !== 'offline') {
      severity = 'warning';
      const minutes = Math.floor(hoursSinceLastSeen * 60);
      reasons.push({
        code: 'NOT_RESPONDING',
        message: `No communication for ${minutes} minutes`,
      });
    }
  }

  if (device.status === 'offline') {
    severity = 'warning';
    reasons.push({
      code: 'OFFLINE',
      message: 'Device is offline',
    });
  }

  // If no issues found, it's healthy
  if (reasons.length === 0) {
    reasons.push({
      code: 'HEALTHY',
      message: 'All systems normal',
    });
  }

  return { severity, reasons };
}

/**
 * Get Tailwind color classes for severity level
 */
export function getSeverityColor(severity: Severity): {
  bg: string;
  text: string;
  border: string;
  badge: string;
} {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-red-50 dark:bg-red-900/20',
        text: 'text-red-900 dark:text-red-200',
        border: 'border-red-500',
        badge: 'bg-red-600 text-white',
      };
    case 'warning':
      return {
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        text: 'text-amber-900 dark:text-amber-200',
        border: 'border-amber-500',
        badge: 'bg-amber-600 text-white',
      };
    case 'healthy':
      return {
        bg: 'bg-green-50 dark:bg-green-900/20',
        text: 'text-green-900 dark:text-green-200',
        border: 'border-green-500',
        badge: 'bg-green-600 text-white',
      };
  }
}

/**
 * Get icon name for severity level (for lucide-react)
 */
export function getSeverityIcon(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return 'AlertCircle';
    case 'warning':
      return 'AlertTriangle';
    case 'healthy':
      return 'CheckCircle';
  }
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Check if a date is within N days from now
 */
export function isWithinDays(date: string | Date, days: number): boolean {
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= days;
}

/**
 * Get days until a future date (negative if past)
 */
export function getDaysUntil(date: string | Date): number {
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format a date relative to now (e.g., "in 3 days", "2 days ago")
 */
export function formatRelativeDate(date: string | Date): string {
  const days = getDaysUntil(date);
  
  if (days < 0) {
    const absDays = Math.abs(days);
    if (absDays === 0) return 'today';
    if (absDays === 1) return 'yesterday';
    return `${absDays} days ago`;
  } else {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return `in ${days} days`;
  }
}

/**
 * Check if a date is in the past
 */
export function isPast(date: string | Date): boolean {
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  return targetDate.getTime() < new Date().getTime();
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Categorize devices by severity
 */
export function categorizeDevicesBySeverity(devices: DeviceV2Response[]): {
  critical: DeviceV2Response[];
  warning: DeviceV2Response[];
  healthy: DeviceV2Response[];
} {
  const critical: DeviceV2Response[] = [];
  const warning: DeviceV2Response[] = [];
  const healthy: DeviceV2Response[] = [];

  devices.forEach((device) => {
    const { severity } = calculateDeviceSeverity(device);
    switch (severity) {
      case 'critical':
        critical.push(device);
        break;
      case 'warning':
        warning.push(device);
        break;
      case 'healthy':
        healthy.push(device);
        break;
    }
  });

  return { critical, warning, healthy };
}

/**
 * Get count of devices by severity
 */
export function getDeviceSeverityCounts(devices: DeviceV2Response[]): {
  critical: number;
  warning: number;
  healthy: number;
  total: number;
} {
  const categorized = categorizeDevicesBySeverity(devices);
  return {
    critical: categorized.critical.length,
    warning: categorized.warning.length,
    healthy: categorized.healthy.length,
    total: devices.length,
  };
}
