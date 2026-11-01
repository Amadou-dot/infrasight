import type { FloorPlanDevice } from '@/types/v2';

export type DeviceStatusLevel = 'offline' | 'critical' | 'warning' | 'normal';

/**
 * Threshold comparison for the floor-plan tile status.
 *
 * `typeof === 'number'` (not `||`) so a configured threshold of 0 counts and a
 * missing threshold disables that level instead of comparing against a magic
 * 9999 — under which a device with no thresholds could never leave "Normal".
 */
export function getDeviceStatusLevel(
  device: Pick<FloorPlanDevice, 'configuration'>,
  value: number | undefined
): DeviceStatusLevel {
  if (value === undefined) return 'offline';
  const critical = device.configuration?.threshold_critical;
  const warning = device.configuration?.threshold_warning;
  if (typeof critical === 'number' && value > critical) return 'critical';
  if (typeof warning === 'number' && value > warning) return 'warning';
  return 'normal';
}

/** Groups by floor keeping floor 0; devices without a floor are omitted. */
export function groupDevicesByFloor<TDevice extends Pick<FloorPlanDevice, 'location'>>(
  devices: TDevice[]
): Record<number, TDevice[]> {
  const grouped: Record<number, TDevice[]> = {};
  for (const d of devices) {
    const floor = d.location?.floor;
    if (floor == null) continue;
    (grouped[floor] ??= []).push(d);
  }
  return grouped;
}
