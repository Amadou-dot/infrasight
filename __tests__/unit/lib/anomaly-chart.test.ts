import { buildAnomalyDetectionChartData } from '@/lib/utils/anomaly-chart';

describe('buildAnomalyDetectionChartData', () => {
  it('uses hourly totals and anomaly trends instead of flattening every normal bucket', () => {
    const data = buildAnomalyDetectionChartData({
      endDate: new Date('2026-04-02T06:37:00Z'),
      hours: 3,
      totals: [
        { time_bucket: '2026-04-02T04:00:00', count: 90 },
        { time_bucket: '2026-04-02T05:00:00', count: 80 },
        { time_bucket: '2026-04-02T06:00:00', count: 120 },
      ],
      trends: [
        { time_bucket: '2026-04-02T04:00:00', count: 5 },
        { time_bucket: '2026-04-02T05:00:00', count: 18 },
        { time_bucket: '2026-04-02T06:00:00', count: 2 },
      ],
    });

    expect(data.map(point => point.normal)).toEqual([85, 62, 118]);
    expect(data.map(point => point.anomaly)).toEqual([5, 18, 2]);
  });

  it('fills missing buckets and clamps normal values at zero', () => {
    const data = buildAnomalyDetectionChartData({
      endDate: new Date('2026-04-02T06:10:00Z'),
      hours: 2,
      totals: [{ time_bucket: '2026-04-02T06:00:00', count: 4 }],
      trends: [{ time_bucket: '2026-04-02T06:00:00', count: 7 }],
    });

    expect(data).toHaveLength(2);
    expect(data[0].normal).toBe(0);
    expect(data[0].anomaly).toBe(0);
    expect(data[1].normal).toBe(0);
    expect(data[1].anomaly).toBe(7);
  });
});
