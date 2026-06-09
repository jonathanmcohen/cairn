import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * v0.9.16 Plan F — OAuth secret minting + hashing. Mirrors the PAT helpers
 * (`src/lib/auth/pat.ts`) exactly: 32 random bytes → base64url, sha256-hex at
 * rest, constant-time verify. Reusing the `cairn_` namespace keeps every secret
 * tripping the audit-leak guard (`FORBIDDEN_SUBSTRINGS`).
 *
 * Prefixes (all SHA-256 hashed at rest, never stored plaintext):
 *   cairn_oac_   authorization code (60 s, one-shot)
 *   cairn_oauth_ access token (1 h)        ← the only one resolveToken dispatches on
 *   cairn_oart_  refresh token (30 d, rotated)
 *   cairn_ocs_   client secret (confidential clients only)
 */
const SECRET_BYTES = 32; // 32 random bytes → 43-char base64url

export const OAUTH_PREFIX = {
  authCode: 'cairn_oac_',
  accessToken: 'cairn_oauth_',
  refreshToken: 'cairn_oart_',
  clientSecret: 'cairn_ocs_',
} as const;

/** Mint a `<prefix><base64url>` plaintext secret. Returned ONCE, never recoverable. */
export function mintOauthSecret(prefix: string): string {
  return prefix + randomBytes(SECRET_BYTES).toString('base64url');
}

/** sha256-hex of the full plaintext secret. We never store the plaintext. */
export function hashOauthToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time compare a candidate secret against a stored sha256-hex hash. */
export function verifyOauthToken(secret: string, storedHash: string): boolean {
  const candidate = hashOauthToken(secret);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Context shape an OAuth access token resolves to — parallel to PatContext. */
export type OauthContext = {
  kind: 'oauth';
  tokenId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  mcpTools: string[];
};

/**
 * v0.9.16 Plan F — resolve a `cairn_oauth_…` access token to an OauthContext.
 *
 * Mirrors `verifyPatToken` (`src/lib/auth/pat.ts`): hash the presented token,
 * look up the active (non-revoked) row, reject if the access token is expired,
 * stamp `last_used_at` fire-and-forget, and return the context. Returns null on
 * any failure (wrong prefix, unknown hash, revoked, expired).
 *
 * `mcpTools` is empty: OAuth grants gate MCP access by the `mcp:*` scope alone
 * (the per-tool allowlist is a PAT-only refinement), so the MCP dispatcher's
 * scope-driven tool filtering applies unchanged.
 */
export async function verifyOauthAccessToken(
  db: PostgresJsDatabase<typeof schema>,
  token: string,
): Promise<OauthContext | null> {
  if (!token.startsWith(OAUTH_PREFIX.accessToken)) return null;
  const accessHash = hashOauthToken(token);

  const [row] = await db
    .select()
    .from(schema.oauthTokens)
    .where(
      and(eq(schema.oauthTokens.accessTokenHash, accessHash), isNull(schema.oauthTokens.revokedAt)),
    )
    .limit(1);
  if (!row) return null;
  if (row.accessExpiresAt.getTime() <= Date.now()) return null;

  // Fire-and-forget last-used stamp — never block the request (same as PATs).
  void db
    .update(schema.oauthTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.oauthTokens.id, row.id))
    .catch(() => {
      /* swallowed: stale lastUsedAt is acceptable */
    });

  return {
    kind: 'oauth',
    tokenId: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    scopes: row.scopes,
    mcpTools: [],
  };
}
