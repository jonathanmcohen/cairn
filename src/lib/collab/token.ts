import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MemberRole } from '@/lib/auth/require-role';

export type CollabClaims = {
  userId: string;
  pageId: string;
  role: MemberRole;
  exp: number; // unix seconds
};

export type MintInput = {
  userId: string;
  pageId: string;
  role: MemberRole;
  secret: string;
  /** unix seconds; defaults to now + 5 min */
  expiresAt?: number;
};

const DEFAULT_TTL_SECONDS = 5 * 60;

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('hex');
}

export function mintCollabToken(input: MintInput): string {
  const exp = input.expiresAt ?? Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS;
  const claims: CollabClaims = {
    userId: input.userId,
    pageId: input.pageId,
    role: input.role,
    exp,
  };
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = sign(payloadB64, input.secret);
  return `${payloadB64}.${sig}`;
}

/** Returns the claims if the token is well-formed, correctly signed, and unexpired; else null. */
export function verifyCollabToken(token: string, secret: string): CollabClaims | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length || a.length === 0) return null;
  if (!timingSafeEqual(a, b)) return null;

  let claims: CollabClaims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof claims?.userId !== 'string' ||
    typeof claims?.pageId !== 'string' ||
    typeof claims?.role !== 'string' ||
    typeof claims?.exp !== 'number'
  ) {
    return null;
  }
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}
