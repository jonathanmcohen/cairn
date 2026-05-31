import { describe, expect, it } from 'vitest';
import { authorizeCollab } from '@/lib/collab/authorize';
import { mintCollabToken } from '@/lib/collab/token';

// The collab token is an HMAC-signed `<payloadB64>.<sig>` minted by
// mintCollabToken (src/lib/collab/token.ts), NOT a JOSE/JWT. authorizeCollab
// returns { ok: false, reason } on any rejection (forged/expired/wrong-page)
// rather than throwing; the contract under test is that those are never
// authorized and that the rejection NEVER carries the secret (v0.9.6 #137 added
// a typed reason + decoded pageId/exp for operator logs — secret stays out).
const SECRET = 'y'.repeat(32);

/** A rejection must never echo the secret in any field. */
function assertNoSecretLeak(result: unknown): void {
  expect(JSON.stringify(result)).not.toContain(SECRET);
}

describe('collab token authorization', () => {
  it('valid token for the right page is accepted', () => {
    const token = mintCollabToken({
      userId: 'user-1',
      pageId: 'page-1',
      role: 'editor',
      secret: SECRET,
    });
    expect(authorizeCollab(token, 'page-1', SECRET)).toMatchObject({
      ok: true,
      pageId: 'page-1',
      role: 'editor',
    });
  });

  it('forged signature is rejected', () => {
    // Minted under a different secret → signature will not verify.
    const forged = mintCollabToken({
      userId: 'user-1',
      pageId: 'page-1',
      role: 'editor',
      secret: 'WRONG-SECRET'.padEnd(32, 'z'),
    });
    const result = authorizeCollab(forged, 'page-1', SECRET);
    expect(result).toMatchObject({ ok: false, reason: 'bad-sig' });
    assertNoSecretLeak(result);
  });

  it('expired token is rejected', () => {
    const token = mintCollabToken({
      userId: 'user-1',
      pageId: 'page-1',
      role: 'editor',
      secret: SECRET,
      expiresAt: Math.floor(Date.now() / 1000) - 10, // already expired
    });
    const result = authorizeCollab(token, 'page-1', SECRET);
    expect(result).toMatchObject({ ok: false, reason: 'expired' });
    assertNoSecretLeak(result);
  });

  it('token for a different page is rejected', () => {
    const token = mintCollabToken({
      userId: 'user-1',
      pageId: 'page-OTHER',
      role: 'editor',
      secret: SECRET,
    });
    const result = authorizeCollab(token, 'page-1', SECRET);
    expect(result).toMatchObject({ ok: false, reason: 'page-mismatch' });
    assertNoSecretLeak(result);
  });

  it('malformed token is rejected', () => {
    const result = authorizeCollab('not-a-token', 'page-1', SECRET);
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
    assertNoSecretLeak(result);
  });
});
