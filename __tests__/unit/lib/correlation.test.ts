/**
 * Correlation Utilities Tests
 *
 * Tests for statistical correlation functions used in temperature analysis.
 */

import {
  calculatePearsonCorrelation,
  diagnoseTemperature,
  getDiagnosisExplanation,
  type TemperatureDiagnosis,
} from '@/lib/utils/correlation';

describe('Correlation Utilities', () => {
  // ==========================================================================
  // PEARSON CORRELATION
  // ==========================================================================

  describe('calculatePearsonCorrelation()', () => {
    describe('Valid inputs', () => {
      it('should return 1 for perfect positive correlation', () => {
        const x = [1, 2, 3, 4, 5];
        const y = [2, 4, 6, 8, 10];
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeCloseTo(1, 10);
      });

      it('should return -1 for perfect negative correlation', () => {
        const x = [1, 2, 3, 4, 5];
        const y = [10, 8, 6, 4, 2];
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeCloseTo(-1, 10);
      });

      it('should return 0 for no correlation', () => {
        // Orthogonal vectors have no correlation
        const x = [1, 0, -1, 0];
        const y = [0, 1, 0, -1];
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeCloseTo(0, 10);
      });

      it('should calculate correlation for real temperature data', () => {
        const deviceTemps = [20, 25, 30, 35, 40];
        const ambientTemps = [18, 20, 22, 24, 26];
        const result = calculatePearsonCorrelation(deviceTemps, ambientTemps);
        expect(result).toBeCloseTo(1, 10); // Strong positive correlation
      });

      it('should handle single element arrays', () => {
        const x = [5];
        const y = [10];
        // Single point has undefined correlation (division by zero)
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeNull();
      });

      it('should handle two element arrays', () => {
        const x = [1, 2];
        const y = [2, 4];
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeCloseTo(1, 10);
      });

      it('should handle arrays with identical values', () => {
        const x = [5, 5, 5, 5];
        const y = [10, 20, 30, 40];
        // Zero variance in x leads to division by zero
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeNull();
      });

      it('should handle negative numbers', () => {
        const x = [-5, -3, -1, 1, 3, 5];
        const y = [-10, -6, -2, 2, 6, 10];
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeCloseTo(1, 10);
      });

      it('should handle decimal numbers', () => {
        const x = [0.1, 0.2, 0.3, 0.4, 0.5];
        const y = [0.2, 0.4, 0.6, 0.8, 1.0];
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeCloseTo(1, 10);
      });

      it('should handle moderate positive correlation', () => {
        const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const y = [2, 3, 4, 3, 5, 6, 7, 6, 8, 9]; // Some noise
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeGreaterThan(0.8);
        expect(result).toBeLessThan(1);
      });

      it('should handle weak correlation', () => {
        const x = [1, 2, 3, 4, 5];
        const y = [5, 2, 4, 1, 3]; // Random-ish
        const result = calculatePearsonCorrelation(x, y);
        expect(result).not.toBeNull();
        expect(Math.abs(result!)).toBeLessThanOrEqual(0.5);
      });
    });

    describe('Invalid inputs', () => {
      it('should return null for mismatched array lengths', () => {
        const x = [1, 2, 3];
        const y = [1, 2];
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeNull();
      });

      it('should return null for empty arrays', () => {
        const result = calculatePearsonCorrelation([], []);
        expect(result).toBeNull();
      });

      it('should return null when both arrays have zero variance', () => {
        const x = [5, 5, 5, 5];
        const y = [10, 10, 10, 10];
        const result = calculatePearsonCorrelation(x, y);
        expect(result).toBeNull();
      });
    });
  });

  // ==========================================================================
  // TEMPERATURE DIAGNOSIS
  // ==========================================================================

  describe('diagnoseTemperature()', () => {
    describe('Device failure detection', () => {
      it('should detect device failure when device is hot but ambient is normal', () => {
        const result = diagnoseTemperature(85, 25);
        expect(result).toBe('device_failure');
      });

      it('should detect device failure at threshold boundary', () => {
        const result = diagnoseTemperature(81, 29);
        expect(result).toBe('device_failure');
      });

      it('should detect device failure with custom thresholds', () => {
        const result = diagnoseTemperature(65, 20, 60, 25);
        expect(result).toBe('device_failure');
      });
    });

    describe('Environmental issue detection', () => {
      it('should detect environmental issue when both are hot', () => {
        const result = diagnoseTemperature(55, 38);
        expect(result).toBe('environmental');
      });

      it('should detect environmental at boundary values', () => {
        const result = diagnoseTemperature(51, 36);
        expect(result).toBe('environmental');
      });

      it('should detect environmental with very high temps', () => {
        const result = diagnoseTemperature(90, 45);
        expect(result).toBe('environmental');
      });
    });

    describe('Normal temperature detection', () => {
      it('should return normal for typical room conditions', () => {
        const result = diagnoseTemperature(45, 22);
        expect(result).toBe('normal');
      });

      it('should return normal for cool conditions', () => {
        const result = diagnoseTemperature(30, 18);
        expect(result).toBe('normal');
      });

      it('should return normal when device is moderately warm but ambient is cool', () => {
        const result = diagnoseTemperature(60, 20);
        expect(result).toBe('normal');
      });

      it('should return normal when below all thresholds', () => {
        const result = diagnoseTemperature(40, 25);
        expect(result).toBe('normal');
      });
    });

    describe('Edge cases', () => {
      it('should handle zero temperatures', () => {
        const result = diagnoseTemperature(0, 0);
        expect(result).toBe('normal');
      });

      it('should handle negative temperatures', () => {
        const result = diagnoseTemperature(-10, -20);
        expect(result).toBe('normal');
      });

      it('should handle extreme values', () => {
        const result = diagnoseTemperature(200, 100);
        expect(result).toBe('environmental');
      });

      it('should prioritize device failure over environmental', () => {
        // Device hot (>80), ambient below threshold (<30)
        const result = diagnoseTemperature(85, 29);
        expect(result).toBe('device_failure');
      });
    });
  });

  // ==========================================================================
  // DIAGNOSIS EXPLANATION
  // ==========================================================================

  describe('getDiagnosisExplanation()', () => {
    it('should provide explanation for device failure', () => {
      const explanation = getDiagnosisExplanation('device_failure', 85.5, 22.3);
      expect(explanation).toContain('85.5°C');
      expect(explanation).toContain('22.3°C');
      expect(explanation).toContain('internal device failure');
      expect(explanation).toContain('Schedule immediate inspection');
    });

    it('should provide explanation for environmental issue', () => {
      const explanation = getDiagnosisExplanation('environmental', 55.0, 38.5);
      expect(explanation).toContain('55.0°C');
      expect(explanation).toContain('38.5°C');
      expect(explanation).toContain('environmental issue');
      expect(explanation).toContain('building climate control');
    });

    it('should provide explanation for normal conditions', () => {
      const explanation = getDiagnosisExplanation('normal', 45.2, 22.8);
      expect(explanation).toContain('45.2°C');
      expect(explanation).toContain('22.8°C');
      expect(explanation).toContain('within normal ranges');
    });

    it('should format temperatures to one decimal place', () => {
      const explanation = getDiagnosisExplanation('normal', 45.123, 22.789);
      expect(explanation).toContain('45.1°C');
      expect(explanation).toContain('22.8°C');
    });

    it('should handle all diagnosis types', () => {
      const diagnoses: TemperatureDiagnosis[] = ['device_failure', 'environmental', 'normal'];

      for (const diagnosis of diagnoses) {
        const explanation = getDiagnosisExplanation(diagnosis, 50, 25);
        expect(typeof explanation).toBe('string');
        expect(explanation.length).toBeGreaterThan(0);
      }
    });
  });
});
