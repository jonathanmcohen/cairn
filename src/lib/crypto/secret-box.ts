import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// Envelope layout (bytea): [ 12-byte nonce | ciphertext | 16-byte GCM auth tag ].
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256
const INFO = 'cairn-totp';
const SALT = 'cairn-secret-box-v1';

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, SALT, INFO, KEY_BYTES));
}

/** Encrypt a plaintext secret for storage. REVERSIBLE (TOTP needs plaintext). */
export function sealSecret(plaintext: string, key: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(key), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

/** Decrypt a sealed envelope. Throws on wrong key, tampering, or short payload. */
export function openSecret(sealed: Buffer, key: string): string {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) throw new Error('secret-box: payload too short');
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const ciphertext = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(key), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
