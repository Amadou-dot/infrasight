/**
 * Reading Validation Schema – String Transform Coverage
 *
 * Exercises the comma-separated string → array transforms and
 * string → number transforms that are NOT hit by the existing tests
 * (which pass native types instead of query-string values).
 *
 * Targeted lines in reading.validation.ts:
 *  - listReadingsQuerySchema:  type (255), source (264), min_confidence (274),
 *    min_anomaly_score (275)
 *  - latestReadingsQuerySchema: type (306)
 *  - readingAnalyticsQuerySchema: device_id (325), type (340), floor (348)
 *  - anomalyAnalyticsQuerySchema: device_id (376), type (384)
 */

import {
  listReadingsQuerySchema,
  latestReadingsQuerySchema,
  readingAnalyticsQuerySchema,
  anomalyAnalyticsQuerySchema,
} from '@/lib/validations/v2/reading.validation';

// ---------------------------------------------------------------------------
// listReadingsQuerySchema – comma-separated type / source, string numbers
// ---------------------------------------------------------------------------

describe('listReadingsQuerySchema string transforms', () => {
  it('should transform comma-separated type string into array', () => {
    const result = listReadingsQuerySchema.safeParse({
      device_id: 'device_001',
      type: 'temperature,humidity',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toEqual(['temperature', 'humidity']);
    }
  });

  it('should transform comma-separated source string into array', () => {
    const result = listReadingsQuerySchema.safeParse({
      device_id: 'device_001',
      source: 'sensor,manual',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toEqual(['sensor', 'manual']);
    }
  });

  it('should transform string min_confidence to number', () => {
    const result = listReadingsQuerySchema.safeParse({
      device_id: 'device_001',
      min_confidence: '0.85',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.min_confidence).toBe(0.85);
    }
  });

  it('should transform string min_anomaly_score to number', () => {
    const result = listReadingsQuerySchema.safeParse({
      device_id: 'device_001',
      min_anomaly_score: '0.7',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.min_anomaly_score).toBe(0.7);
    }
  });
});

// ---------------------------------------------------------------------------
// latestReadingsQuerySchema – comma-separated type
// ---------------------------------------------------------------------------

describe('latestReadingsQuerySchema string transforms', () => {
  it('should transform comma-separated type string into array', () => {
    const result = latestReadingsQuerySchema.safeParse({
      device_ids: 'device_001',
      type: 'temperature,humidity,power',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toEqual(['temperature', 'humidity', 'power']);
    }
  });
});

// ---------------------------------------------------------------------------
// readingAnalyticsQuerySchema – comma-separated device_id / type, string floor
// ---------------------------------------------------------------------------

describe('readingAnalyticsQuerySchema string transforms', () => {
  it('should transform comma-separated device_id string into array', () => {
    const result = readingAnalyticsQuerySchema.safeParse({
      device_id: 'device_001,device_002',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.device_id).toEqual(['device_001', 'device_002']);
    }
  });

  it('should transform comma-separated type string into array', () => {
    const result = readingAnalyticsQuerySchema.safeParse({
      device_id: 'device_001',
      type: 'temperature,humidity',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toEqual(['temperature', 'humidity']);
    }
  });

  it('should transform string floor to number', () => {
    const result = readingAnalyticsQuerySchema.safeParse({
      device_id: 'device_001',
      floor: '3',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.floor).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// anomalyAnalyticsQuerySchema – comma-separated device_id / type
// ---------------------------------------------------------------------------

describe('anomalyAnalyticsQuerySchema string transforms', () => {
  it('should transform comma-separated device_id string into array', () => {
    const result = anomalyAnalyticsQuerySchema.safeParse({
      device_id: 'device_001,device_002,device_003',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.device_id).toEqual(['device_001', 'device_002', 'device_003']);
    }
  });

  it('should transform comma-separated type string into array', () => {
    const result = anomalyAnalyticsQuerySchema.safeParse({
      type: 'temperature,power,energy',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toEqual(['temperature', 'power', 'energy']);
    }
  });
});
