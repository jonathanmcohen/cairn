import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

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
