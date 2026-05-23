import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

const TOKEN_PREFIX = 'cairn_pat_';
const SECRET_BYTES = 32; // 32 random bytes → 43-char base64url → ample entropy
const DISPLAY_PREFIX_LEN = TOKEN_PREFIX.length + 4; // e.g. 'cairn_pat_abcd'

/** sha256 hex of the full plaintext token. We never store the plaintext. */
export function hashPat(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time compare a candidate secret against a stored hash. */
export function verifyPat(secret: string, storedHash: string): boolean {
  const candidate = hashPat(secret);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type MintPatInput = {
  userId: string;
  workspaceId: string;
  name: string;
  scopes: string[];
  mcpTools: string[];
  expiresAt: Date | null;
};

/**
 * Mint a new PAT. Generates a `cairn_pat_<base64url>` plaintext token, persists
 * the SHA-256 hash + a 4-char display prefix + scopes + MCP-tool allowlist, and
 * returns the plaintext ONCE (never recoverable after).
 *
 * The insert + `recordAudit('pat.created')` happen inside one transaction
 * (v0.7.0 G1 P5) so the audit can never drift from the action. Audit metadata
 * records `{name, scopes, mcpTools, expiresAt}` only — never the plaintext
 * token, tokenHash, or tokenPrefix (the prefix's `cairn_pat_` substring is in
 * FORBIDDEN_SUBSTRINGS and would trip `assertAuditMetadataClean`).
 */
export async function mintPat(
  db: PostgresJsDatabase<typeof schema>,
  input: MintPatInput,
): Promise<{ token: string; row: schema.PersonalAccessToken }> {
  const secret = randomBytes(SECRET_BYTES).toString('base64url'); // 43 chars
  const token = TOKEN_PREFIX + secret;
  const tokenHash = hashPat(token);
  const tokenPrefix = token.slice(0, DISPLAY_PREFIX_LEN);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.personalAccessTokens)
      .values({
        userId: input.userId,
        workspaceId: input.workspaceId,
        name: input.name,
        tokenHash,
        tokenPrefix,
        scopes: input.scopes,
        mcpTools: input.mcpTools,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error('mintPat: insert returned no row');

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: 'pat.created',
      targetType: 'personal_access_token',
      targetId: row.id,
      metadata: {
        name: input.name,
        scopes: input.scopes,
        mcpTools: input.mcpTools,
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
      },
    });

    return { token, row };
  });
}

/** Shape returned by `verifyPatToken` — superset of the v0.5 AuthContext. */
export type PatContext = {
  kind: 'pat';
  tokenId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  mcpTools: string[];
};

/**
 * Hash an incoming token, look up the matching PAT row, reject revoked/expired,
 * stamp `last_used_at` fire-and-forget, and resolve to a PatContext. Returns
 * null for any failure (wrong prefix, unknown hash, revoked, expired).
 */
export async function verifyPatToken(
  db: PostgresJsDatabase<typeof schema>,
  token: string,
): Promise<PatContext | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = hashPat(token);

  const [row] = await db
    .select()
    .from(schema.personalAccessTokens)
    .where(
      and(
        eq(schema.personalAccessTokens.tokenHash, tokenHash),
        isNull(schema.personalAccessTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  // Fire-and-forget: never block the request on this UPDATE. Same pattern as
  // v0.5 verifyKey (src/lib/api/keys.ts) — explicit `void` to flag intent.
  void db
    .update(schema.personalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.personalAccessTokens.id, row.id))
    .catch(() => {
      /* swallowed: stale lastUsedAt is acceptable */
    });

  return {
    kind: 'pat',
    tokenId: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    scopes: row.scopes,
    mcpTools: row.mcpTools,
  };
}
