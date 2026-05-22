import { describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '@/lib/webhooks/sign';

describe('webhook signing', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ event: 'page.created', data: { id: 'p1' } });

  it('produces a deterministic sha256=<hex> header value', () => {
    const sig = signBody(secret, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signBody(secret, body)).toBe(sig); // deterministic
  });

  it('verifies a matching signature and rejects a tampered body', () => {
    const sig = signBody(secret, body);
    expect(verifySignature(secret, body, sig)).toBe(true);
    expect(verifySignature(secret, `${body} `, sig)).toBe(false); // body changed
    expect(verifySignature('other-secret', body, sig)).toBe(false); // wrong key
  });

  it('rejects malformed signature headers without throwing', () => {
    expect(verifySignature(secret, body, 'garbage')).toBe(false);
    expect(verifySignature(secret, body, 'sha256=zzzz')).toBe(false);
  });
});
