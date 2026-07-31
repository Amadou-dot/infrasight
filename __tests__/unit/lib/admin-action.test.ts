/**
 * useAdminAction Hook Tests
 *
 * Governs whether an admin-gated control is rendered, and whether it is rendered
 * disabled so read-only demo visitors can see that the feature exists.
 */

import { useAuth } from '@clerk/nextjs';
import { useAdminAction } from '@/lib/auth/rbac-client';

jest.mock('@clerk/nextjs', () => ({
  useAuth: jest.fn(),
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

/** Shape the hook reads; the full Clerk return type is much wider. */
type AuthState = Pick<ReturnType<typeof useAuth>, 'isLoaded' | 'isSignedIn' | 'orgRole' | 'orgSlug'>;

const setAuth = (state: AuthState) =>
  mockedUseAuth.mockReturnValue(state as ReturnType<typeof useAuth>);

describe('useAdminAction', () => {
  const originalDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  });

  afterEach(() => {
    if (originalDemoMode === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DEMO_MODE = originalDemoMode;
  });

  function mockAdmin() {
    setAuth({
      isLoaded: true,
      isSignedIn: true,
      orgRole: 'org:admin',
      orgSlug: 'users',
    });
  }

  function mockMember() {
    setAuth({
      isLoaded: true,
      isSignedIn: true,
      orgRole: 'org:member',
      orgSlug: 'users',
    });
  }

  function mockAnonymous() {
    setAuth({
      isLoaded: true,
      isSignedIn: false,
      orgRole: null,
      orgSlug: null,
    });
  }

  it('should render the control enabled for an admin', () => {
    mockAdmin();

    const action = useAdminAction();

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(false);
    expect(action.tooltip).toBeUndefined();
  });

  it('should render the control disabled for an anonymous demo visitor', () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    mockAnonymous();

    const action = useAdminAction();

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(true);
    expect(action.tooltip).toMatch(/read-only demo/i);
  });

  it('should hide the control from a signed-in member when not in demo mode', () => {
    mockMember();

    const action = useAdminAction();

    expect(action.visible).toBe(false);
  });

  it('should keep the control enabled for a real admin even while demo mode is on', () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    mockAdmin();

    const action = useAdminAction();

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(false);
  });

  it('should hide the control from an anonymous visitor when demo mode is off', () => {
    mockAnonymous();

    const action = useAdminAction();

    expect(action.visible).toBe(false);
  });
});
