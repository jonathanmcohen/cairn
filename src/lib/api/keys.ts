import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import type { AuthContext, MemberRole } from '@/lib/auth/require-role';

const TOKEN_PREFIX = 'cairn_sk_';

/** sha256 hex of the full plaintext token. We never store the plaintext. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type MintInput = {
  workspaceId: string;
  name: string;
  role: MemberRole;
  createdBy: string;
  expiresAt?: Date | null;
};

/**
 * Generate a `cairn_sk_<32 hex>` token, persist its sha256 hash + a short
 * display prefix, and return the plaintext ONCE (never recoverable after).
 *
 * The insert + the `api_key.created` audit row are written in a single
 * transaction so the audit can never drift from the action (spec §2.27).
 * Audit metadata records only `{name, role}` — the plaintext token,
 * `tokenPrefix` (which starts with the forbidden `cairn_sk_` substring),
 * and the hash are deliberately NEVER recorded.
 */
export async function mintKey(
  db: PostgresJsDatabase<typeof schema>,
  input: MintInput,
): Promise<{ token: string; key: schema.ApiKey }> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('hex'); // 64 hex chars
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, TOKEN_PREFIX.length + 4); // e.g. 'cairn_sk_ab12'

  return db.transaction(async (tx) => {
    const [key] = await tx
      .insert(schema.apiKeys)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        tokenHash,
        tokenPrefix,
        role: input.role,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    if (!key) throw new Error('failed to mint API key');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.createdBy,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: key.id,
      metadata: { name: input.name, role: input.role },
    });
    return { token, key };
  });
}

export type RevokeKeyErrorCode = 'NOT_FOUND';

export class RevokeKeyError extends Error {
  constructor(
    public code: RevokeKeyErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'RevokeKeyError';
  }
}

/**
 * Revoke (delete) an API key scoped to a workspace. The delete + the
 * `api_key.revoked` audit row are written in a single transaction so the
 * audit can never drift from the action. Cross-workspace ids throw
 * `NOT_FOUND` so we don't leak existence.
 */
export async function revokeKey(
  db: PostgresJsDatabase<typeof schema>,
  input: { workspaceId: string; keyId: string; actorUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.apiKeys)
      .where(
        and(eq(schema.apiKeys.id, input.keyId), eq(schema.apiKeys.workspaceId, input.workspaceId)),
      )
      .returning({ id: schema.apiKeys.id, name: schema.apiKeys.name, role: schema.apiKeys.role });
    if (deleted.length === 0) throw new RevokeKeyError('NOT_FOUND');
    const [row] = deleted;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'api_key.revoked',
      targetType: 'api_key',
      targetId: row?.id ?? input.keyId,
      metadata: { name: row?.name ?? null, role: row?.role ?? null },
    });
  });
}

/**
 * Hash an incoming token, look up the matching key, reject expired keys,
 * stamp last_used_at, and resolve to an AuthContext (identical shape to
 * getAuthContext) so requireRole/requirePageAccess work unchanged.
 */
export async function verifyKey(
  db: PostgresJsDatabase<typeof schema>,
  token: string,
): Promise<AuthContext | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(token);

  // token_hash is UNIQUE + indexed; the lookup is by hash, never by plaintext.
  const [row] = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id));

  return { userId: row.createdBy, workspaceId: row.workspaceId, role: row.role as MemberRole };
}
