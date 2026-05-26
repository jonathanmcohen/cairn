import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Visible token format: prefix + 32 random bytes hex. Hashed via SHA-256 hex. */
const PREFIX = 'cairn_scim_';

export function mintScimToken(): { raw: string; hash: string } {
  const body = randomBytes(32).toString('hex');
  const raw = `${PREFIX}${body}`;
  return { raw, hash: hashScimToken(raw) };
}

export function hashScimToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export type VerifiedScimToken = {
  workspaceId: string;
  scopes: string[];
  tokenId: string;
};

/**
 * Verify a bearer token. Returns the (workspace, scopes, id) on match, null
 * otherwise. On match, updates `last_used_at` to NOW so admins can see token
 * activity in the dashboard. Hash comparison is constant-time via
 * `timingSafeEqual` over the equal-length hex strings.
 */
export async function verifyScimToken(
  db: Db,
  rawFromHeader: string,
): Promise<VerifiedScimToken | null> {
  if (!rawFromHeader.startsWith(PREFIX)) return null;
  const targetHash = hashScimToken(rawFromHeader);

  // Single indexed lookup by token_hash (unique index from P1). The
  // timingSafeEqual call here is belt-and-suspenders — the DB lookup already
  // returns at most one row, but verifying the comparison is safe-by-shape
  // protects against any future change to the lookup strategy.
  const [row] = await db
    .select()
    .from(schema.scimTokens)
    .where(eq(schema.scimTokens.tokenHash, targetHash))
    .limit(1);
  if (!row) return null;
  const a = Buffer.from(row.tokenHash, 'hex');
  const b = Buffer.from(targetHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  await db
    .update(schema.scimTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.scimTokens.id, row.id));

  return { workspaceId: row.workspaceId, scopes: row.scopes ?? [], tokenId: row.id };
}
