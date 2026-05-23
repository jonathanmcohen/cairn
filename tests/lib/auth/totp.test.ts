import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { describe, expect, it } from 'vitest';
import {
  buildOtpauthUri,
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from '@/lib/auth/totp';

describe('TOTP', () => {
  it('generates a base32 secret and a scannable otpauth URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/); // base32
    const uri = buildOtpauthUri({ secret, account: 'a@b.c', issuer: 'Cairn' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=Cairn');
    expect(uri).toContain(`secret=${secret}`);
  });

  it('verifies a currently-valid code', () => {
    const secret = generateTotpSecret();
    const code = generateSync({
      secret,
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    });
    expect(verifyTotp({ token: code, secret })).toBe(true);
  });

  it('rejects a wrong code', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp({ token: '000000', secret })).toBe(false);
  });

  it('rejects a malformed token', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp({ token: 'abcdef', secret })).toBe(false);
    expect(verifyTotp({ token: '', secret })).toBe(false);
  });
});

describe('recovery codes', () => {
  it('generates N distinct human-formatted codes', () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('hashes a code deterministically and verifies via consume', () => {
    const [code] = generateRecoveryCodes(1);
    if (!code) throw new Error('no code');
    const stored = [{ hash: hashRecoveryCode(code), usedAt: null }];
    const result = consumeRecoveryCode(stored, code);
    expect(result.ok).toBe(true);
    expect(result.next?.[0]?.usedAt).not.toBeNull();
  });

  it('rejects an unknown code without mutating', () => {
    const [code] = generateRecoveryCodes(1);
    if (!code) throw new Error('no code');
    const stored = [{ hash: hashRecoveryCode(code), usedAt: null }];
    const result = consumeRecoveryCode(stored, 'ZZZZ-ZZZZ-ZZZZ');
    expect(result.ok).toBe(false);
    expect(result.next).toBeUndefined();
  });

  it('is single-use — an already-consumed code cannot be reused', () => {
    const [code] = generateRecoveryCodes(1);
    if (!code) throw new Error('no code');
    const stored = [{ hash: hashRecoveryCode(code), usedAt: new Date().toISOString() }];
    const result = consumeRecoveryCode(stored, code);
    expect(result.ok).toBe(false);
  });
});
