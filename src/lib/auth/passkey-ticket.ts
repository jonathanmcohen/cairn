import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * v0.9.6 G8 — single-purpose, time-boxed login ticket.
 *
 * The passkey login flow verifies the WebAuthn assertion in
 * `/api/webauthn/login-verify`, then hands the browser this opaque ticket.
 * The browser passes it to `signIn('passkey', { ticket })`; the `passkey`
 * Credentials provider re-verifies the HMAC + expiry to trust the embedded
 * userId. Format: `base64url(userId).expEpochMs.base64url(hmacSHA256)`.
 * Signed with AUTH_SECRET so it cannot be forged client-side.
 */
function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function unb64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

function mac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signLoginTicket(userId: string, secret: string, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  const payload = `${b64url(userId)}.${exp}`;
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyLoginTicket(ticket: string, secret: string): string | null {
  const parts = ticket.split('.');
  if (parts.length !== 3) return null;
  const [encodedId, expStr, sig] = parts;
  // The length check above guarantees all three segments exist; the explicit
  // guard keeps TS strict (noUncheckedIndexedAccess) happy without changing
  // behavior.
  if (encodedId === undefined || expStr === undefined || sig === undefined) return null;
  const payload = `${encodedId}.${expStr}`;
  const expected = mac(payload, secret);
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  try {
    return unb64url(encodedId);
  } catch {
    return null;
  }
}
