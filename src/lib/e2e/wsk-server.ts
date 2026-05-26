import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { userKeypairs, workspaceEncryptionKeys, workspaceMembers } from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type WrappedForMember = { memberUserId: string; wrappedWsk: string };

/**
 * v0.9.0 G1 P7 — server-side WSK helpers.
 *
 * The server NEVER sees the unwrapped workspace-key (WSK). It only validates
 * that a roster of wrapped WSKs covers every current workspace member exactly
 * once, and that each named member has a registered keypair to wrap against.
 *
 * Returning `{ok: false, status, error}` lets callers translate validation
 * failures into HTTP responses without throwing — keeping the route handler
 * shape uniform.
 */
export async function assertCoverageAndKeypairs(
  db: Db,
  workspaceId: string,
  wrapped: WrappedForMember[],
): Promise<{ ok: true } | { ok: false; status: 400 | 409; error: string }> {
  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const memberIds = new Set(members.map((m) => m.userId));
  const payloadIds = new Set(wrapped.map((w) => w.memberUserId));
  if (
    memberIds.size !== payloadIds.size ||
    ![...memberIds].every((id) => payloadIds.has(id)) ||
    wrapped.length !== payloadIds.size
  ) {
    return {
      ok: false,
      status: 400,
      error: 'wrapped WSKs must cover every workspace member exactly once',
    };
  }
  if (memberIds.size === 0) {
    // Defensive: an empty workspace has nothing to encrypt.
    return { ok: false, status: 400, error: 'workspace has no members' };
  }
  const keypairs = await db
    .select({ userId: userKeypairs.userId })
    .from(userKeypairs)
    .where(inArray(userKeypairs.userId, [...memberIds]));
  if (keypairs.length !== memberIds.size) {
    return { ok: false, status: 409, error: 'one or more members have no registered keypair' };
  }
  return { ok: true };
}

/**
 * Current workspace key version. 0 if no wrapped-WSK rows exist yet (pre-enable).
 * Used by /wrap-for-member to confirm the caller's row is current, and by
 * /rekey to compute the next version.
 */
export async function getCurrentKeyVersion(db: Db, workspaceId: string): Promise<number> {
  const rows = await db
    .select({ v: workspaceEncryptionKeys.keyVersion })
    .from(workspaceEncryptionKeys)
    .where(eq(workspaceEncryptionKeys.workspaceId, workspaceId))
    .limit(1);
  return rows[0]?.v ?? 0;
}
