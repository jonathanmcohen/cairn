/**
 * v0.9.0 G7 P37 — Ed25519 key/signature helper for Discord-interaction tests.
 * Generates a fresh keypair, returns the hex-encoded public key (what gets
 * stored in `chat_bridge_installs.signing_secret`), and provides a `sign`
 * that produces the `x-signature-ed25519` header value.
 */
import { webcrypto } from 'node:crypto';

export type EdKeypair = {
  publicKeyHex: string;
  sign: (timestamp: string, rawBody: string) => Promise<string>;
};

export async function makeDiscordKeypair(): Promise<EdKeypair> {
  const keys = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const rawPub = await webcrypto.subtle.exportKey('raw', keys.publicKey);
  const publicKeyHex = Buffer.from(rawPub).toString('hex');
  return {
    publicKeyHex,
    sign: async (timestamp: string, rawBody: string): Promise<string> => {
      const msg = Buffer.from(`${timestamp}${rawBody}`);
      const sig = await webcrypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, msg);
      return Buffer.from(sig).toString('hex');
    },
  };
}
