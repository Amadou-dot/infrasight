/**
 * Alert Validation Schema Tests
 */

import {
  updateAlertSchema,
  listAlertsQuerySchema,
  getAlertQuerySchema,
  alertIdParamSchema,
} from '@/lib/validations/v2/alert.validation';

describe('updateAlertSchema', () => {
  it('should accept acknowledged', () => {
    expect(updateAlertSchema.safeParse({ status: 'acknowledged' }).success).toBe(true);
  });

  it('should accept resolved with a note', () => {
    const result = updateAlertSchema.safeParse({ status: 'resolved', note: 'Replaced sensor' });
    expect(result.success).toBe(true);
  });

  it('should reject pending and firing as PATCH targets', () => {
    expect(updateAlertSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(updateAlertSchema.safeParse({ status: 'firing' }).success).toBe(false);
  });

  it('should require a status', () => {
    expect(updateAlertSchema.safeParse({ note: 'no status' }).success).toBe(false);
  });

  it('should cap the note at 1000 characters', () => {
    const result = updateAlertSchema.safeParse({ status: 'resolved', note: 'x'.repeat(1001) });
    expect(result.success).toBe(false);
  });
});

describe('listAlertsQuerySchema', () => {
  it('should accept a comma-separated status list', () => {
    const result = listAlertsQuerySchema.safeParse({ status: 'firing,acknowledged' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toEqual(['firing', 'acknowledged']);
  });

  it('should accept a single severity', () => {
    const result = listAlertsQuerySchema.safeParse({ severity: 'critical' });
    expect(result.success).toBe(true);
  });

  it('should reject an unknown status', () => {
    expect(listAlertsQuerySchema.safeParse({ status: 'smouldering' }).success).toBe(false);
  });

  it('should validate rule_id as an ObjectId', () => {
    expect(listAlertsQuerySchema.safeParse({ rule_id: 'not-an-objectid' }).success).toBe(false);
    expect(listAlertsQuerySchema.safeParse({ rule_id: '507f1f77bcf86cd799439011' }).success).toBe(true);
  });

  it('should reject a start date after the end date', () => {
    const result = listAlertsQuerySchema.safeParse({
      startDate: '2026-08-02T00:00:00.000Z',
      endDate: '2026-08-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('getAlertQuerySchema', () => {
  it('should default include_device to false', () => {
    const result = getAlertQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.include_device).toBe(false);
  });

  it('should coerce include_device from a string', () => {
    const result = getAlertQuerySchema.safeParse({ include_device: 'true' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.include_device).toBe(true);
  });
});

describe('alertIdParamSchema', () => {
  it('should reject a malformed id', () => {
    expect(alertIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});
