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

// --- DEK / wrap-unwrap helpers (Task 4) ---

const DEK_BYTES = 32;
const EPHEMERAL_PUB_BYTES = 32;
const HKDF_INFO = Buffer.from('cairn-e2e-dek-wrap-v1', 'utf8');

export function generateDek(): Buffer {
  return randomBytes(DEK_BYTES);
}

function deriveWrapKey(sharedSecret: Buffer, ephemeralPub: Buffer, recipientPub: Buffer): Buffer {
  // HKDF salt = ephemeral_pub || recipient_pub binds the derived key to the
  // exact handshake (prevents key reuse across recipients / mistaken IDs).
  const salt = Buffer.concat([ephemeralPub, recipientPub]);
  const okm = hkdfSync('sha256', sharedSecret, salt, HKDF_INFO, 32);
  return Buffer.from(okm);
}

export function wrapDek(dek: Buffer, recipientPublicKey: Buffer): Buffer {
  if (dek.byteLength !== DEK_BYTES) {
    throw new Error(`DEK must be ${DEK_BYTES} bytes, got ${dek.byteLength}`);
  }
  if (recipientPublicKey.byteLength !== 32) {
    throw new Error('recipient public key must be 32 bytes (X25519)');
  }
  // Ephemeral keypair for this wrap.
  const { publicKey: ephPubObj, privateKey: ephPrivObj } = generateKeyPairSync('x25519');
  const ephPub = rawX25519Public(ephPubObj);

  const recipientPubObj = importX25519PublicFromRaw(recipientPublicKey);
  const shared = diffieHellman({ publicKey: recipientPubObj, privateKey: ephPrivObj });

  const kek = deriveWrapKey(shared, ephPub, recipientPublicKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ephPub, iv, ct, tag]);
}

export function unwrapDek(wrapped: Buffer, recipientPrivateKey: Buffer): Buffer {
  const expectedLen = EPHEMERAL_PUB_BYTES + IV_BYTES + DEK_BYTES + TAG_BYTES;
  if (wrapped.byteLength !== expectedLen) {
    throw new Error(`wrapped DEK must be ${expectedLen} bytes, got ${wrapped.byteLength}`);
  }
  const ephPub = wrapped.subarray(0, EPHEMERAL_PUB_BYTES);
  const iv = wrapped.subarray(EPHEMERAL_PUB_BYTES, EPHEMERAL_PUB_BYTES + IV_BYTES);
  const tag = wrapped.subarray(wrapped.length - TAG_BYTES);
  const ct = wrapped.subarray(EPHEMERAL_PUB_BYTES + IV_BYTES, wrapped.length - TAG_BYTES);

  const ephPubObj = importX25519PublicFromRaw(ephPub);
  const recipientPrivObj = importX25519PrivateFromRaw(recipientPrivateKey);
  const shared = diffieHellman({ publicKey: ephPubObj, privateKey: recipientPrivObj });

  // Derive the recipient's public key on the fly for the HKDF salt binding.
  const recipientPubRaw = rawX25519Public(createPublicKey(recipientPrivObj));

  const kek = deriveWrapKey(shared, ephPub, recipientPubRaw);
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

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
