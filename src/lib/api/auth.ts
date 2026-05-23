import type { AuthContext, MemberRole } from '@/lib/auth/require-role';
import { HttpError } from '@/lib/auth/require-role';
import { resolveToken, type TokenContext } from '@/lib/auth/token';

const BEARER = /^Bearer\s+(\S+)$/i;

/** Extract `Authorization: Bearer <token>`; null if absent or wrong scheme. */
export function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  return match ? (match[1] ?? null) : null;
}

/**
 * Map a unified TokenContext back to the v0.5 AuthContext that v0.5 routes
 * expect. PATs are scope-bearing, not role-bearing — derive a v0.5 role from
 * the scope set so requireRole/requirePageAccess keep working unchanged:
 *
 *   has 'admin'                         → admin
 *   has any ':destructive'              → admin
 *   has any ':write'                    → editor
 *   else                                → viewer
 *
 * This is the inverse of the role→scope map in token.ts. A PAT can only
 * present a role its scopes legitimately cover, and the acting user's actual
 * workspace role still gates the final action through requirePageAccess.
 */
function roleFromScopes(scopes: string[]): MemberRole {
  if (scopes.includes('admin')) return 'admin';
  if (scopes.some((s) => s.endsWith(':destructive'))) return 'admin';
  if (scopes.some((s) => s.endsWith(':write'))) return 'editor';
  return 'viewer';
}

function toAuthContext(tc: TokenContext): AuthContext {
  return {
    userId: tc.userId ?? '',
    workspaceId: tc.workspaceId,
    role: roleFromScopes(tc.scopes),
  };
}

/**
 * Authenticate an /api/v1 request by bearer token (api_key OR pat). Returns
 * the v0.5 AuthContext shape so requireRole/requirePageAccess work unchanged.
 * Throws HttpError(401) on any failure.
 *
 * New routes (MCP / dev-settings) should call resolveToken directly to get
 * the full TokenContext (scopes + mcpTools + kind + tokenId).
 */
export async function requireApiAuth(req: Request): Promise<AuthContext> {
  const tc = await resolveToken(req.headers.get('authorization'));
  if (!tc) throw new HttpError(401, 'Missing, invalid, or expired token');
  return toAuthContext(tc);
}
