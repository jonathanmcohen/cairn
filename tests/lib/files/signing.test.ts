import { signFileUrl, verifyFileUrl } from '@/lib/files/signing';
import { describe, expect, it } from 'vitest';

const SECRET = 'x'.repeat(32);

describe('signFileUrl / verifyFileUrl', () => {
  it('signs and verifies a URL', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = signFileUrl({ fileId: 'abc-123', expiresAt: exp, secret: SECRET });
    expect(verifyFileUrl({ fileId: 'abc-123', expiresAt: exp, sig, secret: SECRET })).toBe(true);
  });

  it('rejects tampered fileId', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = signFileUrl({ fileId: 'abc-123', expiresAt: exp, secret: SECRET });
    expect(verifyFileUrl({ fileId: 'evil', expiresAt: exp, sig, secret: SECRET })).toBe(false);
  });

  it('rejects expired URLs', () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const sig = signFileUrl({ fileId: 'abc-123', expiresAt: exp, secret: SECRET });
    expect(verifyFileUrl({ fileId: 'abc-123', expiresAt: exp, sig, secret: SECRET })).toBe(false);
  });

  it('rejects bad signature', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(verifyFileUrl({ fileId: 'abc', expiresAt: exp, sig: 'deadbeef', secret: SECRET })).toBe(
      false,
    );
  });
});
