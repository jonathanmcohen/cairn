/**
 * v0.9.8 G6 (audit F) — bot-token sealing for chat OAuth installs.
 *
 * Wraps the project AEAD primitive (src/lib/crypto/secret-box.ts) with a fixed
 * key source (AUTH_SECRET) so the OAuth callback has one obvious seal/open
 * call-site. Plaintext bot tokens are NEVER persisted and NEVER logged.
 */

import { openSecret, sealSecret } from '@/lib/crypto/secret-box';

function requireKey(key: string): string {
  if (!key || key.length < 32) {
    throw new Error('AUTH_SECRET missing or too short (need >=32 chars) to seal bot token');
  }
  return key;
}

export function sealBotToken(plaintext: string, key = process.env.AUTH_SECRET ?? ''): Buffer {
  return sealSecret(plaintext, requireKey(key));
}

export function openBotToken(sealed: Buffer, key = process.env.AUTH_SECRET ?? ''): string {
  return openSecret(sealed, requireKey(key));
}
