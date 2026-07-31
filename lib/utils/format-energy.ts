/**
 * Format an energy total for display.
 *
 * Readings are summed in kilowatt-hours, which reaches five or six digits across a
 * building's worth of devices. This scales to the largest unit that keeps the number
 * readable.
 */
export function formatEnergy(kilowattHours: number): string {
  if (!Number.isFinite(kilowattHours)) return '—';

  const magnitude = Math.abs(kilowattHours);

  if (magnitude >= 1_000_000) return `${(kilowattHours / 1_000_000).toFixed(1)} GWh`;
  if (magnitude >= 1_000) return `${(kilowattHours / 1_000).toFixed(1)} MWh`;

  // Fractional kilowatt-hours are noise at building scale.
  return `${Math.round(kilowattHours)} kWh`;
}
