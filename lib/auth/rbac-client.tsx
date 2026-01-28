'use client';

import { useAuth } from '@clerk/nextjs';

export type RbacRole = 'org:admin' | 'org:member';

interface RbacState {
  isLoaded: boolean;
  isSignedIn: boolean;
  orgRole: RbacRole | null;
  orgSlug: string | null;
  isAdmin: boolean;
  isMember: boolean;
}

const DEFAULT_ALLOWED_ORG_SLUGS = ['users'];

function getAllowedOrgSlugs(): string[] {
  if (typeof process === 'undefined') return DEFAULT_ALLOWED_ORG_SLUGS;
  const raw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS;
  if (!raw) return DEFAULT_ALLOWED_ORG_SLUGS;
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.toLowerCase());
}

export function useRbac(): RbacState {
  const { isLoaded, isSignedIn, orgRole, orgSlug } = useAuth();
  const allowedOrgs = getAllowedOrgSlugs();
  const normalizedSlug = orgSlug?.toLowerCase() ?? null;
  const inAllowedOrg =
    !allowedOrgs.length || (normalizedSlug ? allowedOrgs.includes(normalizedSlug) : false);

  const normalizedRole =
    orgRole === 'org:admin' || orgRole === 'org:member' ? (orgRole as RbacRole) : null;

  const isAdmin = Boolean(
    isLoaded && isSignedIn && inAllowedOrg && normalizedRole === 'org:admin'
  );
  const isMember = Boolean(
    isLoaded && isSignedIn && inAllowedOrg && normalizedRole === 'org:member'
  );

  return {
    isLoaded,
    isSignedIn: isSignedIn ?? false,
    orgRole: inAllowedOrg ? normalizedRole : null,
    orgSlug: inAllowedOrg ? orgSlug ?? null : null,
    isAdmin,
    isMember,
  };
}
