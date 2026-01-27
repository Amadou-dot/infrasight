/**
 * Statistical Correlation Utilities
 *
 * Functions for calculating correlation coefficients between data series.
 */

// ============================================================================
// PEARSON CORRELATION
// ============================================================================

/**
 * Calculate Pearson correlation coefficient between two arrays
 *
 * @param x - First data series
 * @param y - Second data series
 * @returns Correlation coefficient between -1 and 1, or null if invalid
 *
 * @example
 * const deviceTemps = [20, 25, 30, 35, 40];
 * const ambientTemps = [18, 20, 22, 24, 26];
 * const correlation = calculatePearsonCorrelation(deviceTemps, ambientTemps);
 * // Returns ~0.99 (strong positive correlation)
 */
export function calculatePearsonCorrelation(x: number[], y: number[]): number | null {
  // Validate inputs
  if (x.length !== y.length || x.length === 0) return null;

  const n = x.length;

  // Calculate means
  const meanX = x.reduce((sum, val) => sum + val, 0) / n;
  const meanY = y.reduce((sum, val) => sum + val, 0) / n;

  // Calculate correlation coefficient
  let numerator = 0;
  let sumXSquared = 0;
  let sumYSquared = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = x[i] - meanX;
    const yDiff = y[i] - meanY;

    numerator += xDiff * yDiff;
    sumXSquared += xDiff * xDiff;
    sumYSquared += yDiff * yDiff;
  }

  const denominator = Math.sqrt(sumXSquared * sumYSquared);

  // Avoid division by zero
  if (denominator === 0) return null;

  return numerator / denominator;
}

// ============================================================================
// TEMPERATURE DIAGNOSIS
// ============================================================================

export type TemperatureDiagnosis = 'device_failure' | 'environmental' | 'normal';

/**
 * Diagnose temperature issues based on device and ambient temperatures
 *
 * @param deviceTemp - Current device temperature in Celsius
 * @param ambientTemp - Current ambient temperature in Celsius
 * @param deviceTempThreshold - Threshold for concerning device temp (default 80°C)
 * @param ambientTempThreshold - Threshold for concerning ambient temp (default 30°C)
 * @returns Diagnosis: 'device_failure', 'environmental', or 'normal'
 */
export function diagnoseTemperature(
  deviceTemp: number,
  ambientTemp: number,
  deviceTempThreshold: number = 80,
  ambientTempThreshold: number = 30
): TemperatureDiagnosis {
  // Device is hot, but ambient is normal → Device failure
  if (deviceTemp > deviceTempThreshold && ambientTemp < ambientTempThreshold)
    return 'device_failure';

  // Both device and ambient are hot → Environmental issue
  if (deviceTemp > 50 && ambientTemp > 35) return 'environmental';

  // Everything is normal
  return 'normal';
}

/**
 * Get human-readable explanation for temperature diagnosis
 */
export function getDiagnosisExplanation(
  diagnosis: TemperatureDiagnosis,
  deviceTemp: number,
  ambientTemp: number
): string {
  switch (diagnosis) {
    case 'device_failure':
      return `Device temperature (${deviceTemp.toFixed(1)}°C) is elevated while ambient temperature (${ambientTemp.toFixed(1)}°C) is normal. This suggests an internal device failure. Schedule immediate inspection.`;
    case 'environmental':
      return `Both device temperature (${deviceTemp.toFixed(1)}°C) and ambient temperature (${ambientTemp.toFixed(1)}°C) are elevated. This suggests an environmental issue (e.g., room AC failure). Check building climate control.`;
    case 'normal':
      return `Device temperature (${deviceTemp.toFixed(1)}°C) and ambient temperature (${ambientTemp.toFixed(1)}°C) are within normal ranges.`;
  }
}
