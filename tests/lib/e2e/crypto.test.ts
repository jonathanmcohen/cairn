import { describe, expect, it } from 'vitest';
import { generateUserKeypair, unlockUserKeypair } from '@/lib/e2e/crypto';

describe('e2e crypto — keypair lifecycle', () => {
  it('generateUserKeypair returns a 32-byte X25519 public key + sealed private key', async () => {
    const out = await generateUserKeypair('correct-horse-battery-staple');
    expect(out.publicKey).toBeInstanceOf(Buffer);
    expect(out.publicKey.byteLength).toBe(32);
    expect(out.encryptedPrivateKey).toBeInstanceOf(Buffer);
    // sealed = iv(12) + ct(32) + tag(16) = 60
    expect(out.encryptedPrivateKey.byteLength).toBe(60);
    expect(out.kdfSalt.byteLength).toBe(16);
    expect(out.kdfIters).toBeGreaterThanOrEqual(1 << 15);
  });

  it('unlockUserKeypair round-trips: correct passphrase recovers the private key', async () => {
    const sealed = await generateUserKeypair('hunter2-correct');
    const unlocked = await unlockUserKeypair(sealed, 'hunter2-correct');
    expect(unlocked.privateKey.byteLength).toBe(32);
    // Sanity: deriving an X25519 shared secret against itself succeeds.
    expect(unlocked.publicKey.equals(sealed.publicKey)).toBe(true);
  });

  it('unlockUserKeypair rejects a wrong passphrase (auth-tag mismatch)', async () => {
    const sealed = await generateUserKeypair('right-pass');
    await expect(unlockUserKeypair(sealed, 'wrong-pass')).rejects.toThrow();
  });

  it('unlockUserKeypair rejects ciphertext tampering', async () => {
    const sealed = await generateUserKeypair('pass');
    // Flip the first byte of the ciphertext block (after the 12-byte IV).
    const tampered = {
      ...sealed,
      encryptedPrivateKey: Buffer.from(sealed.encryptedPrivateKey),
    };
    // Flip first byte of ciphertext (after the 12-byte IV).
    tampered.encryptedPrivateKey.writeUInt8(tampered.encryptedPrivateKey.readUInt8(12) ^ 0x01, 12);
    await expect(unlockUserKeypair(tampered, 'pass')).rejects.toThrow();
  });
});
