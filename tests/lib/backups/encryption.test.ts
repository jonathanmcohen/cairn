import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup } from '@/lib/backups/encryption';
import {
  buildEnvelopeHeader,
  ENVELOPE_MAGIC,
  parseEnvelopeHeader,
} from '@/lib/backups/encryption-envelope';

async function collect(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('envelope framing', () => {
  it('builds a 44-byte header (16 magic + 16 salt + 12 nonce)', () => {
    const salt = Buffer.alloc(16, 0x11);
    const nonce = Buffer.alloc(12, 0x22);
    const header = buildEnvelopeHeader(salt, nonce);
    expect(header.length).toBe(44);
    expect(header.subarray(0, 16).equals(ENVELOPE_MAGIC)).toBe(true);
    expect(header.subarray(16, 32).equals(salt)).toBe(true);
    expect(header.subarray(32, 44).equals(nonce)).toBe(true);
  });

  it('parses a valid header', () => {
    const salt = Buffer.alloc(16, 0x11);
    const nonce = Buffer.alloc(12, 0x22);
    const header = buildEnvelopeHeader(salt, nonce);
    const parsed = parseEnvelopeHeader(header);
    expect(parsed.salt.equals(salt)).toBe(true);
    expect(parsed.nonce.equals(nonce)).toBe(true);
  });

  it('rejects a header with wrong magic', () => {
    const bad = Buffer.alloc(44);
    bad.write('BOGUS-MAGIC-HEAD\n', 0);
    expect(() => parseEnvelopeHeader(bad)).toThrow(/magic|envelope/i);
  });

  it('rejects an under-length buffer', () => {
    expect(() => parseEnvelopeHeader(Buffer.alloc(20))).toThrow(/length/i);
  });
});

describe('encrypt/decrypt roundtrip', () => {
  it('roundtrips a small body', async () => {
    const plaintext = Buffer.from('hello cairn backups', 'utf8');
    const enc = encryptBackup('correct horse battery staple');
    Readable.from([plaintext]).pipe(enc);
    const ciphertext = await collect(enc);

    expect(ciphertext.subarray(0, 16).toString('utf8')).toBe('CAIRN-ENC-BAK-v1');
    expect(ciphertext.length).toBeGreaterThan(plaintext.length + 44);

    const dec = decryptBackup('correct horse battery staple');
    Readable.from([ciphertext]).pipe(dec);
    const out = await collect(dec);
    expect(out.toString('utf8')).toBe('hello cairn backups');
  });

  it('roundtrips a multi-MB body in chunks', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    const enc = encryptBackup('pp-multimb');
    Readable.from([
      big.subarray(0, 700_000),
      big.subarray(700_000, 1_500_000),
      big.subarray(1_500_000),
    ]).pipe(enc);
    const ct = await collect(enc);
    const dec = decryptBackup('pp-multimb');
    Readable.from([ct]).pipe(dec);
    const out = await collect(dec);
    expect(out.equals(big)).toBe(true);
  });

  it('rejects wrong passphrase with a clear error', async () => {
    const enc = encryptBackup('right-pass');
    Readable.from(['payload-bytes']).pipe(enc);
    const ct = await collect(enc);
    const dec = decryptBackup('wrong-pass');
    await expect(
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        Readable.from([ct]).pipe(dec);
        dec.on('data', (c) => chunks.push(c));
        dec.on('end', () => resolve(Buffer.concat(chunks)));
        dec.on('error', reject);
      }),
    ).rejects.toThrow(/passphrase|auth|tag/i);
  });

  it('rejects tampered ciphertext (auth tag fails)', async () => {
    const enc = encryptBackup('tamper-pp');
    Readable.from(['payload-bytes-for-tamper-test']).pipe(enc);
    const ct = await collect(enc);
    // Flip a byte well inside the ciphertext (past the 44-byte header).
    ct[50] = (ct[50] ?? 0) ^ 0xff;
    const dec = decryptBackup('tamper-pp');
    await expect(
      new Promise((resolve, reject) => {
        Readable.from([ct]).pipe(dec);
        dec.on('data', () => {});
        dec.on('end', resolve);
        dec.on('error', reject);
      }),
    ).rejects.toThrow(/auth|tag|tamper/i);
  });

  it('rejects a stream with the wrong envelope magic', async () => {
    const fake = Buffer.alloc(60);
    fake.write('NOPE-NOT-CAIRN!!\n', 0);
    const dec = decryptBackup('whatever');
    await expect(
      new Promise((resolve, reject) => {
        Readable.from([fake]).pipe(dec);
        dec.on('data', () => {});
        dec.on('end', resolve);
        dec.on('error', reject);
      }),
    ).rejects.toThrow(/magic|envelope/i);
  });
});
