import { describe, expect, it } from 'vitest';
import {
  generateDek,
  generateUserKeypair,
  unlockUserKeypair,
  unwrapDek,
  wrapDek,
} from '@/lib/e2e/crypto';

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

describe('e2e crypto — DEK wrap/unwrap', () => {
  it('generateDek returns 32 random bytes', () => {
    const dek = generateDek();
    expect(dek).toBeInstanceOf(Buffer);
    expect(dek.byteLength).toBe(32);
    const dek2 = generateDek();
    expect(dek.equals(dek2)).toBe(false);
  });

  it('wrapDek + unwrapDek round-trips for a single user', async () => {
    const sealed = await generateUserKeypair('pw');
    const { privateKey, publicKey } = await unlockUserKeypair(sealed, 'pw');
    const dek = generateDek();
    const wrapped = wrapDek(dek, publicKey);
    expect(wrapped.byteLength).toBe(92);
    const unwrapped = unwrapDek(wrapped, privateKey);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it('cross-user: A wraps DEK to B; B can unwrap, A cannot (without their own private key)', async () => {
    const sealedA = await generateUserKeypair('pwA');
    const sealedB = await generateUserKeypair('pwB');
    const unlockedA = await unlockUserKeypair(sealedA, 'pwA');
    const unlockedB = await unlockUserKeypair(sealedB, 'pwB');
    const dek = generateDek();
    // A wraps to B's public key.
    const wrappedForB = wrapDek(dek, unlockedB.publicKey);
    // B unwraps with their private key — success.
    const unwrappedByB = unwrapDek(wrappedForB, unlockedB.privateKey);
    expect(unwrappedByB.equals(dek)).toBe(true);
    // A attempts unwrap with A's private key — auth-tag mismatch.
    expect(() => unwrapDek(wrappedForB, unlockedA.privateKey)).toThrow();
  });

  it('tampering with the wrapped DEK ciphertext is rejected', async () => {
    const sealed = await generateUserKeypair('pw');
    const { privateKey, publicKey } = await unlockUserKeypair(sealed, 'pw');
    const wrapped = Buffer.from(wrapDek(generateDek(), publicKey));
    // Flip a byte inside the ciphertext block (after ephemeral_pub(32) + iv(12) = 44).
    wrapped.writeUInt8(wrapped.readUInt8(44) ^ 0x01, 44);
    expect(() => unwrapDek(wrapped, privateKey)).toThrow();
  });
});
