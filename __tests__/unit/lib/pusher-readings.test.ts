/**
 * The readings broadcast must never exceed Pusher's 10 KB per-event cap.
 * Oversize is not an error the caller sees — the publisher swallows the 413 —
 * so the only place this invariant can be enforced is the chunker itself.
 */

import {
  chunkReadingsForBroadcast,
  toReadingBroadcast,
  MAX_BROADCAST_CHUNK_BYTES,
  type BroadcastableReading,
} from '@/lib/pusher-readings';

function makeReading(i: number): BroadcastableReading & { quality?: unknown } {
  return {
    metadata: {
      device_id: `device_v2_${String(i).padStart(4, '0')}`,
      type: 'temperature',
    },
    timestamp: new Date('2026-08-10T12:00:00.000Z'),
    value: 20 + (i % 10) * 0.37,
    // Fields a persisted document carries that must NOT reach the wire
    quality: {
      is_valid: true,
      confidence_score: 0.95,
      is_anomaly: false,
      anomaly_score: 0.05,
    },
  };
}

describe('toReadingBroadcast', () => {
  it('keeps only the fields the browser consumes and serializes the timestamp', () => {
    const wire = toReadingBroadcast(makeReading(1));
    expect(wire).toEqual({
      metadata: { device_id: 'device_v2_0001', type: 'temperature' },
      timestamp: '2026-08-10T12:00:00.000Z',
      value: 20.37,
    });
    expect(Object.keys(wire).sort()).toEqual(['metadata', 'timestamp', 'value']);
  });

  it('passes through a timestamp that is already a string', () => {
    const wire = toReadingBroadcast({
      ...makeReading(2),
      timestamp: '2026-08-10T13:00:00.000Z',
    });
    expect(wire.timestamp).toBe('2026-08-10T13:00:00.000Z');
  });
});

describe('chunkReadingsForBroadcast', () => {
  it('returns no chunks for no readings', () => {
    expect(chunkReadingsForBroadcast([])).toEqual([]);
  });

  it('packs a small batch into a single chunk', () => {
    const chunks = chunkReadingsForBroadcast([makeReading(1), makeReading(2)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it('splits a fleet-sized batch so every chunk stays under the byte budget', () => {
    const readings = Array.from({ length: 500 }, (_, i) => makeReading(i));
    const chunks = chunkReadingsForBroadcast(readings);

    // The pre-fix behavior was one ~100 KB event; the invariant is per-chunk size.
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) 
      expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(MAX_BROADCAST_CHUNK_BYTES);
    
  });

  it('preserves every reading exactly once, in order, across chunk boundaries', () => {
    const readings = Array.from({ length: 500 }, (_, i) => makeReading(i));
    const flattened = chunkReadingsForBroadcast(readings).flat();
    expect(flattened.map(r => r.metadata.device_id)).toEqual(
      readings.map(r => r.metadata.device_id)
    );
  });
});
