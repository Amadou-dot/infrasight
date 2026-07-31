/**
 * Energy Formatting Tests
 *
 * The dashboard previously hardcoded "4.2 MWh". Readings are summed in kilowatt-hours,
 * so the raw total needs scaling to a readable unit.
 */

import { formatEnergy } from '@/lib/utils/format-energy';

describe('formatEnergy', () => {
  it('should keep small totals in kilowatt-hours', () => {
    expect(formatEnergy(0)).toBe('0 kWh');
    expect(formatEnergy(842)).toBe('842 kWh');
    expect(formatEnergy(999)).toBe('999 kWh');
  });

  it('should scale to megawatt-hours at a thousand', () => {
    expect(formatEnergy(1000)).toBe('1.0 MWh');
    expect(formatEnergy(29723.38)).toBe('29.7 MWh');
  });

  it('should scale to gigawatt-hours at a million', () => {
    expect(formatEnergy(1_000_000)).toBe('1.0 GWh');
    expect(formatEnergy(2_450_000)).toBe('2.5 GWh');
  });

  it('should round kilowatt-hours to whole numbers', () => {
    // Fractional kWh is noise at this scale.
    expect(formatEnergy(842.6)).toBe('843 kWh');
  });

  it('should handle negative totals rather than producing NaN', () => {
    expect(formatEnergy(-500)).toBe('-500 kWh');
    expect(formatEnergy(-29723.38)).toBe('-29.7 MWh');
  });

  it('should return a placeholder for values that are not finite', () => {
    // The API can legitimately return no data; the card should show a dash, not "NaN MWh".
    expect(formatEnergy(Number.NaN)).toBe('—');
    expect(formatEnergy(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
