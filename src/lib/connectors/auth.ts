import { openSecret, sealSecret } from '@/lib/crypto/secret-box';
import { env } from '@/lib/env';

/**
 * Encrypt a plaintext auth-config object for storage in
 * `database_connectors.auth_config` (a bytea column).
 *
 * Implementation: JSON-stringify the plaintext, then seal with the project's
 * v0.6 secret-box (AES-256-GCM, key derived from `AUTH_SECRET`). Mirrors
 * `src/lib/auth/two-factor.ts`'s TOTP-secret storage.
 */
export function encryptAuthConfig(plain: Record<string, unknown>): Buffer {
  return sealSecret(JSON.stringify(plain), env().AUTH_SECRET);
}

/** Decrypt the stored auth_config back to a plaintext object. */
export function decryptAuthConfig(blob: Buffer): Record<string, unknown> {
  const json = openSecret(blob, env().AUTH_SECRET);
  return JSON.parse(json) as Record<string, unknown>;
}
