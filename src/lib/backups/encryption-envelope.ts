/**
 * Backup envelope format v1 (v0.9.0 G8 P43):
 *   [magic: 16][salt: 16][nonce: 12][ciphertext: variable][auth tag: 16]
 *
 * The magic identifies the envelope version and discriminates encrypted
 * backups from raw pg_dump custom-format dumps (which start with PGDMP). The
 * salt feeds Argon2id KDF (see encryption.ts). The nonce is the GCM IV. The
 * auth tag is written by the GCM cipher at the end of the stream.
 */

// 16 bytes exactly. Discriminates encrypted backups from raw pg_dump custom-format
// dumps (which start with "PGDMP"). NO trailing newline; if you change the value,
// keep length=16 (the runtime assertion below enforces it).
export const ENVELOPE_MAGIC = Buffer.from('CAIRN-ENC-BAK-v1', 'utf8');
export const SALT_LEN = 16;
export const NONCE_LEN = 12;
export const TAG_LEN = 16;
export const HEADER_LEN = ENVELOPE_MAGIC.length + SALT_LEN + NONCE_LEN; // 44

if (ENVELOPE_MAGIC.length !== 16) {
  throw new Error('envelope magic must be exactly 16 bytes');
}

export function buildEnvelopeHeader(salt: Buffer, nonce: Buffer): Buffer {
  if (salt.length !== SALT_LEN) throw new Error(`salt must be ${SALT_LEN} bytes`);
  if (nonce.length !== NONCE_LEN) throw new Error(`nonce must be ${NONCE_LEN} bytes`);
  return Buffer.concat([ENVELOPE_MAGIC, salt, nonce]);
}

export function parseEnvelopeHeader(buf: Buffer): { salt: Buffer; nonce: Buffer } {
  if (buf.length < HEADER_LEN) {
    throw new Error(`envelope header length: expected at least ${HEADER_LEN}, got ${buf.length}`);
  }
  if (!buf.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) {
    throw new Error('envelope magic mismatch (not a CAIRN-ENC-BAK-v1 stream)');
  }
  return {
    salt: Buffer.from(buf.subarray(ENVELOPE_MAGIC.length, ENVELOPE_MAGIC.length + SALT_LEN)),
    nonce: Buffer.from(
      buf.subarray(ENVELOPE_MAGIC.length + SALT_LEN, ENVELOPE_MAGIC.length + SALT_LEN + NONCE_LEN),
    ),
  };
}
