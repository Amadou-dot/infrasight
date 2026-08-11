import { getDeviceStatusLevel, groupDevicesByFloor } from '@/lib/utils/floor-plan';
import type { DeviceV2Response } from '@/types/v2';

const dev = (over: Record<string, unknown> = {}) =>
  ({ _id: 'd1', configuration: { threshold_warning: 30, threshold_critical: 40 }, location: { floor: 1 }, ...over }) as unknown as DeviceV2Response;

describe('getDeviceStatusLevel', () => {
  it('is offline when there is no reading', () => {
    expect(getDeviceStatusLevel(dev(), undefined)).toBe('offline');
  });
  it('is critical above the critical threshold', () => {
    expect(getDeviceStatusLevel(dev(), 41)).toBe('critical');
  });
  it('is warning above warning but at/below critical', () => {
    expect(getDeviceStatusLevel(dev(), 35)).toBe('warning');
  });
  it('is normal at/below warning', () => {
    expect(getDeviceStatusLevel(dev(), 30)).toBe('normal');
  });
  it('treats a zero threshold as a real threshold, not "unset"', () => {
    expect(
      getDeviceStatusLevel(dev({ configuration: { threshold_warning: 0, threshold_critical: 10 } }), 5)
    ).toBe('warning');
  });
  it('is normal (never critical) when thresholds are missing', () => {
    expect(getDeviceStatusLevel(dev({ configuration: undefined }), 99999)).toBe('normal');
  });
});

describe('groupDevicesByFloor', () => {
  it('keeps floor 0 devices', () => {
    const grouped = groupDevicesByFloor([dev({ location: { floor: 0 } })]);
    expect(grouped[0]).toHaveLength(1);
  });
  it('drops devices with no floor rather than crashing', () => {
    const grouped = groupDevicesByFloor([dev({ location: {} }), dev({ location: { floor: 2 } })]);
    expect(Object.keys(grouped)).toEqual(['2']);
  });
});
