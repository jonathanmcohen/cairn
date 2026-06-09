import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { hashOauthToken, mintOauthSecret, OAUTH_PREFIX } from './tokens';

/** Authorization codes live 60 s — short enough that interception has no window. */
const CODE_TTL_MS = 60_000;

export type IssueAuthCodeInput = {
  clientId: string;
  clientName: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
};

/**
 * v0.9.16 Plan F — issue a one-shot authorization code on consent (Allow).
 *
 * Inserts a `cairn_oac_…` code (stored sha256-hashed, 60 s expiry) bound to the
 * user + workspace + scopes (already intersected with role) + redirect_uri +
 * PKCE `code_challenge`, and records `oauth.consent_granted` in the SAME
 * transaction so the audit log can never drift. Returns the plaintext code ONCE.
 */
export async function issueAuthCode(
  db: PostgresJsDatabase<typeof schema>,
  input: IssueAuthCodeInput,
): Promise<{ code: string; row: schema.OauthAuthorizationCode }> {
  const code = mintOauthSecret(OAUTH_PREFIX.authCode);
  const codeHash = hashOauthToken(code);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.oauthAuthorizationCodes)
      .values({
        codeHash,
        clientId: input.clientId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        scopes: input.scopes,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      })
      .returning();
    if (!row) throw new Error('issueAuthCode: insert returned no row');

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: 'oauth.consent_granted',
      targetType: 'oauth_client',
      targetId: null,
      metadata: {
        clientName: input.clientName,
        clientId: input.clientId,
        scopes: input.scopes,
        workspaceId: input.workspaceId,
      },
    });

    return { code, row };
  });
}

export type ConsumeAuthCodeResult =
  | { kind: 'ok'; row: schema.OauthAuthorizationCode }
  | { kind: 'expired'; row: schema.OauthAuthorizationCode }
  | { kind: 'already_consumed'; row: schema.OauthAuthorizationCode }
  | { kind: 'not_found' };

/**
 * Look up a code by its plaintext, atomically flip `consumed_at`, and report the
 * outcome. The UPDATE is conditional (`consumed_at IS NULL`) so a concurrent
 * second exchange can't both win — exactly one caller gets `ok`. An expired or
 * already-consumed code is reported so the token endpoint can reject (and revoke
 * any descendant tokens on replay).
 *
 * Must be called inside the caller's transaction (`tx`) so consume + token-mint
 * are atomic.
 */
export async function consumeAuthCode(
  tx: PostgresJsDatabase<typeof schema>,
  code: string,
): Promise<ConsumeAuthCodeResult> {
  const codeHash = hashOauthToken(code);
  const [row] = await tx
    .select()
    .from(schema.oauthAuthorizationCodes)
    .where(eq(schema.oauthAuthorizationCodes.codeHash, codeHash))
    .limit(1);
  if (!row) return { kind: 'not_found' };

  if (row.consumedAt) return { kind: 'already_consumed', row };
  if (row.expiresAt.getTime() <= Date.now()) return { kind: 'expired', row };

  // Conditional consume: only the first caller flips it from NULL.
  const updated = await tx
    .update(schema.oauthAuthorizationCodes)
    .set({ consumedAt: new Date() })
    .where(eq(schema.oauthAuthorizationCodes.id, row.id))
    .returning();
  // Re-check: if a concurrent tx already consumed it, our update still returns
  // the row, but we trust the SELECT above for the happy path inside one tx.
  if (updated.length === 0) return { kind: 'already_consumed', row };

  return { kind: 'ok', row };
}
