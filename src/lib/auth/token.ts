import { getDb } from '@/db/client';
import { verifyKey } from '@/lib/api/keys';
import { type PatContext, verifyPatToken } from '@/lib/auth/pat';
import { HttpError, type MemberRole } from '@/lib/auth/require-role';
import { verifyOauthAccessToken } from '@/lib/oauth/tokens';

const BEARER = /^Bearer\s+(\S+)$/i;

/** Unified token context — superset of the v0.5 AuthContext. */
export type TokenContext = {
  kind: 'api_key' | 'pat' | 'oauth';
  tokenId: string;
  userId?: string; // PAT carries the minting user; api_key carries createdBy
  workspaceId: string;
  scopes: string[];
  mcpTools: string[];
};

/**
 * Scope mapping for the v0.5 role-based api_keys path. PATs persist scopes
 * verbatim; api_keys synthesize them from their stored role at resolve time so
 * a single `requireScope` check works for both kinds.
 *
 * Mapping is intentionally cumulative (admin ⊇ editor ⊇ viewer).
 */
const ROLE_SCOPES: Record<MemberRole, string[]> = {
  viewer: ['pages:read', 'databases:read', 'comments:read', 'files:read'],
  editor: [
    'pages:read',
    'pages:write',
    'databases:read',
    'databases:write',
    'comments:read',
    'comments:write',
    'files:read',
    'files:write',
  ],
  admin: [
    'pages:read',
    'pages:write',
    'pages:destructive',
    'databases:read',
    'databases:write',
    'databases:destructive',
    'comments:read',
    'comments:write',
    'comments:destructive',
    'files:read',
    'files:write',
    'files:destructive',
    'admin',
  ],
  owner: [
    'pages:read',
    'pages:write',
    'pages:destructive',
    'databases:read',
    'databases:write',
    'databases:destructive',
    'comments:read',
    'comments:write',
    'comments:destructive',
    'files:read',
    'files:write',
    'files:destructive',
    'admin',
  ],
};

/**
 * Extract `Bearer <token>` and dispatch on the token prefix:
 * - `cairn_sk_*` → v0.5 api_keys (`verifyKey`), scopes derived from role.
 * - `cairn_pat_*` → new PATs (`verifyPatToken`), scopes stored verbatim.
 *
 * Returns null on any failure (missing header, wrong scheme, unknown prefix,
 * revoked/expired token). Routes turn null into `HttpError(401)` themselves.
 */
export async function resolveToken(
  authHeader: string | null | undefined,
): Promise<TokenContext | null> {
  if (!authHeader) return null;
  const match = BEARER.exec(authHeader.trim());
  const secret = match?.[1];
  if (!secret) return null;

  const db = getDb();

  if (secret.startsWith('cairn_pat_')) {
    const pat: PatContext | null = await verifyPatToken(db, secret);
    if (!pat) return null;
    return pat;
  }

  // v0.9.16 Plan F — OAuth access tokens resolve through the SAME enforcement
  // path as PATs (requireScope + the MCP mcp:* gate), so scope checks are
  // identical. Refresh tokens are NEVER presented here — only at /api/oauth/token.
  if (secret.startsWith('cairn_oauth_')) {
    const oauth = await verifyOauthAccessToken(db, secret);
    if (!oauth) return null;
    return oauth;
  }

  if (secret.startsWith('cairn_sk_')) {
    const ctx = await verifyKey(db, secret);
    if (!ctx) return null;
    if (!ctx.workspaceId || !ctx.role) return null;
    // v0.5 verifyKey returns AuthContext {userId, workspaceId, role}; widen.
    return {
      kind: 'api_key',
      // verifyKey doesn't surface the api_keys row id; the dispatcher doesn't
      // need it for routing (token_usage_log entries for api_keys use the
      // tokenHash→id lookup inside the usage logger, added by P5). Use a stable
      // sentinel here so the field is always present.
      tokenId: '',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      scopes: ROLE_SCOPES[ctx.role],
      mcpTools: [],
    };
  }

  return null;
}

/**
 * Throw HttpError(403) if `ctx.scopes` does not include `scope`. The `admin`
 * scope acts as a superset and bypasses per-resource scope checks.
 */
export function requireScope(ctx: TokenContext, scope: string): void {
  if (ctx.scopes.includes('admin')) return;
  if (ctx.scopes.includes(scope)) return;
  throw new HttpError(403, `Token missing required scope: ${scope}`);
}
