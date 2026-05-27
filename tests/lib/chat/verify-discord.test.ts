import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyDiscordSignature } from '@/lib/chat/verify-discord';

async function genKeyPair(): Promise<CryptoKeyPair> {
  return (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
}

async function exportPubHex(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', key));
  return Buffer.from(raw).toString('hex');
}

async function signHex(priv: CryptoKey, msg: Uint8Array): Promise<string> {
  const sig = new Uint8Array(await webcrypto.subtle.sign({ name: 'Ed25519' }, priv, msg));
  return Buffer.from(sig).toString('hex');
}

describe('verifyDiscordSignature', () => {
  it('accepts a valid Ed25519 signature', async () => {
    const pair = await genKeyPair();
    const ts = '1700000000';
    const body = '{"hi":1}';
    const sigHex = await signHex(pair.privateKey, new TextEncoder().encode(ts + body));
    const pubHex = await exportPubHex(pair.publicKey);
    expect(
      await verifyDiscordSignature({
        publicKeyHex: pubHex,
        timestamp: ts,
        signature: sigHex,
        rawBody: body,
      }),
    ).toBe(true);
  });

  it('rejects when the signature does not match the body', async () => {
    const pair = await genKeyPair();
    const sigHex = await signHex(pair.privateKey, new TextEncoder().encode('different'));
    const pubHex = await exportPubHex(pair.publicKey);
    expect(
      await verifyDiscordSignature({
        publicKeyHex: pubHex,
        timestamp: '1700000000',
        signature: sigHex,
        rawBody: '{}',
      }),
    ).toBe(false);
  });

  it('rejects when the public key is wrong', async () => {
    const pair = await genKeyPair();
    const other = await genKeyPair();
    const ts = '1700000000';
    const body = '{"x":1}';
    const sigHex = await signHex(pair.privateKey, new TextEncoder().encode(ts + body));
    const pubHexWrong = await exportPubHex(other.publicKey);
    expect(
      await verifyDiscordSignature({
        publicKeyHex: pubHexWrong,
        timestamp: ts,
        signature: sigHex,
        rawBody: body,
      }),
    ).toBe(false);
  });

  it('returns false on garbage hex inputs (no throw)', async () => {
    expect(
      await verifyDiscordSignature({
        publicKeyHex: 'zzz',
        timestamp: 'ts',
        signature: 'zzz',
        rawBody: '{}',
      }),
    ).toBe(false);
  });
});
