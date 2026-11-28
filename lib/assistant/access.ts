import { clerkClient } from '@clerk/nextjs/server';
import { isAllowedOrgSlug, isDemoCaller, requireOrgMembership } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

export interface DatasetScope {
  readonly sessionId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly datasetId: string;
  readonly asOf: string;
  readonly policyVersion: string;
}

const POLICY_VERSION = 'assistant-pilot-v1';

function accessDenied(): ApiError {
  return ApiError.forbidden('Assistant access denied');
}

function accessUnavailable(): ApiError {
  return ApiError.serviceUnavailable('Assistant access is unavailable');
}

function readPilotConfig() {
  const orgId = process.env.ASSISTANT_ALLOWED_ORG_ID;
  const datasetId = process.env.ASSISTANT_DATASET_ID?.trim();
  const allowedUserIds = (process.env.ASSISTANT_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map(userId => userId.trim())
    .filter(Boolean);

  if (
    process.env.ASSISTANT_ENABLED !== 'true' ||
    !orgId?.trim() ||
    !datasetId ||
    !allowedUserIds.length
  )
    throw accessUnavailable();

  return { orgId, datasetId, allowedUserIds };
}

async function readSession() {
  try {
    return await requireOrgMembership();
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) throw ApiError.unauthorized();
    if (error instanceof ApiError && error.statusCode === 403) throw accessDenied();
    throw accessUnavailable();
  }
}

async function requirePilotIdentity(): Promise<Omit<DatasetScope, 'asOf'>> {
  const { orgId, datasetId, allowedUserIds } = readPilotConfig();
  const session = await readSession();

  if (isDemoCaller(session) || !session.sessionId) throw ApiError.unauthorized();
  if (session.orgId !== orgId || !allowedUserIds.includes(session.userId)) throw accessDenied();

  return {
    sessionId: session.sessionId,
    userId: session.userId,
    orgId,
    datasetId,
    policyVersion: POLICY_VERSION,
  };
}

async function requireLiveAccess({
  orgId,
  userId,
  sessionId,
}: Pick<DatasetScope, 'orgId' | 'userId' | 'sessionId'>) {
  // Request claims can outlive sign-out, an organization rename, or a change in membership.
  const lookup = async () => {
    const client = await clerkClient();
    return Promise.all([
      client.sessions.getSession(sessionId),
      client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        userId: [userId],
        limit: 1,
      }),
    ]);
  };
  const [session, result] = await lookup().catch(() => {
    throw accessUnavailable();
  });
  if (!Array.isArray(result?.data)) throw accessUnavailable();

  const [membership] = result.data;
  if (
    session?.id !== sessionId ||
    session.userId !== userId ||
    session.status !== 'active' ||
    result.data.length !== 1 ||
    membership?.organization?.id !== orgId ||
    !isAllowedOrgSlug(membership.organization.slug) ||
    membership?.publicUserData?.userId !== userId ||
    (membership.role !== 'org:member' && membership.role !== 'org:admin')
  )
    throw accessDenied();
}

export async function requireAssistantContext(): Promise<DatasetScope> {
  const identity = await requirePilotIdentity();
  await requireLiveAccess(identity);
  return Object.freeze({ ...identity, asOf: new Date().toISOString() });
}

export async function reauthorizeAssistant(scope: DatasetScope): Promise<void> {
  const current = await requirePilotIdentity().catch((error: unknown) => {
    if (error instanceof ApiError && error.statusCode === 401) throw accessDenied();
    throw error;
  });

  if (
    current.sessionId !== scope.sessionId ||
    current.userId !== scope.userId ||
    current.orgId !== scope.orgId ||
    current.datasetId !== scope.datasetId ||
    current.policyVersion !== scope.policyVersion
  )
    throw accessDenied();

  await requireLiveAccess(current);
}
