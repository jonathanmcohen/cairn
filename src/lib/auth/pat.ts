import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { checkQuota } from './pat-quota';

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
  // v0.9.0 G1 P9 — optional per-token quotas. `null`/omitted = no cap.
  dailyRequestLimit?: number | null;
  monthlyRequestLimit?: number | null;
  scopeRateLimits?: Record<string, { perMinute: number }> | null;
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
        dailyRequestLimit: input.dailyRequestLimit ?? null,
        monthlyRequestLimit: input.monthlyRequestLimit ?? null,
        scopeRateLimits: input.scopeRateLimits ?? null,
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

export type DispatchPatInput = {
  db: PostgresJsDatabase<typeof schema>;
  token: string;
  /** Canonical scope string e.g. `pages:read` — must match a value in `personal_access_tokens.scopes`. */
  scope: string;
};

export type DispatchPatResult =
  | { kind: 'ok'; tokenId: string; userId: string; workspaceId: string; scopes: string[]; mcpTools: string[] }
  | { kind: 'invalid' }
  | { kind: 'rate-limited'; response: Response };

/**
 * v0.9.0 G1 P9 — high-level PAT request dispatcher. Validates a `cairn_pat_*`
 * bearer token, enforces its scope, then runs the PAT quota check. Returns:
 *   - `{kind:'ok', ...}` when verified + scope OK + under quota.
 *   - `{kind:'invalid'}` when the token is unknown / revoked / expired / lacks the scope.
 *   - `{kind:'rate-limited', response}` with a 429 + `Retry-After` Response when
 *     the daily, monthly, or per-scope per-minute cap is hit.
 *
 * Routes should return `result.response` directly on `rate-limited` so the
 * client gets the standard 429. The response body is intentionally
 * `{error:'rate_limited', retryAfterSec}` — NEVER echo the configured cap.
 */
export async function dispatchPat(input: DispatchPatInput): Promise<DispatchPatResult> {
  const verified = await verifyPatToken(input.db, input.token);
  if (!verified) return { kind: 'invalid' };
  // Admin acts as a superset over per-scope checks (mirrors token.ts requireScope).
  const hasScope = verified.scopes.includes('admin') || verified.scopes.includes(input.scope);
  if (!hasScope) return { kind: 'invalid' };

  const quota = await checkQuota(input.db, verified.tokenId, input.scope);
  if (!quota.allowed) {
    const response = new Response(
      JSON.stringify({ error: 'rate_limited', retryAfterSec: quota.retryAfterSec }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(quota.retryAfterSec),
        },
      },
    );
    return { kind: 'rate-limited', response };
  }
  return {
    kind: 'ok',
    tokenId: verified.tokenId,
    userId: verified.userId,
    workspaceId: verified.workspaceId,
    scopes: verified.scopes,
    mcpTools: verified.mcpTools,
  };
}
