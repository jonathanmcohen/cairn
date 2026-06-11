import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { hashRaw } from '@node-rs/argon2';

/**
 * v0.10.0 G1 — at-rest encryption envelope for federated peer shared secrets.
 *
 * `peer_instances.shared_secret_hash` historically stored the RAW shared
 * secret (the HMAC protocol needs the raw key at verify/sign time, so one-way
 * hashing is impossible — see the schema header). This module wraps the secret
 * in AES-256-GCM under the operator env key `CAIRN_PEER_SECRET_KEY` so a DB
 * read (backup, replica, SQLi elsewhere) no longer leaks live credentials.
 *
 * String envelope format (one column, format self-describing):
 *   `enc-v1:<base64 salt>:<base64 iv>:<base64 tag>:<base64 ciphertext>`
 *
 * Key derivation is Argon2id with the SAME parameters as the backup envelope
 * (src/lib/backups/encryption.ts): memoryCost 64 MB, timeCost 3,
 * parallelism 1, 32-byte output. A random 16-byte salt is minted per
 * encryption, so two encryptions of the same secret never collide.
 *
 * Derived-key cache: Argon2id at 64 MB per inbound search request is too hot,
 * so derived keys are memoised on `globalThis` keyed by
 * sha256(envKey) + salt (bounded Map, insertion-order eviction). The cache
 * lives on `globalThis`, NOT at module scope, for the same reason as
 * src/lib/backups/maintenance.ts: Next compiles the route handlers into
 * separate bundles, and a module-level Map could be instantiated once per
 * bundle — one Node process ⇒ one `globalThis` ⇒ one cache.
 *
 * Failure posture: decrypt failures throw `PeerSecretDecryptError`, whose
 * message names the env var and the recovery path (re-pair) but NEVER
 * includes key material or ciphertext. Callers fail CLOSED per row.
 */

/** Name of the operator env var holding the at-rest encryption key. */
export const PEER_SECRET_ENV_VAR = 'CAIRN_PEER_SECRET_KEY';

const ENC_PREFIX = 'enc-v1:';
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;
const IV_LEN = 12; // GCM nonce
// Argon2id algorithm enum value (2). Hardcoded as a literal because
// `Algorithm.Argon2id` is a `const enum` from @node-rs/argon2 and tsconfig has
// `isolatedModules`, which forbids ambient const enum access.
const ARGON2_ALGORITHM_ID = 2;
const ARGON2_PARAMS = {
  algorithm: ARGON2_ALGORITHM_ID,
  memoryCost: 64 * 1024, // 64 MB (in KiB)
  timeCost: 3,
  parallelism: 1,
  outputLen: KEY_LEN,
} as const;

/**
 * Typed decrypt failure. The message is operator-facing: it names
 * CAIRN_PEER_SECRET_KEY and says to re-pair/rotate — it never carries key
 * material or ciphertext, so it is safe to log verbatim.
 */
export class PeerSecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeerSecretDecryptError';
  }
}

/** True when the stored value is an `enc-v1:` envelope (vs a legacy raw secret). */
export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

// ---------------------------------------------------------------------------
// Derived-key cache (globalThis — see file header for why not module scope).
// ---------------------------------------------------------------------------

const KEY_CACHE_CAP = 32;

const globalStore = globalThis as typeof globalThis & {
  __cairnPeerSecretKeyCache?: Map<string, Buffer>;
  __cairnPeerSecretRawWarned?: boolean;
};

function keyCache(): Map<string, Buffer> {
  globalStore.__cairnPeerSecretKeyCache ??= new Map();
  return globalStore.__cairnPeerSecretKeyCache;
}

/** Test-only: current number of cached derived keys. */
export function __peerSecretCacheSize(): number {
  return keyCache().size;
}

/** Test-only: clear the derived-key cache between tests. */
export function __resetPeerSecretCacheForTests(): void {
  keyCache().clear();
  globalStore.__cairnPeerSecretRawWarned = false;
}

async function deriveKey(envKey: string, salt: Buffer): Promise<Buffer> {
  // Cache key = sha256(envKey) + salt. Hashing the env key means the raw key
  // material is never used as a Map key (heap dumps of the cache reveal only
  // digests + derived keys, which GCM needs anyway).
  const cacheKey = `${createHash('sha256').update(envKey, 'utf8').digest('hex')}:${salt.toString('hex')}`;
  const cache = keyCache();
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const derived = Buffer.from(
    await hashRaw(Buffer.from(envKey, 'utf8'), { ...ARGON2_PARAMS, salt }),
  );
  if (cache.size >= KEY_CACHE_CAP) {
    // Simple insertion-order eviction — Map iterates in insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, derived);
  return derived;
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt
// ---------------------------------------------------------------------------

/** Wrap a raw peer secret in the `enc-v1:` AES-256-GCM envelope. */
export async function encryptPeerSecret(raw: string, envKey: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(envKey, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(raw, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'enc-v1',
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

function decryptFailure(): PeerSecretDecryptError {
  return new PeerSecretDecryptError(
    `failed to decrypt a stored peer secret with the current ${PEER_SECRET_ENV_VAR} ` +
      `(the key was rotated or the row is corrupt). Re-pair the peer to mint a fresh ` +
      `secret under the current key, or restore the previous ${PEER_SECRET_ENV_VAR}.`,
  );
}

/** Unwrap an `enc-v1:` envelope. Throws `PeerSecretDecryptError` on any failure. */
export async function decryptPeerSecret(stored: string, envKey: string): Promise<string> {
  if (!isEncryptedSecret(stored)) {
    throw new PeerSecretDecryptError(
      `stored peer secret is not an enc-v1 envelope — refusing to decrypt. ` +
        `Re-pair the peer with ${PEER_SECRET_ENV_VAR} set to store it encrypted.`,
    );
  }
  const parts = stored.split(':');
  if (parts.length !== 5) throw decryptFailure();
  const [, saltB64, ivB64, tagB64, ciphertextB64] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  let plaintext: Buffer;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');
    if (salt.length !== SALT_LEN || iv.length !== IV_LEN) throw new Error('bad envelope');
    const key = await deriveKey(envKey, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM auth-tag mismatch (wrong/rotated key, tampered ciphertext) and
    // malformed base64 both land here. Never propagate the raw error — node's
    // message is fine, but a typed error with the operator playbook is better,
    // and we must never echo ciphertext or key material.
    throw decryptFailure();
  }
  return plaintext.toString('utf8');
}

// ---------------------------------------------------------------------------
// Row resolution (the one entry point verify/sign paths use)
// ---------------------------------------------------------------------------

export type ResolvedPeerSecret = {
  /** The raw HMAC key to verify/sign with. */
  secret: string;
  /**
   * True when the row stores a legacy raw secret while the env key is set —
   * the caller should re-encrypt the row after a SUCCESSFUL verify (lazy
   * migration; never upgrade on an unverified request).
   */
  needsUpgrade: boolean;
};

/**
 * Resolve a stored `shared_secret_hash` value to the raw HMAC secret.
 *
 *   - raw + no env key   → legacy mode, use as-is
 *   - raw + env key      → use as-is, flag for lazy re-encryption
 *   - enc-v1 + env key   → decrypt (throws PeerSecretDecryptError on wrong key)
 *   - enc-v1 + no env key → throw (fail closed: the key is required to read it)
 */
export async function resolvePeerSecret(
  stored: string,
  envKey: string | undefined,
): Promise<ResolvedPeerSecret> {
  if (isEncryptedSecret(stored)) {
    if (!envKey) {
      throw new PeerSecretDecryptError(
        `stored peer secret is encrypted but ${PEER_SECRET_ENV_VAR} is unset — ` +
          `the env var is required to read encrypted peer secrets. Restore it, ` +
          `or re-pair the peer to rotate the secret.`,
      );
    }
    return { secret: await decryptPeerSecret(stored, envKey), needsUpgrade: false };
  }
  return { secret: stored, needsUpgrade: Boolean(envKey) };
}

/**
 * Once-per-process gate for the raw-at-rest operator warning. Returns true
 * exactly once (then flips the globalThis flag) so the inbound route and the
 * outbound fanout — separate Next bundles — emit ONE warning between them.
 * Callers own the actual logger.warn line.
 */
export function shouldWarnRawSecretsAtRest(): boolean {
  if (globalStore.__cairnPeerSecretRawWarned) return false;
  globalStore.__cairnPeerSecretRawWarned = true;
  return true;
}
