import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'postgres://x');
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-thirty-two-chars-min-aaaaaa');
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
});

describe('connectors/oauth-state', () => {
  it('signOAuthState → verifyOAuthState round-trips the payload', async () => {
    const { signOAuthState, verifyOAuthState } = await import('@/lib/connectors/oauth-state');
    const signed = signOAuthState({ workspaceId: 'ws-1', databaseId: 'db-1' });
    const verified = verifyOAuthState(signed);
    expect(verified?.workspaceId).toBe('ws-1');
    expect(verified?.databaseId).toBe('db-1');
    expect(typeof verified?.csrf).toBe('string');
    expect(verified?.csrf.length).toBeGreaterThan(8);
  });

  it('verifyOAuthState rejects a tampered signature', async () => {
    const { signOAuthState, verifyOAuthState } = await import('@/lib/connectors/oauth-state');
    const signed = signOAuthState({ workspaceId: 'ws-1', databaseId: 'db-1' });
    const [body, sig] = signed.split('.');
    if (!sig) throw new Error('signed value missing signature segment');
    // Deterministic mutation: flip the first byte to a value the original
    // definitely was not. Replacing the LAST 2 chars with 'aa' was probabilistic
    // — when the original sig already ended in 'aa' (~1/4096 base64url
    // suffixes) the "tamper" was a no-op and the test fooled itself.
    const firstChar = sig.charAt(0);
    const tamperedFirst = firstChar === 'A' ? 'B' : 'A';
    const bad = `${body}.${tamperedFirst}${sig.slice(1)}`;
    expect(verifyOAuthState(bad)).toBeNull();
  });

  it('verifyOAuthState rejects garbage', async () => {
    const { verifyOAuthState } = await import('@/lib/connectors/oauth-state');
    expect(verifyOAuthState('')).toBeNull();
    expect(verifyOAuthState('no-dot')).toBeNull();
    expect(verifyOAuthState('not-base64.not-base64')).toBeNull();
  });

  it('verifyOAuthState rejects a payload missing required fields', async () => {
    const { verifyOAuthState } = await import('@/lib/connectors/oauth-state');
    // Build a properly signed blob whose JSON lacks `databaseId`.
    const { createHmac } = await import('node:crypto');
    const json = Buffer.from(JSON.stringify({ workspaceId: 'w', csrf: 'c' }), 'utf8');
    const sig = createHmac('sha256', Buffer.from(`oauth-state:${process.env.AUTH_SECRET}`, 'utf8'))
      .update(json)
      .digest();
    const raw = `${json.toString('base64url')}.${sig.toString('base64url')}`;
    expect(verifyOAuthState(raw)).toBeNull();
  });
});
