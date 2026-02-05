/**
 * QueryClient Schedule Keys Tests
 *
 * Tests for schedule query key factories in queryClient.ts
 */

import { queryKeys } from '@/lib/query/queryClient';

describe('queryKeys.schedules', () => {
  it('should have an all key', () => {
    expect(queryKeys.schedules.all).toEqual(['schedules']);
  });

  it('should generate list key without filters', () => {
    const key = queryKeys.schedules.list();
    expect(key).toEqual(['schedules', 'list', undefined]);
  });

  it('should generate list key with filters', () => {
    const filters = { status: 'scheduled', service_type: 'calibration' };
    const key = queryKeys.schedules.list(filters);
    expect(key).toEqual(['schedules', 'list', filters]);
  });

  it('should generate detail key for a specific ID', () => {
    const key = queryKeys.schedules.detail('abc123');
    expect(key).toEqual(['schedules', 'detail', 'abc123']);
  });

  it('should produce unique keys for different filters', () => {
    const key1 = queryKeys.schedules.list({ status: 'scheduled' });
    const key2 = queryKeys.schedules.list({ status: 'completed' });
    expect(key1).not.toEqual(key2);
  });

  it('should produce unique keys for different IDs', () => {
    const key1 = queryKeys.schedules.detail('id_1');
    const key2 = queryKeys.schedules.detail('id_2');
    expect(key1).not.toEqual(key2);
  });
});
