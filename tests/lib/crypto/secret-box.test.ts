import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from '@/lib/crypto/secret-box';

const KEY = 'k'.repeat(48);
const OTHER = 'z'.repeat(48);

describe('secret-box', () => {
  it('round-trips a plaintext through seal/open', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const sealed = sealSecret(plaintext, KEY);
    expect(openSecret(sealed, KEY)).toBe(plaintext);
  });

  it('produces opaque ciphertext (no plaintext substring)', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const sealed = sealSecret(plaintext, KEY);
    expect(sealed.toString('utf8')).not.toContain(plaintext);
    expect(sealed.toString('latin1')).not.toContain(plaintext);
  });

  it('uses a fresh nonce per call (ciphertext differs across seals)', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const a = sealSecret(plaintext, KEY);
    const b = sealSecret(plaintext, KEY);
    expect(a.equals(b)).toBe(false);
  });

  it('throws when opened with the wrong key', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', KEY);
    expect(() => openSecret(sealed, OTHER)).toThrow();
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', KEY);
    const tampered = Buffer.from(sealed);
    const lastIdx = tampered.length - 1;
    tampered[lastIdx] = (tampered[lastIdx] ?? 0) ^ 0x01;
    expect(() => openSecret(tampered, KEY)).toThrow();
  });

  it('throws on a too-short payload', () => {
    expect(() => openSecret(Buffer.alloc(10), KEY)).toThrow(/too short/);
  });
});
