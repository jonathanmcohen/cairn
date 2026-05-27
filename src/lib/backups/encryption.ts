/**
 * AES-256-GCM envelope around backup archives (v0.9.0 G8 P43).
 *
 * Public API:
 *   - encryptBackup(passphrase) → Transform: plaintext bytes in → envelope bytes out
 *   - decryptBackup(passphrase) → Transform: envelope bytes in → plaintext bytes out
 *
 * Both derive a 256-bit key from the passphrase via Argon2id (memoryCost=64 MB,
 * timeCost=3, parallelism=1), which is balanced for a once-per-backup invocation.
 * The envelope layout is documented in encryption-envelope.ts.
 *
 * Errors surface distinctly:
 *   - wrong magic → "envelope magic mismatch (not a CAIRN-ENC-BAK-v1 stream)"
 *   - wrong passphrase / tampered ciphertext → "decryption failed: auth tag mismatch..."
 *   - incomplete stream → "envelope incomplete: ..."
 *
 * The passphrase is treated as a secret — never logged, never returned in error
 * messages, never stored on the Transform instance after key derivation completes.
 */

import {
  type CipherGCM,
  createCipheriv,
  createDecipheriv,
  type DecipherGCM,
  randomBytes,
} from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { hashRaw } from '@node-rs/argon2';
import {
  buildEnvelopeHeader,
  HEADER_LEN,
  NONCE_LEN,
  parseEnvelopeHeader,
  SALT_LEN,
  TAG_LEN,
} from './encryption-envelope';

const KEY_LEN = 32; // AES-256
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

async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  const out = await hashRaw(Buffer.from(passphrase, 'utf8'), {
    ...ARGON2_PARAMS,
    salt,
  });
  return Buffer.from(out);
}

/** Transform stream: plaintext bytes → encrypted envelope bytes. */
export function encryptBackup(passphrase: string): Transform {
  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  let cipher: CipherGCM | null = null;
  let headerWritten = false;
  let keyReady: Promise<void> | null = null;

  function ensureKey(): Promise<void> {
    if (!keyReady) {
      keyReady = (async () => {
        const key = await deriveKey(passphrase, salt);
        cipher = createCipheriv('aes-256-gcm', key, nonce);
      })();
    }
    return keyReady;
  }

  return new Transform({
    async transform(chunk, _enc, cb: TransformCallback) {
      try {
        await ensureKey();
        if (!cipher) throw new Error('cipher not initialised after deriveKey');
        if (!headerWritten) {
          this.push(buildEnvelopeHeader(salt, nonce));
          headerWritten = true;
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const out = cipher.update(buf);
        if (out.length > 0) this.push(out);
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
    async flush(cb: TransformCallback) {
      try {
        await ensureKey();
        if (!cipher) throw new Error('cipher not initialised after deriveKey');
        if (!headerWritten) {
          this.push(buildEnvelopeHeader(salt, nonce));
          headerWritten = true;
        }
        const tail = cipher.final();
        if (tail.length > 0) this.push(tail);
        this.push(cipher.getAuthTag());
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

/** Transform stream: encrypted envelope bytes → plaintext bytes. */
export function decryptBackup(passphrase: string): Transform {
  let buffered = Buffer.alloc(0);
  let header: { salt: Buffer; nonce: Buffer } | null = null;
  let decipher: DecipherGCM | null = null;
  // We must hold back the trailing TAG_LEN bytes from the cipher so we can
  // call setAuthTag() before final(). Strategy: keep a sliding window —
  // anything older than TAG_LEN is safe to feed into the cipher; the last
  // TAG_LEN bytes are the tag.
  let body = Buffer.alloc(0);

  async function ensureHeader(): Promise<boolean> {
    if (header) return true;
    if (buffered.length < HEADER_LEN) return false;
    header = parseEnvelopeHeader(buffered.subarray(0, HEADER_LEN));
    body = Buffer.from(buffered.subarray(HEADER_LEN));
    buffered = Buffer.alloc(0);
    const key = await deriveKey(passphrase, header.salt);
    decipher = createDecipheriv('aes-256-gcm', key, header.nonce);
    return true;
  }

  return new Transform({
    async transform(chunk, _enc, cb: TransformCallback) {
      try {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!header) {
          buffered = Buffer.concat([buffered, buf]);
          const ready = await ensureHeader();
          if (!ready) {
            cb();
            return;
          }
        } else {
          body = Buffer.concat([body, buf]);
        }
        if (header && decipher && body.length > TAG_LEN) {
          const consume = body.subarray(0, body.length - TAG_LEN);
          body = Buffer.from(body.subarray(body.length - TAG_LEN));
          const out = decipher.update(consume);
          if (out.length > 0) this.push(out);
        }
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb: TransformCallback) {
      try {
        if (!header || !decipher) {
          throw new Error('envelope incomplete: header missing or unreadable');
        }
        if (body.length !== TAG_LEN) {
          throw new Error(
            `envelope incomplete: expected ${TAG_LEN}-byte auth tag, got ${body.length}`,
          );
        }
        decipher.setAuthTag(body);
        const tail = decipher.final();
        if (tail.length > 0) this.push(tail);
        cb();
      } catch (err) {
        // GCM final() throws "Unsupported state or unable to authenticate
        // data" on tamper / wrong passphrase. Wrap so callers + tests can
        // match on /auth|tag|passphrase/ without leaking the raw passphrase.
        const msg = (err as Error).message || '';
        if (/authenticate|state/i.test(msg)) {
          cb(
            new Error(
              `decryption failed: auth tag mismatch (wrong passphrase or tampered ciphertext)`,
            ),
          );
        } else {
          cb(err as Error);
        }
      }
    },
  });
}
