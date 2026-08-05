/**
 * Pusher channel names, shared by the server publishers and the browser client.
 *
 * These live in their own dependency-free module on purpose. The obvious home
 * would be `lib/alerting/notify.ts` (server) or `lib/pusher-context.tsx`
 * (browser), but importing either one from the other side of the boundary drags
 * along `lib/pusher` (which throws unless the server-only PUSHER_SECRET is set)
 * or `pusher-js`. A module containing nothing but string constants can be
 * imported from a route handler, a client component, and a test alike.
 */

/**
 * Public channel carrying sensor readings.
 *
 * Deliberately NOT `private-`. `app/api/v2/cron/simulate/route.ts` publishes
 * readings here, and readings were already public before the alerting
 * subsystem existed. Renaming it would silently break that producer.
 */
export const READINGS_CHANNEL = 'InfraSight';

/**
 * Private channel carrying alert envelopes.
 *
 * The `private-` prefix is load-bearing, not cosmetic: it is what makes
 * pusher-js call `channelAuthorization.endpoint` (`/api/pusher/auth`) before
 * subscribing. On a public channel, anyone holding `NEXT_PUBLIC_PUSHER_KEY` —
 * which is readable in the JS bundle by design — could stream the whole
 * fleet's alert feed, including rule names, device ids and trigger values.
 */
export const ALERT_CHANNEL = 'private-alerts';
