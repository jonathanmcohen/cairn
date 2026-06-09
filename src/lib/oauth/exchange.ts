import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { consumeAuthCode } from './codes';
import { verifyPkceS256 } from './pkce';
import { hashOauthToken, mintOauthSecret, OAUTH_PREFIX } from './tokens';

const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 h
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 d

export type ExchangeError =
  | { kind: 'invalid_grant'; description: string }
  | { kind: 'invalid_request'; description: string };

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
  row: schema.OauthToken;
};

export type CodeToTokensInput = {
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string | null;
};

/**
 * v0.9.16 Plan F — authorization-code → token exchange (RFC 6749 §4.1.3 + PKCE).
 *
 * In ONE transaction: consume the one-shot code (flip `consumed_at`), verify it
 * binds to this client + redirect_uri, verify PKCE (`code_verifier` hashes to the
 * stored S256 challenge), then mint + insert an `oauth_tokens` row (access +
 * refresh, both sha256-hashed) and record `oauth.token_issued`.
 *
 * Replay defense: a code already `consumed_at` returns `invalid_grant` AND any
 * tokens already issued from it are revoked (a captured-then-replayed code can
 * never yield a live token).
 */
export async function codeToTokens(
  db: PostgresJsDatabase<typeof schema>,
  input: CodeToTokensInput,
): Promise<IssuedTokens | ExchangeError> {
  if (!input.codeVerifier) {
    return { kind: 'invalid_request', description: 'code_verifier is required (PKCE)' };
  }

  return db.transaction(async (tx) => {
    const consumed = await consumeAuthCode(tx, input.code);

    if (consumed.kind === 'not_found') {
      return { kind: 'invalid_grant', description: 'unknown authorization code' };
    }
    if (consumed.kind === 'expired') {
      return { kind: 'invalid_grant', description: 'authorization code expired' };
    }
    if (consumed.kind === 'already_consumed') {
      // Replay defense (RFC 6749 §10.5): a code seen twice means it may have been
      // intercepted. Revoke any tokens descended from this exact grant — same
      // client + user + workspace — so a captured-then-replayed code can never
      // yield (or keep) a live token. Scoped to the grant, not the whole user.
      const code = consumed.row;
      await tx
        .update(schema.oauthTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.oauthTokens.userId, code.userId),
            eq(schema.oauthTokens.clientId, code.clientId),
            eq(schema.oauthTokens.workspaceId, code.workspaceId),
          ),
        );
      return { kind: 'invalid_grant', description: 'authorization code already used' };
    }

    const code = consumed.row;

    // Bind checks: same client + exact redirect_uri the code was issued for.
    if (code.clientId !== input.clientId) {
      return { kind: 'invalid_grant', description: 'client_id mismatch' };
    }
    if (code.redirectUri !== input.redirectUri) {
      return { kind: 'invalid_grant', description: 'redirect_uri mismatch' };
    }

    // PKCE: the presented verifier must hash to the bound S256 challenge.
    if (!verifyPkceS256(input.codeVerifier as string, code.codeChallenge)) {
      return { kind: 'invalid_grant', description: 'PKCE verification failed' };
    }

    const accessToken = mintOauthSecret(OAUTH_PREFIX.accessToken);
    const refreshToken = mintOauthSecret(OAUTH_PREFIX.refreshToken);
    const now = Date.now();

    const [row] = await tx
      .insert(schema.oauthTokens)
      .values({
        accessTokenHash: hashOauthToken(accessToken),
        refreshTokenHash: hashOauthToken(refreshToken),
        clientId: code.clientId,
        userId: code.userId,
        workspaceId: code.workspaceId,
        scopes: code.scopes,
        accessExpiresAt: new Date(now + ACCESS_TTL_MS),
        refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
      })
      .returning();
    if (!row) throw new Error('codeToTokens: insert returned no row');

    await recordAudit(tx, {
      workspaceId: code.workspaceId,
      actorUserId: code.userId,
      action: 'oauth.token_issued',
      targetType: 'oauth_token',
      targetId: row.id,
      metadata: {
        clientId: code.clientId,
        scopes: code.scopes,
        grant: 'authorization_code',
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
      scopes: code.scopes,
      row,
    };
  });
}

export type RefreshTokensInput = {
  refreshToken: string;
  clientId: string;
};

/**
 * v0.9.16 Plan F — refresh-token grant with ROTATION (Task 7).
 *
 * Look up the active (non-revoked, unexpired) token row by refresh-token hash.
 * In one transaction: revoke the old row (`revoked_at = now()`) and insert a
 * fresh row with the SAME scopes (no escalation) + new access/refresh hashes,
 * then record `oauth.token_issued`. The presented (old) refresh token is now
 * single-use — a replay of it finds a revoked row and returns `invalid_grant`.
 */
export async function refreshTokens(
  db: PostgresJsDatabase<typeof schema>,
  input: RefreshTokensInput,
): Promise<IssuedTokens | ExchangeError> {
  const refreshHash = hashOauthToken(input.refreshToken);

  return db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(schema.oauthTokens)
      .where(
        and(
          eq(schema.oauthTokens.refreshTokenHash, refreshHash),
          isNull(schema.oauthTokens.revokedAt),
        ),
      )
      .limit(1);

    if (!old) {
      return { kind: 'invalid_grant', description: 'unknown or revoked refresh token' };
    }
    if (old.clientId !== input.clientId) {
      return { kind: 'invalid_grant', description: 'client_id mismatch' };
    }
    if (old.refreshExpiresAt && old.refreshExpiresAt.getTime() <= Date.now()) {
      return { kind: 'invalid_grant', description: 'refresh token expired' };
    }

    // Rotate: revoke the presented row first so a concurrent replay can't also
    // win (the WHERE is guarded by isNull(revoked_at)).
    const revoked = await tx
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.oauthTokens.id, old.id), isNull(schema.oauthTokens.revokedAt)))
      .returning();
    if (revoked.length === 0) {
      return { kind: 'invalid_grant', description: 'refresh token already used' };
    }

    const accessToken = mintOauthSecret(OAUTH_PREFIX.accessToken);
    const refreshToken = mintOauthSecret(OAUTH_PREFIX.refreshToken);
    const now = Date.now();

    const [row] = await tx
      .insert(schema.oauthTokens)
      .values({
        accessTokenHash: hashOauthToken(accessToken),
        refreshTokenHash: hashOauthToken(refreshToken),
        clientId: old.clientId,
        userId: old.userId,
        workspaceId: old.workspaceId,
        // Same scopes — refresh can NEVER widen the grant.
        scopes: old.scopes,
        accessExpiresAt: new Date(now + ACCESS_TTL_MS),
        refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
      })
      .returning();
    if (!row) throw new Error('refreshTokens: insert returned no row');

    await recordAudit(tx, {
      workspaceId: old.workspaceId,
      actorUserId: old.userId,
      action: 'oauth.token_issued',
      targetType: 'oauth_token',
      targetId: row.id,
      metadata: { clientId: old.clientId, scopes: old.scopes, grant: 'refresh_token' },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
      scopes: old.scopes,
      row,
    };
  });
}

export type RevokeTokenInput = {
  token: string;
  /** RFC 7009 hint — we match by access OR refresh hash regardless. */
  tokenTypeHint?: string | null;
};

/**
 * v0.9.16 Plan F — RFC 7009 revocation (Task 8). Matches a row by access OR
 * refresh hash and sets `revoked_at`. Records `oauth.token_revoked` ONLY on a
 * real hit (an unknown token is a silent 200 per RFC 7009, no audit row).
 * Returns true if a row was revoked.
 */
export async function revokeToken(
  db: PostgresJsDatabase<typeof schema>,
  input: RevokeTokenInput,
): Promise<boolean> {
  const hash = hashOauthToken(input.token);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.accessTokenHash, hash))
      .limit(1);

    let target = row;
    if (!target) {
      const [byRefresh] = await tx
        .select()
        .from(schema.oauthTokens)
        .where(eq(schema.oauthTokens.refreshTokenHash, hash))
        .limit(1);
      target = byRefresh;
    }

    if (!target) return false;
    if (target.revokedAt) {
      // Already revoked — idempotent, no new audit row.
      return true;
    }

    await tx
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.oauthTokens.id, target.id));

    await recordAudit(tx, {
      workspaceId: target.workspaceId,
      actorUserId: target.userId,
      action: 'oauth.token_revoked',
      targetType: 'oauth_token',
      targetId: target.id,
      metadata: { clientId: target.clientId },
    });

    return true;
  });
}
