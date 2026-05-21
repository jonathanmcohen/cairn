import { describe, expect, it } from 'vitest';
import { mintCollabToken, verifyCollabToken } from '@/lib/collab/token';

const SECRET = 'x'.repeat(32);
const base = { userId: 'u-1', pageId: 'p-1', role: 'editor' as const };

describe('mintCollabToken / verifyCollabToken', () => {
  it('round-trips claims', () => {
    const token = mintCollabToken({ ...base, secret: SECRET });
    const claims = verifyCollabToken(token, SECRET);
    expect(claims).toMatchObject({ userId: 'u-1', pageId: 'p-1', role: 'editor' });
    expect(typeof claims?.exp).toBe('number');
  });

  it('defaults exp to ~5 minutes ahead', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = mintCollabToken({ ...base, secret: SECRET });
    const claims = verifyCollabToken(token, SECRET);
    expect(claims?.exp).toBeGreaterThan(now + 4 * 60);
    expect(claims?.exp).toBeLessThanOrEqual(now + 6 * 60);
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintCollabToken({ ...base, secret: SECRET });
    expect(verifyCollabToken(token, 'y'.repeat(32))).toBeNull();
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const token = mintCollabToken({ ...base, secret: SECRET });
    const [payload, sig] = token.split('.');
    // flip the role in the payload, keep the old signature
    const evil = Buffer.from(
      JSON.stringify({ ...base, role: 'owner', exp: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifyCollabToken(`${evil}.${sig}`, SECRET)).toBeNull();
    expect(payload).not.toBe(evil); // sanity
  });

  it('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = mintCollabToken({ ...base, secret: SECRET, expiresAt: past });
    expect(verifyCollabToken(token, SECRET)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifyCollabToken('not-a-token', SECRET)).toBeNull();
    expect(verifyCollabToken('', SECRET)).toBeNull();
    expect(verifyCollabToken('a.b.c', SECRET)).toBeNull();
  });
});
