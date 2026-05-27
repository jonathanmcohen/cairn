/**
 * v0.9.0 G7 P36 — Discord interactions / events signature verification.
 *
 * Discord signs every payload with Ed25519 over `${timestamp}${rawBody}`, using
 * the application's public key (hex-encoded, set in the Discord developer
 * portal). The headers we read are `x-signature-ed25519` + `x-signature-timestamp`.
 *
 * Node 22 ships native Ed25519 via WebCrypto subtle; the discord.js helper is
 * available as a fallback but the standard library version keeps the bundle
 * smaller and is easier to test.
 */

import { webcrypto } from 'node:crypto';

export type VerifyDiscordInput = {
  publicKeyHex: string;
  timestamp: string;
  signature: string;
  rawBody: string;
};

export async function verifyDiscordSignature(input: VerifyDiscordInput): Promise<boolean> {
  if (!input.publicKeyHex || !input.signature || !input.timestamp) return false;
  try {
    const pubKey = Buffer.from(input.publicKeyHex, 'hex');
    const sig = Buffer.from(input.signature, 'hex');
    const msg = Buffer.from(`${input.timestamp}${input.rawBody}`);
    const key = await webcrypto.subtle.importKey('raw', pubKey, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return await webcrypto.subtle.verify({ name: 'Ed25519' }, key, sig, msg);
  } catch {
    return false;
  }
}
