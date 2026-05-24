import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Build the per-connector HMAC key from `AUTH_SECRET` (the v0.6 secret-box
 * key-derivation root). Distinct domain string so it doesn't collide with
 * other HMAC uses of the same secret.
 */
function key(): Buffer {
  return Buffer.from(`oauth-state:${env().AUTH_SECRET}`, 'utf8');
}

export type OAuthStatePayload = {
  workspaceId: string;
  databaseId: string;
  csrf: string;
};

/**
 * Sign an OAuth state blob — `${base64url(JSON)}.${base64url(HMAC)}`. The
 * external provider treats it as opaque; the callback verifies.
 */
export function signOAuthState(payload: Omit<OAuthStatePayload, 'csrf'>): string {
  const full: OAuthStatePayload = { ...payload, csrf: randomUUID() };
  const json = Buffer.from(JSON.stringify(full), 'utf8');
  const sig = createHmac('sha256', key()).update(json).digest();
  return `${json.toString('base64url')}.${sig.toString('base64url')}`;
}

/** Verify an OAuth state blob. Returns the parsed payload or `null` if invalid. */
export function verifyOAuthState(raw: string): OAuthStatePayload | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  let bodyBuf: Buffer;
  let sigBuf: Buffer;
  try {
    bodyBuf = Buffer.from(body, 'base64url');
    sigBuf = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', key()).update(bodyBuf).digest();
  if (expected.length !== sigBuf.length) return null;
  if (!timingSafeEqual(expected, sigBuf)) return null;
  try {
    const parsed = JSON.parse(bodyBuf.toString('utf8')) as OAuthStatePayload;
    if (
      typeof parsed?.workspaceId !== 'string' ||
      typeof parsed?.databaseId !== 'string' ||
      typeof parsed?.csrf !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
