import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
} from 'node:crypto';

const SCRYPT_N = 1 << 15; // 32_768 — ~50ms on a 2024-class laptop. Tradeoff: client-runnable + acceptable login latency.
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEK_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM-standard
const TAG_BYTES = 16;
const SALT_BYTES = 16;

export type SealedKeypair = {
  publicKey: Buffer;
  encryptedPrivateKey: Buffer; // iv || ct || tag
  kdfSalt: Buffer;
  kdfIters: number; // scrypt cost N
};

export type UnlockedKeypair = {
  publicKey: Buffer;
  privateKey: Buffer; // raw X25519 32B
};

function deriveKek(passphrase: string, salt: Buffer, n: number): Buffer {
  return scryptSync(Buffer.from(passphrase, 'utf8'), salt, KEK_BYTES, {
    N: n,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // Default maxmem (32 MB) is too low for N=32768. 64 MB suffices and matches the otplib budget elsewhere.
    maxmem: 64 * 1024 * 1024,
  });
}

/**
 * Extract the raw 32-byte X25519 private/public key material out of Node's
 * KeyObject. Node returns DER by default; the last 32 bytes of the
 * pkcs8/spki encoding are the actual key bytes for X25519.
 */
function rawX25519Public(pub: ReturnType<typeof createPublicKey>): Buffer {
  const spki = pub.export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 32);
}

function rawX25519Private(priv: ReturnType<typeof createPrivateKey>): Buffer {
  const pkcs8 = priv.export({ format: 'der', type: 'pkcs8' });
  return pkcs8.subarray(pkcs8.length - 32);
}

function importX25519PublicFromRaw(raw: Buffer): ReturnType<typeof createPublicKey> {
  // X25519 SPKI prefix (12 bytes) + 32-byte key.
  const prefix = Buffer.from('302a300506032b656e032100', 'hex');
  return createPublicKey({
    key: Buffer.concat([prefix, raw]),
    format: 'der',
    type: 'spki',
  });
}

function importX25519PrivateFromRaw(raw: Buffer): ReturnType<typeof createPrivateKey> {
  // X25519 PKCS8 prefix (16 bytes) + 32-byte key.
  const prefix = Buffer.from('302e020100300506032b656e04220420', 'hex');
  return createPrivateKey({
    key: Buffer.concat([prefix, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

export async function generateUserKeypair(passphrase: string): Promise<SealedKeypair> {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const pubRaw = rawX25519Public(publicKey);
  const privRaw = rawX25519Private(privateKey);

  const kdfSalt = randomBytes(SALT_BYTES);
  const kek = deriveKek(passphrase, kdfSalt, SCRYPT_N);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ct = Buffer.concat([cipher.update(privRaw), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    publicKey: pubRaw,
    encryptedPrivateKey: Buffer.concat([iv, ct, tag]),
    kdfSalt,
    kdfIters: SCRYPT_N,
  };
}

export async function unlockUserKeypair(
  sealed: SealedKeypair,
  passphrase: string,
): Promise<UnlockedKeypair> {
  const kek = deriveKek(passphrase, sealed.kdfSalt, sealed.kdfIters);
  const blob = sealed.encryptedPrivateKey;
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  const privRaw = Buffer.concat([decipher.update(ct), decipher.final()]);
  return { publicKey: sealed.publicKey, privateKey: privRaw };
}

// --- DEK / wrap-unwrap helpers land in Task 4 of this plan ---

export const __internal = {
  importX25519PublicFromRaw,
  importX25519PrivateFromRaw,
  rawX25519Public,
  rawX25519Private,
  hkdfSync,
  diffieHellman,
  randomBytes,
  IV_BYTES,
  TAG_BYTES,
};
