import type { MemberRole } from '@/lib/auth/require-role';
import { verifyCollabToken } from './token';

export type CollabAuthResult =
  | { ok: true; userId: string; pageId: string; role: MemberRole }
  | { ok: false };

/**
 * Pure authorization decision for a collab WS connect. Verifies the token's
 * signature + expiry and that its pageId matches the requested document name
 * (the document name IS the page id). No I/O — the page-permission check was
 * already done by /api/collab/token at mint time and is encoded in the role claim.
 */
export function authorizeCollab(
  token: string,
  documentName: string,
  secret: string,
): CollabAuthResult {
  const claims = verifyCollabToken(token, secret);
  if (!claims) return { ok: false };
  if (claims.pageId !== documentName) return { ok: false };
  return { ok: true, userId: claims.userId, pageId: claims.pageId, role: claims.role };
}
