import { describe, expect, it } from 'vitest';
import { authorizeCollab } from '@/lib/collab/authorize';
import { mintCollabToken } from '@/lib/collab/token';

// The collab token is an HMAC-signed `<payloadB64>.<sig>` minted by
// mintCollabToken (src/lib/collab/token.ts), NOT a JOSE/JWT. authorizeCollab
// returns { ok: false } on any rejection (forged/expired/wrong-page) rather than
// throwing; the contract under test is that those three are never authorized.
const SECRET = 'y'.repeat(32);

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
    expect(authorizeCollab(forged, 'page-1', SECRET)).toEqual({ ok: false });
  });

  it('expired token is rejected', () => {
    const token = mintCollabToken({
      userId: 'user-1',
      pageId: 'page-1',
      role: 'editor',
      secret: SECRET,
      expiresAt: Math.floor(Date.now() / 1000) - 10, // already expired
    });
    expect(authorizeCollab(token, 'page-1', SECRET)).toEqual({ ok: false });
  });

  it('token for a different page is rejected', () => {
    const token = mintCollabToken({
      userId: 'user-1',
      pageId: 'page-OTHER',
      role: 'editor',
      secret: SECRET,
    });
    expect(authorizeCollab(token, 'page-1', SECRET)).toEqual({ ok: false });
  });

  it('malformed token is rejected', () => {
    expect(authorizeCollab('not-a-token', 'page-1', SECRET)).toEqual({ ok: false });
  });
});
