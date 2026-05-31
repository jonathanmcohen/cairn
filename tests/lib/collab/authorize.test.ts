import { describe, expect, it } from 'vitest';
import { authorizeCollab } from '@/lib/collab/authorize';
import { mintCollabToken } from '@/lib/collab/token';

const SECRET = 'x'.repeat(32);

describe('authorizeCollab', () => {
  it('authorizes when token is valid and pageId matches the document', () => {
    const token = mintCollabToken({
      userId: 'u',
      pageId: 'page-1',
      role: 'editor',
      secret: SECRET,
    });
    const result = authorizeCollab(token, 'page-1', SECRET);
    expect(result).toMatchObject({ ok: true, userId: 'u', role: 'editor' });
  });

  it('rejects when the token pageId does not match the document name', () => {
    const token = mintCollabToken({
      userId: 'u',
      pageId: 'page-1',
      role: 'editor',
      secret: SECRET,
    });
    expect(authorizeCollab(token, 'page-2', SECRET)).toMatchObject({
      ok: false,
      reason: 'page-mismatch',
    });
  });

  it('rejects an invalid signature', () => {
    const token = mintCollabToken({
      userId: 'u',
      pageId: 'page-1',
      role: 'editor',
      secret: SECRET,
    });
    expect(authorizeCollab(token, 'page-1', 'y'.repeat(32))).toMatchObject({
      ok: false,
      reason: 'bad-sig',
    });
  });

  it('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 5;
    const token = mintCollabToken({
      userId: 'u',
      pageId: 'page-1',
      role: 'editor',
      secret: SECRET,
      expiresAt: past,
    });
    expect(authorizeCollab(token, 'page-1', SECRET)).toMatchObject({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects an empty / malformed token', () => {
    expect(authorizeCollab('', 'page-1', SECRET)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
    expect(authorizeCollab('garbage', 'page-1', SECRET)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
  });

  it('on a page-mismatch surfaces the token pageId + exp for logging (never the secret)', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = mintCollabToken({
      userId: 'u',
      pageId: 'page-1',
      role: 'editor',
      secret: SECRET,
      expiresAt: exp,
    });
    const result = authorizeCollab(token, 'page-2', SECRET);
    expect(result).toMatchObject({
      ok: false,
      reason: 'page-mismatch',
      tokenPageId: 'page-1',
      exp,
    });
  });
});
