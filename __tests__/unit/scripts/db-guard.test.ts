/**
 * Destructive Script Guard Tests
 *
 * The seed script wipes devices_v2 and readings_v2 unconditionally. Since pnpm seed
 * loads .env.local, whose MONGODB_URI points at the Atlas cluster serving the public
 * demo, an accidental run destroys production data. These tests pin the guard that
 * prevents it.
 */

import { isLocalDatabase, assertSafeToWipe, describeTarget } from '@/scripts/v2/db-guard';

describe('isLocalDatabase', () => {
  it('should treat loopback hosts as local', () => {
    expect(isLocalDatabase('mongodb://localhost:27017/infrasight')).toBe(true);
    expect(isLocalDatabase('mongodb://127.0.0.1:27017/infrasight')).toBe(true);
    expect(isLocalDatabase('mongodb://[::1]:27017/infrasight')).toBe(true);
  });

  it('should treat a hosted cluster as remote', () => {
    expect(isLocalDatabase('mongodb+srv://nodecluster.k9ngn2m.mongodb.net/infrasight')).toBe(
      false
    );
    expect(isLocalDatabase('mongodb://db.internal.example.com:27017/infrasight')).toBe(false);
  });

  it('should not be fooled by credentials containing the word localhost', () => {
    // The host is remote; "localhost" only appears in the password.
    expect(isLocalDatabase('mongodb://admin:localhost@cluster.mongodb.net/infrasight')).toBe(
      false
    );
  });

  it('should treat an unparseable URI as remote', () => {
    // Fail closed: if we cannot tell what we are pointed at, refuse to wipe it.
    expect(isLocalDatabase('not-a-uri')).toBe(false);
    expect(isLocalDatabase('')).toBe(false);
  });
});

describe('assertSafeToWipe', () => {
  const REMOTE = 'mongodb+srv://user:secret@nodecluster.k9ngn2m.mongodb.net/infrasight';
  const LOCAL = 'mongodb://localhost:27017/infrasight';

  it('should refuse to wipe a remote database without --force', () => {
    expect(() => assertSafeToWipe(REMOTE, { force: false })).toThrow(/refusing/i);
  });

  it('should allow a remote wipe when --force is given', () => {
    expect(() => assertSafeToWipe(REMOTE, { force: true })).not.toThrow();
  });

  it('should allow a local wipe without --force', () => {
    expect(() => assertSafeToWipe(LOCAL, { force: false })).not.toThrow();
  });

  it('should name the host so the operator can see what they nearly destroyed', () => {
    expect(() => assertSafeToWipe(REMOTE, { force: false })).toThrow(
      /nodecluster\.k9ngn2m\.mongodb\.net/
    );
  });

  it('should never leak credentials in the error message', () => {
    let message = '';
    try {
      assertSafeToWipe(REMOTE, { force: false });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain('secret');
    expect(message).not.toContain('user');
  });
});

describe('describeTarget', () => {
  it('should redact credentials so the target can be logged safely', () => {
    const described = describeTarget('mongodb+srv://user:secret@cluster.mongodb.net/infrasight');

    expect(described).toContain('cluster.mongodb.net');
    expect(described).not.toContain('secret');
  });
});
