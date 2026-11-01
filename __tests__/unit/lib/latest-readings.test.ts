import { fetchLatestReadingsBatched } from '@/lib/api/latest-readings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(deviceId = 'device_001') {
  return Response.json({
    success: true,
    data: {
      readings: [
        {
          device_id: deviceId,
          value: 21.5,
          timestamp: '2026-10-31T00:00:00Z',
          type: 'temperature',
        },
      ],
    },
  });
}

describe('fetchLatestReadingsBatched', () => {
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(async () => response());
    global.fetch = fetchMock;
  });

  it('keys results by device id and uses at most 50 ids per URL', async () => {
    const result = await fetchLatestReadingsBatched(
      Array.from({ length: 120 }, (_, i) => `device_${i}`)
    );
    expect(result.device_001).toMatchObject({ value: 21.5, type: 'temperature' });
    expect(
      fetchMock.mock.calls.map(
        ([url]) => new URL(String(url), 'http://localhost').searchParams.getAll('device_ids').length
      )
    ).toEqual([50, 50, 20]);
  });

  it('starts three batches and publishes a finished batch while others are pending', async () => {
    const pending = Array.from({ length: 4 }, () => deferred<Response>());
    pending.forEach(item => fetchMock.mockImplementationOnce(() => item.promise));
    const onBatch = jest.fn();
    const result = fetchLatestReadingsBatched(
      Array.from({ length: 151 }, (_, i) => `device_${i}`),
      { onBatch }
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    pending[1].resolve(response('device_50'));
    await new Promise(resolve => setImmediate(resolve));
    expect(onBatch).toHaveBeenCalledWith(
      expect.objectContaining({ device_50: expect.objectContaining({ value: 21.5 }) })
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    pending[0].resolve(response('device_0'));
    pending[2].resolve(response('device_100'));
    pending[3].resolve(response('device_150'));
    expect(Object.keys(await result).sort()).toEqual([
      'device_0',
      'device_100',
      'device_150',
      'device_50',
    ]);
  });

  it('deduplicates ids before batching', async () => {
    await fetchLatestReadingsBatched(Array(60).fill('device_001'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost').searchParams.getAll(
        'device_ids'
      )
    ).toEqual(['device_001']);
  });

  it('returns an empty map for no ids without fetching', async () => {
    expect(await fetchLatestReadingsBatched([])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces HTTP failures instead of caching an empty successful snapshot', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { success: false, error: { code: 'UNAVAILABLE', message: 'Try again' } },
        { status: 503 }
      )
    );
    await expect(fetchLatestReadingsBatched(['device_001'])).rejects.toThrow('Try again');
  });

  it('rejects a malformed success envelope', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }));
    await expect(fetchLatestReadingsBatched(['device_001'])).rejects.toThrow();
  });

  it('does not publish late responses or launch queued batches after cancellation', async () => {
    const pending = deferred<Response>();
    const controller = new AbortController();
    fetchMock.mockImplementation(() => pending.promise);
    const onBatch = jest.fn();
    const result = fetchLatestReadingsBatched(
      Array.from({ length: 151 }, (_, i) => `device_${i}`),
      { signal: controller.signal, onBatch }
    );
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    pending.resolve(response());
    await rejection;
    expect(onBatch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});
