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
      //
      // v0.10.0 G3 SCOPE NOTE (plan-pinned): this code-reuse blanket is
      // deliberately BROADER than refresh-token-reuse family revocation below.
      // A replayed code can't tell us which descendant chain the attacker got,
      // so every sibling grant for user+client+workspace dies. A replayed
      // refresh token names its exact rotation chain via family_id, so only
      // that family dies (see revokeTokenFamilyOnReuse). Do not "unify" them.
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
 * v0.10.0 G3 — refresh-token REUSE response: revoke the presented row's entire
 * rotation family (every non-revoked descendant of the same grant) and record
 * `oauth.token_family_revoked`. A revoked refresh token can only be presented
 * by (a) an attacker replaying a captured token after the legitimate client
 * rotated, or (b) the legitimate client replaying after an attacker rotated —
 * either way SOMEONE other than the row's holder has the secret, so the whole
 * chain is burned (RFC 6749 §10.4 / OAuth 2.1 rotation guidance).
 *
 * The audit insert runs in a SAVEPOINT (nested transaction) and any failure is
 * swallowed: an audit hiccup must neither mask the invalid_grant response nor
 * roll back the family revocation. Metadata carries ids only — never token
 * material (assertAuditMetadataClean would throw on a `cairn_oart_` leak).
 */
async function revokeTokenFamilyOnReuse(
  tx: PostgresJsDatabase<typeof schema>,
  old: schema.OauthToken,
): Promise<ExchangeError> {
  await tx
    .update(schema.oauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.oauthTokens.familyId, old.familyId), isNull(schema.oauthTokens.revokedAt)),
    );

  try {
    await tx.transaction(async (sp) => {
      await recordAudit(sp, {
        workspaceId: old.workspaceId,
        actorUserId: old.userId,
        action: 'oauth.token_family_revoked',
        targetType: 'oauth_token',
        targetId: old.id,
        metadata: {
          reason: 'refresh_token_reuse',
          familyId: old.familyId,
          clientId: old.clientId,
        },
      });
    });
  } catch {
    // Swallowed on purpose: the security response (family revoked +
    // invalid_grant) must not depend on the audit insert succeeding.
  }

  // Deliberately descriptive: the legitimate client learns WHY it got logged
  // out (re-authorize from scratch); an attacker already knows.
  return {
    kind: 'invalid_grant',
    description: 'refresh token reuse detected; token family revoked',
  };
}

/**
 * v0.9.16 Plan F — refresh-token grant with ROTATION (Task 7).
 *
 * Look up the token row by refresh-token hash (revoked or not — v0.10.0 G3).
 * In one transaction: revoke the old row (`revoked_at = now()`) and insert a
 * fresh row with the SAME scopes (no escalation) + new access/refresh hashes,
 * then record `oauth.token_issued`. The presented (old) refresh token is now
 * single-use.
 *
 * v0.10.0 G3 — reuse detection: a presented hash that matches a REVOKED row is
 * a replay of an already-rotated token. That revokes the row's whole rotation
 * family (see revokeTokenFamilyOnReuse). Only a hash with no row at all keeps
 * the generic "unknown or revoked refresh token" answer.
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
      .where(eq(schema.oauthTokens.refreshTokenHash, refreshHash))
      .limit(1);

    if (!old) {
      return { kind: 'invalid_grant', description: 'unknown or revoked refresh token' };
    }
    if (old.revokedAt) {
      // REUSE DETECTED: this exact token was already rotated (or revoked).
      // Possession of the plaintext is the signal — no client/expiry checks
      // soften it. Burn the family.
      return revokeTokenFamilyOnReuse(tx, old);
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
      // v0.10.0 G3 — concurrent-replay loser: between our SELECT (row active)
      // and this guarded UPDATE, another request rotated the same token. Two
      // requests racing one refresh token is ALSO a reuse signal — strictly it
      // could be the same client double-submitting, but we cannot distinguish
      // that from an attacker racing the legitimate client, so the
      // conservative, plan-pinned choice is to treat it as reuse and revoke
      // the family (including the racing winner's freshly minted pair).
      return revokeTokenFamilyOnReuse(tx, old);
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
        // v0.10.0 G3 — rotation stays in the SAME family; only the auth-code
        // exchange starts a new one (it omits familyId → DB default).
        familyId: old.familyId,
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
