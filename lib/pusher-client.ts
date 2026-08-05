import Pusher from 'pusher-js';

/**
 * Endpoint pusher-js posts to before it will join a `private-` channel.
 *
 * Exported so the route handler and its tests can agree on the path with the
 * client that calls it. See `app/api/pusher/auth/route.ts`.
 */
export const PUSHER_AUTH_ENDPOINT = '/api/pusher/auth';

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
    // Required for the private alert channel. `transport: 'ajax'` makes pusher-js
    // POST socket_id/channel_name as a form body to the endpoint below and send
    // the browser's cookies with it, which is what lets the route identify the
    // caller through Clerk. Without this block a `private-` subscription fails
    // immediately with a subscription_error and no alert ever arrives.
    channelAuthorization: {
      endpoint: PUSHER_AUTH_ENDPOINT,
      transport: 'ajax',
    },
  });

  return pusherInstance;
}
