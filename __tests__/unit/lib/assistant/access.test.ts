import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { reauthorizeAssistant, requireAssistantContext } from '@/lib/assistant/access';

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
  clerkClient: jest.fn(),
}));

const mockAuth = jest.mocked(auth);
const mockCurrentUser = jest.mocked(currentUser);
const mockMembershipLookup = jest.fn();
const mockSessionLookup = jest.fn();
type ClerkUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const pilotSession = {
  sessionId: 'sess_pilot',
  userId: 'user_pilot',
  orgId: 'org_pilot',
  orgSlug: 'users',
  orgRole: 'org:member',
};

const pilotMembership = {
  organization: { id: pilotSession.orgId, slug: pilotSession.orgSlug },
  publicUserData: { userId: pilotSession.userId },
  role: 'org:member',
};

const liveSession = { id: pilotSession.sessionId, userId: pilotSession.userId, status: 'active' };

function mockSession(session: Partial<{ [K in keyof typeof pilotSession]: string | null }> = {}) {
  const claims = { ...pilotSession, ...session };
  mockAuth.mockResolvedValue(claims as Awaited<ReturnType<typeof auth>>);
  if (!claims.userId) {
    mockCurrentUser.mockResolvedValue(null);
    return;
  }

  const user: Pick<
    ClerkUser,
    'id' | 'fullName' | 'firstName' | 'lastName' | 'primaryEmailAddressId' | 'emailAddresses'
  > = {
    id: claims.userId,
    fullName: null,
    firstName: null,
    lastName: null,
    primaryEmailAddressId: null,
    emailAddresses: [],
  };
  mockCurrentUser.mockResolvedValue(user as ClerkUser);
}

beforeEach(() => {
  jest.replaceProperty(process, 'env', {
    ...process.env,
    ASSISTANT_ENABLED: 'true',
    ASSISTANT_ALLOWED_ORG_ID: 'org_pilot',
    ASSISTANT_ALLOWED_USER_IDS: 'user_other, user_pilot',
    ASSISTANT_DATASET_ID: 'pilot-dataset',
    CLERK_ALLOWED_ORG_SLUGS: 'users',
    DEMO_MODE: 'false',
  });
  mockSession();
  jest.mocked(clerkClient).mockResolvedValue({
    organizations: { getOrganizationMembershipList: mockMembershipLookup },
    sessions: { getSession: mockSessionLookup },
  } as unknown as Awaited<ReturnType<typeof clerkClient>>);
  mockSessionLookup.mockReset().mockResolvedValue(liveSession);
  mockMembershipLookup.mockReset().mockResolvedValue({ data: [pilotMembership], totalCount: 1 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('requireAssistantContext', () => {
  it.each(['org:member', 'org:admin'])('binds an immutable request scope for %s', async orgRole => {
    mockSession({ orgRole });
    mockMembershipLookup.mockResolvedValueOnce({ data: [{ ...pilotMembership, role: orgRole }] });
    const startedAt = Date.now();
    const scope = await requireAssistantContext();

    expect(scope).toEqual({
      sessionId: 'sess_pilot',
      userId: 'user_pilot',
      orgId: 'org_pilot',
      datasetId: 'pilot-dataset',
      policyVersion: expect.any(String),
      asOf: expect.any(String),
    });
    expect(scope.policyVersion).not.toBe('');
    expect(Object.isFrozen(scope)).toBe(true);
    expect(new Date(scope.asOf).toISOString()).toBe(scope.asOf);
    expect(Date.parse(scope.asOf)).toBeGreaterThanOrEqual(startedAt);
    expect(Date.parse(scope.asOf)).toBeLessThanOrEqual(Date.now());
    expect(mockSessionLookup).toHaveBeenCalledWith('sess_pilot');
    expect(mockMembershipLookup).toHaveBeenCalledWith({
      organizationId: 'org_pilot',
      userId: ['user_pilot'],
      limit: 1,
    });
  });

  it.each(['false', 'TRUE', ' true '])('rejects ASSISTANT_ENABLED=%s', async enabled => {
    process.env.ASSISTANT_ENABLED = enabled;
    await expect(requireAssistantContext()).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each([
    'ASSISTANT_ENABLED',
    'ASSISTANT_ALLOWED_ORG_ID',
    'ASSISTANT_ALLOWED_USER_IDS',
    'ASSISTANT_DATASET_ID',
  ])('rejects missing %s', async setting => {
    delete process.env[setting];
    await expect(requireAssistantContext()).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each([
    ['ASSISTANT_ALLOWED_ORG_ID', '   '],
    ['ASSISTANT_ALLOWED_USER_IDS', ' , , '],
    ['ASSISTANT_DATASET_ID', '   '],
  ])('rejects empty %s', async (setting, value) => {
    process.env[setting] = value;
    await expect(requireAssistantContext()).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each(['false', 'true'])(
    'requires a real signed-in session when demo mode is %s',
    async demo => {
      mockSession({ userId: null, orgId: null, orgSlug: null, orgRole: null });
      process.env.DEMO_MODE = demo;
      process.env.ASSISTANT_ALLOWED_ORG_ID = 'demo';
      process.env.ASSISTANT_ALLOWED_USER_IDS = 'demo';

      await expect(requireAssistantContext()).rejects.toMatchObject({ statusCode: 401 });
    }
  );

  it.each([
    { orgId: 'org_Pilot' },
    { orgId: null },
    { orgId: '' },
    { userId: 'user_pilo' },
    { orgRole: 'org:private-role' },
    { orgSlug: 'restricted-org' },
  ])('forbids a session with mismatched claims %j', async changes => {
    mockSession(changes);

    await expect(requireAssistantContext()).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 403,
      message: 'Assistant access denied',
      metadata: undefined,
    });
    expect(mockMembershipLookup).not.toHaveBeenCalled();
  });

  it('sanitizes a Clerk failure', async () => {
    mockAuth.mockRejectedValueOnce(new Error('Clerk error for org_pilot and user_pilot'));

    await expect(requireAssistantContext()).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 503,
      message: 'Assistant access is unavailable',
      metadata: undefined,
    });
  });

  it.each(
    [
      [],
      [{ ...pilotMembership, organization: { id: 'org_other' } }],
      [{ ...pilotMembership, organization: { id: pilotSession.orgId } }],
      [{ ...pilotMembership, publicUserData: { userId: 'user_other' } }],
      [{ ...pilotMembership, role: 'org:viewer' }],
    ].map(data => ({ data }))
  )('denies when the live result does not authorize the caller %j', async result => {
    mockMembershipLookup.mockResolvedValueOnce(result);
    await expect(requireAssistantContext()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('requires a session ID before contacting Clerk for live access', async () => {
    mockSession({ sessionId: null });
    await expect(requireAssistantContext()).rejects.toMatchObject({ statusCode: 401 });
    expect(mockSessionLookup).not.toHaveBeenCalled();
  });

  it('sanitizes an unavailable session lookup', async () => {
    mockSessionLookup.mockRejectedValueOnce(new Error('private session backend failure'));
    await expect(requireAssistantContext()).rejects.toMatchObject({
      statusCode: 503,
      message: 'Assistant access is unavailable',
    });
  });

  it('fails closed when the membership backend is unavailable', async () => {
    mockMembershipLookup.mockRejectedValueOnce(
      new Error('Clerk error for org_pilot and user_pilot')
    );

    await expect(requireAssistantContext()).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 503,
      message: 'Assistant access is unavailable',
      metadata: undefined,
    });
  });

  it('rejects an unavailable membership list with a sanitized error', async () => {
    mockMembershipLookup.mockResolvedValueOnce({ data: null });

    await expect(requireAssistantContext()).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('reauthorizeAssistant', () => {
  it('keeps the original time bound while evaluating current authorization', async () => {
    const scope = await requireAssistantContext();
    const olderScope = Object.freeze({ ...scope, asOf: '2026-11-23T15:00:00.000Z' });

    await expect(reauthorizeAssistant(olderScope)).resolves.toBeUndefined();
  });

  it.each([
    { sessionId: 'sess_other' },
    { userId: null },
    { userId: 'user_other' },
    { orgId: 'org_other' },
    { orgRole: null },
  ])('forbids a previously issued scope after a session change %j', async session => {
    const scope = await requireAssistantContext();
    mockSession(session);

    await expect(reauthorizeAssistant(scope)).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each([
    { status: 'ended' },
    { status: 'revoked' },
    { id: 'sess_other' },
    { userId: 'user_other' },
  ])('rejects a changed live session with unchanged request claims %j', async changes => {
    const scope = await requireAssistantContext();
    mockSessionLookup.mockResolvedValueOnce({ ...liveSession, ...changes });
    await expect(reauthorizeAssistant(scope)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockSessionLookup).toHaveBeenLastCalledWith(pilotSession.sessionId);
  });

  it('applies the configured allowlist to the live slug after a rename', async () => {
    process.env.CLERK_ALLOWED_ORG_SLUGS = ' USERS, renamed ';
    const scope = await requireAssistantContext();
    const renamed = (slug: string) => ({
      data: [{ ...pilotMembership, organization: { id: scope.orgId, slug } }],
    });
    mockMembershipLookup.mockResolvedValueOnce(renamed('RENAMED'));
    await expect(reauthorizeAssistant(scope)).resolves.toBeUndefined();
    mockMembershipLookup.mockResolvedValueOnce(renamed('outside'));
    await expect(reauthorizeAssistant(scope)).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each([
    ['ASSISTANT_ALLOWED_USER_IDS', 'user_other', 403],
    ['ASSISTANT_ALLOWED_ORG_ID', 'org_other', 403],
    ['ASSISTANT_DATASET_ID', 'different-dataset', 403],
    ['ASSISTANT_ENABLED', 'false', 503],
  ] as const)('rechecks %s before using a scope', async (setting, value, statusCode) => {
    const scope = await requireAssistantContext();
    process.env[setting] = value;

    await expect(reauthorizeAssistant(scope)).rejects.toMatchObject({ statusCode });
  });

  it('forbids a scope issued under a stale policy version', async () => {
    const scope = await requireAssistantContext();
    const staleScope = Object.freeze({ ...scope, policyVersion: 'stale-policy' });

    await expect(reauthorizeAssistant(staleScope)).rejects.toMatchObject({ statusCode: 403 });
  });
});
