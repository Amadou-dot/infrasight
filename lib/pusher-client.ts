import Pusher from 'pusher-js';

// Singleton Pusher client instance for reuse across components
let pusherInstance: Pusher | null = null;

export function getPusherClient(): Pusher {
  // Validate environment variables
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!key || !cluster)
    throw new Error(
      'Missing required Pusher environment variables. Please ensure NEXT_PUBLIC_PUSHER_KEY and NEXT_PUBLIC_PUSHER_CLUSTER are set in .env.local'
    );

  // Return existing instance if available
  if (pusherInstance) return pusherInstance;

  // Create new instance
  pusherInstance = new Pusher(key, {
    cluster: cluster,
  });

  return pusherInstance;
}
