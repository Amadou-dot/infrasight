/**
 * Pusher Private Channel Authorization
 *
 * POST /api/pusher/auth
 *
 * pusher-js calls this before it will join a `private-` channel. It is not a
 * v2 API endpoint and it is not something a human ever calls; it exists purely
 * to answer "may this socket join this channel?".
 *
 * ## Deliberate departure from the repo's response convention
 *
 * Every other route in this codebase answers with `jsonSuccess()` /
 * `jsonPaginated()` — the `{ success, data, timestamp }` envelope. This one
 * MUST NOT. pusher-js parses the body itself and looks for a bare
 * `{ auth: "<key>:<signature>" }` object; anything wrapped around that is read
 * as a malformed response and the subscription fails silently, with no alert
 * ever reaching the browser and nothing in the server logs to explain it. The
 * shape is dictated by Pusher's protocol, so `pusherServer.authorizeChannel()`
 * output is returned verbatim.
 *
 * Errors are the normal envelope, because those are ours to shape and
 * `withErrorHandler` produces them; pusher-js only inspects the status code on
 * a failure, and a non-2xx of any shape means "rejected".
 *
 * ## Why this is not in `proxy.ts`'s public route list
 *
 * It must stay protected. `proxy.ts`'s matcher already covers `/(api|trpc)(.*)`
 * and the path is absent from `isPublicRoute`, so a signed-out caller is turned
 * away by the middleware before this handler runs. Adding it to the public list
 * would reopen exactly the hole the private channel closes.
 *
 * ## What the handler itself actually enforces
 *
 * `requireOrgMembership()` is not, on its own, a second barrier against an
 * anonymous caller. Under `DEMO_MODE=true`, `getAuthContext()` hands an
 * anonymous visitor a synthetic `org:member` context (see `lib/auth/index.ts`),
 * so the call SUCCEEDS and would otherwise reach `authorizeChannel()`. The
 * only thing refusing that request today is `proxy.ts`, whose demo bypass is
 * limited to GET/HEAD — one condition, in one file, guarding the route whose
 * whole purpose is to be the second line of defense.
 *
 * So the handler rejects a demo caller explicitly, below. Between them:
 *   - `requireOrgMembership()` covers signed-in callers — 401 when there is no
 *     session and demo mode is off, 403 outside the allowed organization.
 *   - the `isDemoCaller()` check covers the anonymous demo visitor, whatever
 *     the middleware did or did not do with the request.
 *
 * A demo deployment therefore serves the app read-only and simply has no alert
 * stream, which is the intended trade: `private-alerts` carries rule names,
 * device ids, trigger values and resolver identities, and Pusher envelopes do
 * not pass through `lib/alerting/redact.ts` — that module only covers the
 * alert / alert-rule GET responses.
 */

import type { NextRequest } from 'next/server';
import { pusherServer } from '@/lib/pusher';
import { ALERT_CHANNEL } from '@/lib/pusher-channels';
import { requireOrgMembership, isDemoCaller } from '@/lib/auth';
import { withErrorHandler, ApiError } from '@/lib/errors';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';

/**
 * Channels this endpoint will ever sign.
 *
 * An allow-list, not a prefix test. Signing whatever channel name the caller
 * asks for would make this endpoint a generic signing oracle: any org member
 * could mint an authorization for a channel they were never meant to read, and
 * a future `private-tenant-<id>` channel would be readable by every member the
 * day it was added. Membership grants access to the alert feed and nothing else.
 */
const AUTHORIZABLE_CHANNELS: ReadonlySet<string> = new Set([ALERT_CHANNEL]);

/** Pusher socket ids are `<numeric>.<numeric>`. */
const SOCKET_ID_PATTERN = /^\d+\.\d+$/;

interface AuthParams {
  socketId: string;
  channelName: string;
}

/**
 * Reads socket_id/channel_name off the request.
 *
 * pusher-js's `ajax` transport posts a urlencoded form. JSON is accepted too so
 * a hand-written client (or a test) is not forced to build a form body.
 */
async function readAuthParams(request: NextRequest): Promise<AuthParams> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      socketId: typeof body.socket_id === 'string' ? body.socket_id : '',
      channelName: typeof body.channel_name === 'string' ? body.channel_name : '',
    };
  }

  const params = new URLSearchParams(await request.text());
  return {
    socketId: params.get('socket_id') ?? '',
    channelName: params.get('channel_name') ?? '',
  };
}

export async function POST(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Throws 401 when signed out, 403 when outside the allowed organization.
    // It does NOT reject an anonymous caller under DEMO_MODE — see the
    // "what the handler itself actually enforces" note at the top of the file.
    const authContext = await requireOrgMembership();

    // The anonymous demo visitor. Never signed a private channel: `org:member`
    // here is synthetic, granted so a stranger can browse read-only, and it
    // must not be readable as consent to receive the live alert feed.
    if (isDemoCaller(authContext)) {
      logger.warn('Rejected Pusher authorization for an anonymous demo caller');
      throw ApiError.forbidden('Demo access cannot subscribe to private channels');
    }

    const { socketId, channelName } = await readAuthParams(request);

    if (!SOCKET_ID_PATTERN.test(socketId))
      throw ApiError.badRequest('A valid socket_id is required');

    if (!AUTHORIZABLE_CHANNELS.has(channelName)) {
      logger.warn('Rejected Pusher authorization for a non-authorizable channel', {
        channelName,
        userId: authContext.userId,
      });
      throw ApiError.forbidden(`Channel '${channelName}' cannot be authorized`);
    }

    // Raw Pusher payload — see the "deliberate departure" note at the top of
    // this file. Do NOT wrap this in jsonSuccess().
    const authResponse = pusherServer.authorizeChannel(socketId, channelName);

    const duration = timer.elapsed();
    recordRequest('POST', '/api/pusher/auth', 200, duration);
    logger.debug('Pusher channel authorized', { channelName, duration });

    return Response.json(authResponse);
  })();
}
