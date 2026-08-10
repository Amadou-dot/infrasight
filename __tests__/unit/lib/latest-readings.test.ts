import { fetchLatestReadingsBatched } from '@/lib/api/latest-readings';

describe('fetchLatestReadingsBatched', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          readings: [
            {
              device_id: 'device_001',
              value: 21.5,
              timestamp: '2026-08-10T00:00:00Z',
              type: 'temperature',
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;
  });

  it('splits requests into batches of 50 ids', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `device_${i}`);
    await fetchLatestReadingsBatched(ids);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    const firstUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(firstUrl.match(/device_ids=/g)).toHaveLength(50);
  });

  it('keys results by device id', async () => {
    const result = await fetchLatestReadingsBatched(['device_001']);
    expect(result['device_001']).toMatchObject({ value: 21.5, type: 'temperature' });
  });

  it('returns an empty map for no ids without fetching', async () => {
    const result = await fetchLatestReadingsBatched([]);
    expect(result).toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
