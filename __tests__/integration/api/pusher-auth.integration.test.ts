/**
 * Pusher Channel Authorization Integration Tests
 *
 * This route is the whole reason the alert channel can be `private-`. If it is
 * wrong, one of two things happens and neither is loud:
 *
 *   - too permissive: it becomes a signing oracle. Anyone who can reach it gets
 *     an authorization for any channel they name, and the private prefix buys
 *     nothing. The `rejects a channel other than the alert channel` rows below
 *     are the ones that catch that.
 *
 *   - wrong response shape: pusher-js parses the body itself and wants Pusher's
 *     bare `{ auth: "<key>:<sig>" }`. Wrapping it in this repo's
 *     `jsonSuccess()` envelope breaks subscription silently — 200 OK, no error
 *     anywhere, no alert ever arrives. Hence the explicit "not the envelope"
 *     assertions.
 *
 * `pusherServer` is NOT mocked. `authorizeChannel` is a local HMAC over the
 * socket id and channel name — no network — so using the real thing asserts the
 * real payload shape rather than whatever a mock was told to return.
 */

import { NextRequest } from 'next/server';
import { POST as authorizeChannel } from '@/app/api/pusher/auth/route';
import { ALERT_CHANNEL, READINGS_CHANNEL } from '@/lib/pusher-channels';
import { auth, currentUser } from '@clerk/nextjs/server';

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
}));

const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockCurrentUser = currentUser as jest.MockedFunction<typeof currentUser>;

const SOCKET_ID = '123456.7891011';

function mockSignedIn(role = 'org:admin', orgSlug = 'users') {
  mockAuth.mockResolvedValue({
    userId: 'user_test123',
    orgId: 'org_test',
    orgSlug,
    orgRole: role,
  } as Awaited<ReturnType<typeof auth>>);
  mockCurrentUser.mockResolvedValue({
    id: 'user_test123',
    fullName: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    primaryEmailAddressId: 'email_1',
    emailAddresses: [{ id: 'email_1', emailAddress: 'test@example.com' }],
  } as Awaited<ReturnType<typeof currentUser>>);
}

function mockSignedOut() {
  mockAuth.mockResolvedValue({
    userId: null,
    orgId: null,
    orgSlug: null,
    orgRole: null,
  } as Awaited<ReturnType<typeof auth>>);
  mockCurrentUser.mockResolvedValue(null);
}

/** Builds the form-encoded POST pusher-js's `ajax` transport actually sends. */
function authRequest(channelName: string, socketId: string = SOCKET_ID): NextRequest {
  return new NextRequest('http://localhost:3000/api/pusher/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ socket_id: socketId, channel_name: channelName }).toString(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // DEMO_MODE would hand an anonymous caller a synthetic member context.
  delete process.env.DEMO_MODE;
});

describe('POST /api/pusher/auth', () => {
  describe('authorized callers', () => {
    it('authorizes an org member for the alert channel', async () => {
      mockSignedIn('org:member');

      const response = await authorizeChannel(authRequest(ALERT_CHANNEL));
      const body = await response.json();

      expect(response.status).toBe(200);
      // Pusher's own shape: "<app key>:<hex signature>".
      expect(typeof body.auth).toBe('string');
      expect(body.auth).toMatch(/^test-key:[a-f0-9]+$/);
    });

    it('authorizes an org admin too — reading alerts is not an admin action', async () => {
      mockSignedIn('org:admin');

      const response = await authorizeChannel(authRequest(ALERT_CHANNEL));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(typeof body.auth).toBe('string');
    });

    it('returns the RAW Pusher payload, not this repo’s success envelope', async () => {
      mockSignedIn('org:member');

      const response = await authorizeChannel(authRequest(ALERT_CHANNEL));
      const body = await response.json();

      // pusher-js reads `auth` off the top level. `{ success, data: { auth } }`
      // is a 200 that breaks subscription with no error anywhere.
      expect(body).not.toHaveProperty('success');
      expect(body).not.toHaveProperty('data');
      expect(body).not.toHaveProperty('timestamp');
      expect(Object.keys(body)).toContain('auth');
    });

    it('accepts a JSON body as well as a form body', async () => {
      mockSignedIn('org:member');

      const request = new NextRequest('http://localhost:3000/api/pusher/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socket_id: SOCKET_ID, channel_name: ALERT_CHANNEL }),
      });
      const response = await authorizeChannel(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(typeof body.auth).toBe('string');
    });
  });

  describe('rejected callers', () => {
    it('rejects a signed-out caller with 401', async () => {
      mockSignedOut();

      const response = await authorizeChannel(authRequest(ALERT_CHANNEL));
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body).not.toHaveProperty('auth');
    });

    it('rejects a signed-in user outside the allowed organization with 403', async () => {
      mockSignedIn('org:member', 'some-other-org');

      const response = await authorizeChannel(authRequest(ALERT_CHANNEL));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body).not.toHaveProperty('auth');
    });

    it('rejects a signed-in user with no organization at all with 403', async () => {
      // Double cast: Clerk's signed-in auth object type requires a dozen
      // session fields the route never reads, and a signed-in-but-org-less
      // session does not structurally overlap either branch of the union.
      mockAuth.mockResolvedValue({
        userId: 'user_test123',
        orgId: null,
        orgSlug: null,
        orgRole: null,
      } as unknown as Awaited<ReturnType<typeof auth>>);
      mockCurrentUser.mockResolvedValue({
        id: 'user_test123',
        fullName: 'Test User',
        firstName: 'Test',
        lastName: 'User',
        primaryEmailAddressId: 'email_1',
        emailAddresses: [{ id: 'email_1', emailAddress: 'test@example.com' }],
      } as Awaited<ReturnType<typeof currentUser>>);

      const response = await authorizeChannel(authRequest(ALERT_CHANNEL));

      expect(response.status).toBe(403);
    });
  });

  // ==========================================================================
  // DEMO MODE
  // ==========================================================================
  //
  // Every other row in this file runs with DEMO_MODE deleted, which is exactly
  // why this block is needed: under DEMO_MODE=true `getAuthContext()` hands an
  // anonymous visitor a synthetic `org:member` context, so
  // `requireOrgMembership()` SUCCEEDS for a caller with no session at all. The
  // "rejects a signed-out caller with 401" row above passes only because the
  // env var is unset there.
  //
  // Nothing inside this handler used to notice. The single thing refusing the
  // request was `proxy.ts`, whose demo bypass is limited to GET/HEAD — and
  // middleware behaviour is not exercised by these tests at all. A route whose
  // entire job is to be the second line of defense had one line of defense.
  describe('demo mode', () => {
    beforeEach(() => {
      process.env.DEMO_MODE = 'true';
    });

    afterEach(() => {
      delete process.env.DEMO_MODE;
    });

    it('refuses to sign the alert channel for an anonymous demo visitor', async () => {
      mockSignedOut();

      const response = await authorizeChannel(authRequest(ALERT_CHANNEL));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      // The signature is what must never be minted here: it is what would let
      // an anonymous visitor join `private-alerts` and receive rule names,
      // device ids, trigger values and resolver identities.
      expect(body).not.toHaveProperty('auth');
    });

    it('refuses on identity alone, before the socket id is even parsed', async () => {
      mockSignedOut();

      // A malformed socket id must not be what saves us — the rejection has to
      // be the demo check, so this stays 403 rather than becoming a 400.
      const response = await authorizeChannel(authRequest(ALERT_CHANNEL, 'not-a-socket'));

      expect(response.status).toBe(403);
    });

    it('still authorizes a genuinely signed-in member while demo mode is on', async () => {
      // The rejection is keyed on the demo sentinel, not on the env var: a
      // demo deployment must keep working for real users who sign in.
      mockSignedIn('org:member');

      const response = await authorizeChannel(authRequest(ALERT_CHANNEL));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(typeof body.auth).toBe('string');
    });
  });

  describe('channel allow-list', () => {
    // A member IS allowed on the alert channel, so every row here isolates the
    // channel check: same caller, different channel name.
    beforeEach(() => mockSignedIn('org:member'));

    it.each([
      ['the public readings channel', READINGS_CHANNEL],
      ['an arbitrary private channel', 'private-somebody-elses-tenant'],
      ['a presence channel', 'presence-alerts'],
      ['a look-alike prefix', `${ALERT_CHANNEL}-admin`],
      ['an empty channel name', ''],
    ])('rejects %s', async (_label, channelName) => {
      const response = await authorizeChannel(authRequest(channelName));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      // The signature is the thing that must never leak for an unlisted channel.
      expect(body).not.toHaveProperty('auth');
    });

    it('rejects even an admin asking for a channel outside the list', async () => {
      mockSignedIn('org:admin');

      const response = await authorizeChannel(authRequest('private-anything-else'));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).not.toHaveProperty('auth');
    });
  });

  describe('malformed requests', () => {
    beforeEach(() => mockSignedIn('org:member'));

    it.each([
      ['a missing socket id', ''],
      ['a non-numeric socket id', 'not-a-socket'],
      ['a partial socket id', '123456'],
    ])('rejects %s with 400', async (_label, socketId) => {
      const response = await authorizeChannel(authRequest(ALERT_CHANNEL, socketId));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).not.toHaveProperty('auth');
    });
  });
});
