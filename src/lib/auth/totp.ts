import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP, verifySync } from 'otplib';

// otplib 13 needs explicit crypto + base32 plugins. NobleCryptoPlugin is
// pure-JS HMAC (sync-capable, works in Node + Edge); ScureBase32Plugin
// decodes string secrets to bytes.
const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

// Allow ±1 30s step (≈ ±30s) to absorb clock skew. Replay within a step is
// acceptable for TOTP; recovery codes below are single-use.
const STEP_TOLERANCE_SECONDS = 30;

const totp = new TOTP({ crypto, base32, issuer: 'Cairn' });

export type StoredRecoveryCode = { hash: string; usedAt: string | null };

export function generateTotpSecret(): string {
  return totp.generateSecret(); // base32
}

export function buildOtpauthUri(input: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  return totp.toURI({ label: input.account, issuer: input.issuer, secret: input.secret });
}

export function verifyTotp(input: { token: string; secret: string }): boolean {
  const token = input.token.trim();
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = verifySync({
      token,
      secret: input.secret,
      crypto,
      base32,
      epochTolerance: STEP_TOLERANCE_SECONDS,
    });
    return result.valid;
  } catch {
    return false;
  }
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

function randomGroup(): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)] ?? '';
  return out;
}

export function generateRecoveryCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(`${randomGroup()}-${randomGroup()}-${randomGroup()}`);
  }
  return [...codes];
}

/**
 * One-way hash of a recovery code for storage. Recovery codes are single-use
 * proofs (like passwords) → HASHED, never reversible. SHA-256 is appropriate
 * here: the input is high-entropy (60 bits), so a slow KDF is unnecessary.
 * Normalized (case + separators stripped) so user formatting doesn't matter.
 */
export function hashRecoveryCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

function hashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Attempt to consume `code` against the stored set. On success returns
 * `{ ok: true, next }` with the matched code stamped `usedAt`; the caller
 * persists `next`. On failure returns `{ ok: false }` and does NOT mutate.
 * Already-used codes never match.
 */
export function consumeRecoveryCode(
  stored: StoredRecoveryCode[],
  code: string,
): { ok: true; next: StoredRecoveryCode[] } | { ok: false; next?: undefined } {
  const candidate = hashRecoveryCode(code);
  const idx = stored.findIndex((c) => c.usedAt === null && hashEquals(c.hash, candidate));
  if (idx === -1) return { ok: false };
  const next = stored.map((c, i) => (i === idx ? { ...c, usedAt: new Date().toISOString() } : c));
  return { ok: true, next };
}
