import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MemberRole } from '@/lib/auth/require-role';
import type { CollabClaims } from './token';

export type CollabRejectReason = 'malformed' | 'bad-sig' | 'expired' | 'page-mismatch';

export type CollabAuthResult =
  | { ok: true; userId: string; pageId: string; role: MemberRole }
  | {
      ok: false;
      reason: CollabRejectReason;
      /** Token's claimed page id, when decodable — for operator logs only. */
      tokenPageId?: string;
      /** Token's exp (unix seconds), when decodable — for operator logs only. */
      exp?: number;
    };

/**
 * Decode the token payload WITHOUT verifying the signature. Used only to enrich
 * a rejection log with the claimed pageId/exp. NEVER trust these values for an
 * allow decision — they are attacker-controlled until the signature checks out.
 */
function decodeUnverified(token: string): Partial<CollabClaims> | null {
  if (typeof token !== 'string') return null;
  const [payloadB64] = token.split('.');
  if (!payloadB64) return null;
  try {
    return JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as Partial<CollabClaims>;
  } catch {
    return null;
  }
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('hex');
}

/**
 * Pure authorization decision for a collab WS connect. Verifies the token's
 * signature + expiry and that its pageId matches the requested document name.
 * On rejection it returns a typed `reason` (and, when decodable, the claimed
 * pageId/exp) so the server can log WHY without ever touching the secret.
 *
 * v0.9.6 G4 (#137).
 */
export function authorizeCollab(
  token: string,
  documentName: string,
  secret: string,
): CollabAuthResult {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return { ok: false, reason: 'malformed' };

  const decoded = decodeUnverified(token);
  const tokenPageId = typeof decoded?.pageId === 'string' ? decoded.pageId : undefined;
  const exp = typeof decoded?.exp === 'number' ? decoded.exp : undefined;

  // Signature check (constant-time).
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length || a.length === 0 || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-sig', tokenPageId, exp };
  }

  // Past this point the payload is authenticated; parse it strictly.
  let claims: CollabClaims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed', tokenPageId, exp };
  }
  if (
    typeof claims?.userId !== 'string' ||
    typeof claims?.pageId !== 'string' ||
    typeof claims?.role !== 'string' ||
    typeof claims?.exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed', tokenPageId, exp };
  }
  if (claims.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired', tokenPageId: claims.pageId, exp: claims.exp };
  }
  if (claims.pageId !== documentName) {
    return { ok: false, reason: 'page-mismatch', tokenPageId: claims.pageId, exp: claims.exp };
  }
  return { ok: true, userId: claims.userId, pageId: claims.pageId, role: claims.role };
}
