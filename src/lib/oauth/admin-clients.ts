import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { isValidRedirectUri, type RegisterClientResult, registerClient } from '@/lib/oauth/clients';
import { hashOauthToken, mintOauthSecret, OAUTH_PREFIX } from '@/lib/oauth/tokens';

/**
 * v0.10.0 D3 — admin registry over RFC 7591 dynamically-registered OAuth
 * clients. Registration (`POST /api/oauth/register`) is unauthenticated by
 * design, so the instance accumulates client rows nobody can see or remove —
 * this module is the operator-facing inventory + purge.
 *
 * oauth_clients rows are INSTANCE-level (no workspace column — registration
 * happens before any user signs in). The admin surface is still gated on the
 * caller being admin/owner of their active workspace, same posture as the
 * backups/SIEM admin routes.
 */

export type RegisteredClientSummary = {
  /** oauth_clients.id — the uuid primary key the DELETE route addresses. */
  id: string;
  /** Public RFC 6749 client identifier (looked up at /authorize and /token). */
  clientId: string;
  name: string;
  redirectUris: string[];
  /** True when a client_secret hash is stored (confidential client); false = public PKCE client. */
  confidential: boolean;
  createdAt: Date;
  /** oauth_tokens rows for this client with revoked_at IS NULL. */
  activeGrants: number;
  /** All oauth_tokens rows ever issued to this client (incl. revoked/rotated). */
  totalGrants: number;
};

/** List ALL registered clients with per-client grant counts (newest first). */
export async function listRegisteredClients(
  db: PostgresJsDatabase<typeof schema>,
): Promise<RegisteredClientSummary[]> {
  // One LEFT JOIN + GROUP BY pass: counting both totals and the active subset
  // via FILTER keeps this a single index-friendly query instead of N+1 counts.
  return db
    .select({
      id: schema.oauthClients.id,
      clientId: schema.oauthClients.clientId,
      name: schema.oauthClients.clientName,
      redirectUris: schema.oauthClients.redirectUris,
      confidential: sql<boolean>`(${schema.oauthClients.clientSecretHash} is not null)`,
      createdAt: schema.oauthClients.createdAt,
      activeGrants: sql<number>`count(${schema.oauthTokens.id}) filter (where ${schema.oauthTokens.revokedAt} is null)::int`,
      totalGrants: sql<number>`count(${schema.oauthTokens.id})::int`,
    })
    .from(schema.oauthClients)
    .leftJoin(schema.oauthTokens, eq(schema.oauthTokens.clientId, schema.oauthClients.clientId))
    .groupBy(schema.oauthClients.id)
    .orderBy(desc(schema.oauthClients.createdAt));
}

export type DeleteRegisteredClientInput = {
  /** oauth_clients.id (uuid primary key), NOT the public client_id. */
  id: string;
  actorUserId: string;
  /** The actor's active workspace — audit_log.workspace_id is NOT NULL. */
  workspaceId: string;
};

export type DeleteRegisteredClientResult = {
  clientId: string;
  name: string;
  /** Count of previously-active oauth_tokens rows revoked by this delete. */
  revokedGrants: number;
};

/**
 * Delete a registered client AND revoke every token issued to it, in one
 * transaction. Tokens are soft-revoked (`revoked_at = now()`) — the same
 * pattern as RFC 7009 revocation and refresh rotation (`src/lib/oauth/
 * exchange.ts`), so `verifyOauthAccessToken`'s `isNull(revoked_at)` guard
 * rejects them immediately. Rows are kept for the audit trail.
 *
 * Writes an `oauth.client_deleted` audit row (metadata: public client_id +
 * name + revoked-grant count — ids and counts only, never a secret).
 *
 * Returns null when no client row matches `id` (caller answers 404).
 */
export async function deleteRegisteredClient(
  db: PostgresJsDatabase<typeof schema>,
  input: DeleteRegisteredClientInput,
): Promise<DeleteRegisteredClientResult | null> {
  return db.transaction(async (tx) => {
    const [client] = await tx
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.id, input.id))
      .limit(1);
    if (!client) return null;

    const revoked = await tx
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(schema.oauthTokens.clientId, client.clientId), isNull(schema.oauthTokens.revokedAt)),
      )
      .returning({ id: schema.oauthTokens.id });

    await tx.delete(schema.oauthClients).where(eq(schema.oauthClients.id, client.id));

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'oauth.client_deleted',
      targetType: 'oauth_client',
      targetId: client.id,
      metadata: {
        clientId: client.clientId,
        name: client.clientName,
        revokedGrants: revoked.length,
      },
    });

    return {
      clientId: client.clientId,
      name: client.clientName,
      revokedGrants: revoked.length,
    };
  });
}

/**
 * Post-v0.10.0 — MANUAL client provisioning. The instance runs on a LAN where
 * some MCP clients can't reach (or don't speak) RFC 7591 dynamic registration,
 * so an admin mints client_id/client_secret pairs by hand and pastes them into
 * the client's config. This is a thin admin-authed wrapper over the SAME
 * `registerClient` core the open registration endpoint uses — identical id
 * minting, secret hashing, and redirect-URI posture; only the caller differs.
 */

export const MANUAL_CLIENT_NAME_MAX = 100;
export const MANUAL_CLIENT_MAX_REDIRECT_URIS = 10;

export type CreateManualClientInput = {
  clientName: string;
  redirectUris: string[];
  confidential: boolean;
  createdBy?: string | null;
};

/** Typed validation failure — the route maps `kind` to a 400. */
export type ManualClientValidationError = {
  kind: 'invalid_client_name' | 'invalid_redirect_uris';
  description: string;
};

export type CreateManualClientResult = RegisterClientResult | ManualClientValidationError;

/**
 * Validate + create a manually-provisioned OAuth client. Returns the inserted
 * row plus the ONE-TIME plaintext secret (confidential clients only — public
 * PKCE clients get `clientSecret: null`). The plaintext is never persisted;
 * only its sha256 hash lands in `oauth_clients.client_secret_hash`.
 */
export async function createManualClient(
  db: PostgresJsDatabase<typeof schema>,
  input: CreateManualClientInput,
): Promise<CreateManualClientResult> {
  const name = input.clientName.trim();
  if (name.length < 1 || name.length > MANUAL_CLIENT_NAME_MAX) {
    return {
      kind: 'invalid_client_name',
      description: `client name must be 1..${MANUAL_CLIENT_NAME_MAX} characters`,
    };
  }
  if (
    input.redirectUris.length < 1 ||
    input.redirectUris.length > MANUAL_CLIENT_MAX_REDIRECT_URIS
  ) {
    return {
      kind: 'invalid_redirect_uris',
      description: `between 1 and ${MANUAL_CLIENT_MAX_REDIRECT_URIS} redirect URIs are required`,
    };
  }
  for (const uri of input.redirectUris) {
    if (!isValidRedirectUri(uri)) {
      // Same open-redirect guard as RFC 7591 registration: absolute http(s) only.
      return {
        kind: 'invalid_redirect_uris',
        description: `invalid redirect URI: ${uri} (must be an absolute http(s) URL)`,
      };
    }
  }

  return registerClient(db, {
    clientName: name,
    redirectUris: input.redirectUris,
    confidential: input.confidential,
    createdBy: input.createdBy ?? null,
  });
}

export type RotateClientSecretResult =
  | { kind: 'rotated'; row: schema.OauthClient; clientSecret: string }
  | { kind: 'not_found' }
  /** Public PKCE clients have no secret to rotate — typed rejection, not a throw. */
  | { kind: 'public_client' };

/**
 * Mint a fresh `cairn_ocs_` secret for a CONFIDENTIAL client and replace the
 * stored hash in one update. The old secret stops verifying immediately
 * (the token endpoint compares against `client_secret_hash`); already-issued
 * tokens are untouched — rotation changes how the client authenticates, not
 * what it was granted. The plaintext is returned ONCE and never persisted.
 *
 * `clientId` is the PUBLIC RFC 6749 client identifier (oauth_clients.client_id),
 * not the uuid primary key.
 */
export async function rotateClientSecret(
  db: PostgresJsDatabase<typeof schema>,
  clientId: string,
): Promise<RotateClientSecretResult> {
  const [client] = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1);
  if (!client) return { kind: 'not_found' };
  if (!client.clientSecretHash) return { kind: 'public_client' };

  const clientSecret = mintOauthSecret(OAUTH_PREFIX.clientSecret);
  const [row] = await db
    .update(schema.oauthClients)
    .set({ clientSecretHash: hashOauthToken(clientSecret) })
    .where(eq(schema.oauthClients.id, client.id))
    .returning();
  if (!row) return { kind: 'not_found' };

  return { kind: 'rotated', row, clientSecret };
}
