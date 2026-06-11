import { beforeEach, describe, expect, it } from 'vitest';
import {
  __peerSecretCacheSize,
  __resetPeerSecretCacheForTests,
  decryptPeerSecret,
  encryptPeerSecret,
  isEncryptedSecret,
  PeerSecretDecryptError,
  resolvePeerSecret,
  shouldWarnRawSecretsAtRest,
} from '@/lib/search/peer-secret';

const ENV_KEY = 'test-peer-secret-key-0123456789';
const OTHER_KEY = 'a-completely-different-env-key-zz';
const RAW = 'shared-secret-aaaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => {
  __resetPeerSecretCacheForTests();
});

describe('encryptPeerSecret / decryptPeerSecret', () => {
  it('round-trips a secret through the enc-v1 envelope', async () => {
    const stored = await encryptPeerSecret(RAW, ENV_KEY);
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored.startsWith('enc-v1:')).toBe(true);
    // The raw secret must never appear in the stored value.
    expect(stored).not.toContain(RAW);
    await expect(decryptPeerSecret(stored, ENV_KEY)).resolves.toBe(RAW);
  });

  it('isEncryptedSecret is false for raw legacy values', () => {
    expect(isEncryptedSecret(RAW)).toBe(false);
    expect(isEncryptedSecret('')).toBe(false);
  });

  it('mints a fresh salt + iv per call — two encryptions of the same input differ', async () => {
    const a = await encryptPeerSecret(RAW, ENV_KEY);
    const b = await encryptPeerSecret(RAW, ENV_KEY);
    expect(a).not.toBe(b);
    const [, saltA, ivA] = a.split(':');
    const [, saltB, ivB] = b.split(':');
    expect(saltA).not.toBe(saltB);
    expect(ivA).not.toBe(ivB);
    // Both still decrypt.
    await expect(decryptPeerSecret(a, ENV_KEY)).resolves.toBe(RAW);
    await expect(decryptPeerSecret(b, ENV_KEY)).resolves.toBe(RAW);
  });

  it('wrong key → PeerSecretDecryptError naming the env var, with no key/ciphertext material', async () => {
    const stored = await encryptPeerSecret(RAW, ENV_KEY);
    const err = await decryptPeerSecret(stored, OTHER_KEY).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PeerSecretDecryptError);
    const message = (err as PeerSecretDecryptError).message;
    expect(message).toContain('CAIRN_PEER_SECRET_KEY');
    expect(message).toMatch(/re-pair/i);
    // Never leak the keys, the raw secret, or any envelope segment.
    expect(message).not.toContain(ENV_KEY);
    expect(message).not.toContain(OTHER_KEY);
    expect(message).not.toContain(RAW);
    const ciphertextB64 = stored.split(':')[4] as string;
    expect(message).not.toContain(ciphertextB64);
  });

  it('tampered ciphertext → PeerSecretDecryptError', async () => {
    const stored = await encryptPeerSecret(RAW, ENV_KEY);
    const parts = stored.split(':');
    const ct = parts[4] as string;
    // Flip the first ciphertext character to a different base64 char.
    parts[4] = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    await expect(decryptPeerSecret(parts.join(':'), ENV_KEY)).rejects.toBeInstanceOf(
      PeerSecretDecryptError,
    );
  });

  it('tampered auth tag → PeerSecretDecryptError', async () => {
    const stored = await encryptPeerSecret(RAW, ENV_KEY);
    const parts = stored.split(':');
    const tag = parts[3] as string;
    parts[3] = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    await expect(decryptPeerSecret(parts.join(':'), ENV_KEY)).rejects.toBeInstanceOf(
      PeerSecretDecryptError,
    );
  });

  it('truncated / malformed envelopes → PeerSecretDecryptError (never a crash)', async () => {
    await expect(decryptPeerSecret('enc-v1:only-two:parts', ENV_KEY)).rejects.toBeInstanceOf(
      PeerSecretDecryptError,
    );
    await expect(decryptPeerSecret('enc-v1::::', ENV_KEY)).rejects.toBeInstanceOf(
      PeerSecretDecryptError,
    );
    // Raw input to decryptPeerSecret is a caller bug — typed error, not a crash.
    await expect(decryptPeerSecret(RAW, ENV_KEY)).rejects.toBeInstanceOf(PeerSecretDecryptError);
  });
});

describe('resolvePeerSecret (all four branches)', () => {
  it('raw + no env key → legacy passthrough, no upgrade', async () => {
    await expect(resolvePeerSecret(RAW, undefined)).resolves.toEqual({
      secret: RAW,
      needsUpgrade: false,
    });
  });

  it('raw + env key set → passthrough flagged for lazy upgrade', async () => {
    await expect(resolvePeerSecret(RAW, ENV_KEY)).resolves.toEqual({
      secret: RAW,
      needsUpgrade: true,
    });
  });

  it('enc-v1 + env key set → decrypts, no upgrade needed', async () => {
    const stored = await encryptPeerSecret(RAW, ENV_KEY);
    await expect(resolvePeerSecret(stored, ENV_KEY)).resolves.toEqual({
      secret: RAW,
      needsUpgrade: false,
    });
  });

  it('enc-v1 + wrong env key → PeerSecretDecryptError (fail closed)', async () => {
    const stored = await encryptPeerSecret(RAW, ENV_KEY);
    await expect(resolvePeerSecret(stored, OTHER_KEY)).rejects.toBeInstanceOf(
      PeerSecretDecryptError,
    );
  });

  it('enc-v1 + NO env key → PeerSecretDecryptError saying the env var is required', async () => {
    const stored = await encryptPeerSecret(RAW, ENV_KEY);
    const err = await resolvePeerSecret(stored, undefined).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PeerSecretDecryptError);
    expect((err as PeerSecretDecryptError).message).toContain('CAIRN_PEER_SECRET_KEY');
    expect((err as PeerSecretDecryptError).message).toMatch(/required/i);
  });
});

describe('derived-key cache', () => {
  it('reuses the derived key for the same salt + env key (decrypts stay correct)', async () => {
    expect(__peerSecretCacheSize()).toBe(0);
    const stored = await encryptPeerSecret(RAW, ENV_KEY);
    // encrypt derived + cached one key (one salt).
    expect(__peerSecretCacheSize()).toBe(1);
    // decrypt of the SAME envelope shares salt+key → cache hit, size unchanged.
    await expect(decryptPeerSecret(stored, ENV_KEY)).resolves.toBe(RAW);
    expect(__peerSecretCacheSize()).toBe(1);
    await expect(decryptPeerSecret(stored, ENV_KEY)).resolves.toBe(RAW);
    expect(__peerSecretCacheSize()).toBe(1);
    // A second envelope mints a new salt → second cache entry.
    const stored2 = await encryptPeerSecret(RAW, ENV_KEY);
    expect(__peerSecretCacheSize()).toBe(2);
    await expect(decryptPeerSecret(stored2, ENV_KEY)).resolves.toBe(RAW);
    expect(__peerSecretCacheSize()).toBe(2);
  });
});

describe('shouldWarnRawSecretsAtRest', () => {
  it('returns true exactly once per process (reset by the test helper)', () => {
    expect(shouldWarnRawSecretsAtRest()).toBe(true);
    expect(shouldWarnRawSecretsAtRest()).toBe(false);
    expect(shouldWarnRawSecretsAtRest()).toBe(false);
    __resetPeerSecretCacheForTests();
    expect(shouldWarnRawSecretsAtRest()).toBe(true);
  });
});
