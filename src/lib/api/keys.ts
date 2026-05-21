import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
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
 */
export async function mintKey(
  db: PostgresJsDatabase<typeof schema>,
  input: MintInput,
): Promise<{ token: string; key: schema.ApiKey }> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('hex'); // 64 hex chars
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, TOKEN_PREFIX.length + 4); // e.g. 'cairn_sk_ab12'

  const [key] = await db
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
  return { token, key };
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
