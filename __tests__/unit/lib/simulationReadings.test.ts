import {
  calculateAnomalyProbability,
  generateSimulatedReadings,
  type SimulatedDevice,
  type SimulationProfile,
} from '@/lib/simulation/readings';

describe('calculateAnomalyProbability', () => {
  const profile: SimulationProfile = {
    anomalyBaseRate: 0.03,
    burstMultiplier: 1.4,
    volatility: 1,
  };

  it('boosts hotspot floors and types without exceeding the upper clamp', () => {
    const baseDevice: SimulatedDevice = {
      _id: 'device_001',
      type: 'temperature',
      location: { building_id: 'b1', floor: 2, room_name: '201' },
    };

    const baseProbability = calculateAnomalyProbability(baseDevice, profile);
    const boostedProbability = calculateAnomalyProbability(baseDevice, {
      ...profile,
      anomalyBaseRate: 0.08,
      burstMultiplier: 4,
      hotspotType: 'temperature',
      hotspotFloor: 2,
    });

    expect(boostedProbability).toBeGreaterThan(baseProbability);
    expect(boostedProbability).toBeLessThanOrEqual(0.24);
  });

  it('keeps motion sensors less noisy than power sensors under the same profile', () => {
    const powerDevice: SimulatedDevice = {
      _id: 'device_power',
      type: 'power',
      location: { building_id: 'b1', floor: 3, room_name: '301' },
    };
    const motionDevice: SimulatedDevice = {
      _id: 'device_motion',
      type: 'motion',
      location: { building_id: 'b1', floor: 3, room_name: '302' },
    };

    expect(calculateAnomalyProbability(powerDevice, profile)).toBeGreaterThan(
      calculateAnomalyProbability(motionDevice, profile)
    );
  });
});

describe('generateSimulatedReadings', () => {
  it('keeps normal power readings inside the documented band', () => {
    // Jitter used to be applied on top of the 100W floor, so a small enough base draw
    // combined with negative jitter produced sub-100W — occasionally negative — watts.
    // Enough samples that the old behaviour would fail this essentially every run.
    const devices: SimulatedDevice[] = Array.from({ length: 500 }, (_, i) => ({
      _id: `device_power_${i}`,
      type: 'power',
      location: { building_id: 'b1', floor: 1, room_name: '101' },
    }));

    const values: number[] = [];
    for (let run = 0; run < 4; run++)
      generateSimulatedReadings(devices).forEach(reading => values.push(reading.value as number));

    expect(values).toHaveLength(2000);
    values.forEach(value => {
      expect(value).toBeGreaterThanOrEqual(100);
      expect(value).toBeLessThanOrEqual(15000);
    });
  });
});
