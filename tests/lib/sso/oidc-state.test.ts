import { beforeAll, describe, expect, it } from 'vitest';
import { signOidcState, verifyOidcState } from '@/lib/sso/oidc-state';

beforeAll(() => {
  process.env.AUTH_SECRET = 'z'.repeat(48);
});

describe('oidc-state', () => {
  it('signs and verifies a state payload round-trip', async () => {
    const value = await signOidcState({
      idpId: 'i1',
      nonce: 'n1',
      returnTo: '/pages/abc',
    });
    expect(typeof value).toBe('string');
    expect(value.split('.').length).toBe(3); // JWS compact

    const payload = await verifyOidcState(value, 'i1');
    expect(payload.idpId).toBe('i1');
    expect(payload.nonce).toBe('n1');
    expect(payload.returnTo).toBe('/pages/abc');
  });

  it('rejects when idpId mismatches expected', async () => {
    const value = await signOidcState({ idpId: 'i1', nonce: 'n1', returnTo: '/' });
    await expect(verifyOidcState(value, 'i2')).rejects.toThrow(/idp mismatch/i);
  });

  it('rejects when signature tampered (first byte flipped)', async () => {
    const value = await signOidcState({ idpId: 'i1', nonce: 'n1', returnTo: '/' });
    const parts = value.split('.');
    const sig = parts[2]!;
    const flippedFirstChar = sig[0] === 'a' ? 'b' : 'a';
    const tampered = `${parts[0]}.${parts[1]}.${flippedFirstChar}${sig.slice(1)}`;
    await expect(verifyOidcState(tampered, 'i1')).rejects.toThrow();
  });

  it('rejects when expired', async () => {
    const value = await signOidcState({
      idpId: 'i1',
      nonce: 'n1',
      returnTo: '/',
      ttlSeconds: 0,
    });
    // Wait past the 1s clock-skew leeway jose applies by default.
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyOidcState(value, 'i1')).rejects.toThrow();
  });
});
