import { describe, expect, it } from 'vitest';
import {
  cookieNameFor,
  issueAccessCookieValue,
  verifyAccessCookieValue,
} from '@/lib/pages/share-cookie';

const SECRET = 's'.repeat(32);
const PAGE = '11111111-1111-1111-1111-111111111111';

describe('cookieNameFor', () => {
  it('namespaces per page', () => {
    expect(cookieNameFor(PAGE)).toBe(`cairn_pub_${PAGE}`);
  });
});

describe('issue/verify access cookie', () => {
  it('round-trips a freshly issued cookie', () => {
    const value = issueAccessCookieValue({ pageId: PAGE, ttlSeconds: 3600, secret: SECRET });
    expect(verifyAccessCookieValue({ pageId: PAGE, value, secret: SECRET })).toBe(true);
  });

  it('rejects a forged signature', () => {
    const value = issueAccessCookieValue({ pageId: PAGE, ttlSeconds: 3600, secret: SECRET });
    const [exp] = value.split('.');
    const forged = `${exp}.${'0'.repeat(64)}`;
    expect(verifyAccessCookieValue({ pageId: PAGE, value: forged, secret: SECRET })).toBe(false);
  });

  it('rejects a cookie minted for a different page (pageId is bound into the signature)', () => {
    const value = issueAccessCookieValue({ pageId: PAGE, ttlSeconds: 3600, secret: SECRET });
    const other = '22222222-2222-2222-2222-222222222222';
    expect(verifyAccessCookieValue({ pageId: other, value, secret: SECRET })).toBe(false);
  });

  it('rejects an expired cookie', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    const value = issueAccessCookieValue({ pageId: PAGE, expiresAt: pastExp, secret: SECRET });
    expect(verifyAccessCookieValue({ pageId: PAGE, value, secret: SECRET })).toBe(false);
  });

  it('rejects a malformed value', () => {
    expect(verifyAccessCookieValue({ pageId: PAGE, value: 'garbage', secret: SECRET })).toBe(false);
    expect(verifyAccessCookieValue({ pageId: PAGE, value: '', secret: SECRET })).toBe(false);
  });
});
