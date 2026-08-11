/** Batch size chosen to keep GET URLs comfortably under proxy limits. */
const BATCH_SIZE = 50;

export interface LatestReading {
  _id: string; // device_id
  value: number;
  timestamp: string;
  type: string;
}

/**
 * Latest reading per device, fetched in batches of 50 ids per request so a
 * full-fleet call does not overflow URL length limits.
 */
export async function fetchLatestReadingsBatched(
  deviceIds: string[]
): Promise<Record<string, LatestReading>> {
  const allReadings: Record<string, LatestReading> = {};

  for (let i = 0; i < deviceIds.length; i += BATCH_SIZE) {
    const batch = deviceIds.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams();
    batch.forEach(id => params.append('device_ids', id));

    const res = await fetch(`/api/v2/readings/latest?${params.toString()}`);
    const data = await res.json();

    if (data.success && data.data?.readings)
      data.data.readings.forEach(
        (r: { device_id: string; value: number; timestamp: string; type: string }) => {
          allReadings[r.device_id] = {
            _id: r.device_id,
            value: r.value,
            timestamp: r.timestamp,
            type: r.type,
          };
        }
      );
  }

  return allReadings;
}
