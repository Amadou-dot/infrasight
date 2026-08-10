/**
 * Wire shape and chunking for the public readings broadcast.
 *
 * Pusher rejects any event whose payload exceeds 10 KB, and it does so with an
 * HTTP 413 *after* the readings have already been committed to MongoDB — the
 * publisher swallows the failure by design, so an oversized payload doesn't
 * error, it silently kills the realtime feed. At the seeded fleet size (500
 * devices) a full-document payload is ~100 KB, so every broadcast was lost.
 *
 * Two defenses, both here: readings are trimmed to the fields the browser
 * actually consumes (`PusherReading` in lib/pusher-context.tsx), and the
 * trimmed array is packed into byte-bounded chunks, each published as its own
 * `new-readings` event. Client handlers already receive an array per event, so
 * a multi-chunk broadcast needs no client change.
 *
 * This module is dependency-free of `lib/pusher` (which throws without the
 * server-only PUSHER_SECRET) so tests and future publishers can import it
 * without env setup.
 */

import type { ReadingType } from '@/types/v2/reading.types';

/**
 * One reading as it travels over the wire. Must stay assignable to
 * `PusherReading` (lib/pusher-context.tsx) — the browser's copy of this shape.
 */
export interface ReadingBroadcast {
  metadata: {
    device_id: string;
    type: ReadingType;
  };
  timestamp: string;
  value: number;
}

/** Structural subset of a persisted reading that the trim needs. */
export interface BroadcastableReading {
  metadata: { device_id: string; type: ReadingType };
  timestamp: Date | string;
  value: number;
}

/**
 * Pusher's hard cap is 10 KB per event. The budget leaves headroom for the
 * envelope (channel, event name, JSON escaping) rather than packing to the cap.
 */
export const MAX_BROADCAST_CHUNK_BYTES = 8 * 1024;

/** Drop everything the browser does not consume; serialize the timestamp. */
export function toReadingBroadcast(reading: BroadcastableReading): ReadingBroadcast {
  return {
    metadata: {
      device_id: reading.metadata.device_id,
      type: reading.metadata.type,
    },
    timestamp:
      reading.timestamp instanceof Date
        ? reading.timestamp.toISOString()
        : reading.timestamp,
    value: reading.value,
  };
}

/**
 * Trim and pack readings into chunks whose serialized JSON stays under
 * MAX_BROADCAST_CHUNK_BYTES. Order is preserved across chunk boundaries.
 */
export function chunkReadingsForBroadcast(
  readings: BroadcastableReading[]
): ReadingBroadcast[][] {
  const chunks: ReadingBroadcast[][] = [];
  let current: ReadingBroadcast[] = [];
  let currentBytes = 2; // "[]"

  for (const reading of readings) {
    const item = toReadingBroadcast(reading);
    const itemBytes = JSON.stringify(item).length + 1; // trailing comma
    if (current.length > 0 && currentBytes + itemBytes > MAX_BROADCAST_CHUNK_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
