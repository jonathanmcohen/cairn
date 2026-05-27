import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type EffectiveRole = 'owner' | 'admin' | 'editor' | 'viewer';

/**
 * Role ranks for `requireSpaceAccess`. The space ACL chain uses
 * most-permissive-wins between the workspace role and the per-space role
 * (workspace owner/admin > space role > viewer-of-space). Mirrors the rank
 * table in `require-role.ts` so the values stay comparable.
 */
const RANK: Record<EffectiveRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

function maxRole(a: EffectiveRole | null, b: EffectiveRole | null): EffectiveRole | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export type SpaceAccessOk = { ok: true; role: EffectiveRole };
export type SpaceAccessErr = { ok: false; code: 'not_found' | 'forbidden' };
export type SpaceAccessResult = SpaceAccessOk | SpaceAccessErr;

export type RequireSpaceAccessInput = {
  spaceId: string;
  userId: string;
  /** The MINIMUM effective role required to pass; otherwise `forbidden`. */
  minRole: EffectiveRole;
  /** Optionally constrain to a specific workspace — used by route handlers
   *  that already know the active workspace context, so a space in another
   *  workspace returns `not_found` rather than leaking existence. */
  workspaceId?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the effective role for `(userId, spaceId)` and verify it meets
 * `minRole`. Returns `{ok:true, role}` when access is granted, or
 * `{ok:false, code:'not_found' | 'forbidden'}` otherwise.
 *
 * Existence-hiding (same as `requirePageAccess`):
 * - missing space → `not_found`
 * - space in another workspace (when `workspaceId` is provided) → `not_found`
 * - non-member of the owning workspace → `not_found`
 * - in-workspace but role too low → `forbidden`
 */
export async function requireSpaceAccess(
  db: PostgresJsDatabase<typeof schema>,
  input: RequireSpaceAccessInput,
): Promise<SpaceAccessResult> {
  // Treat a malformed UUID as not-found, matching the requirePageAccess shape.
  if (!UUID_RE.test(input.spaceId)) return { ok: false, code: 'not_found' };

  const [space] = await db
    .select({ workspaceId: schema.spaces.workspaceId })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, input.spaceId));
  if (!space) return { ok: false, code: 'not_found' };
  if (input.workspaceId && space.workspaceId !== input.workspaceId) {
    return { ok: false, code: 'not_found' };
  }

  const [wsRow] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, space.workspaceId),
        eq(schema.workspaceMembers.userId, input.userId),
      ),
    );
  // Not a workspace member at all — space (and existence) is hidden.
  if (!wsRow) return { ok: false, code: 'not_found' };
  const wsRole = wsRow.role as EffectiveRole;

  const [spRow] = await db
    .select({ role: schema.spaceMembers.role })
    .from(schema.spaceMembers)
    .where(
      and(
        eq(schema.spaceMembers.spaceId, input.spaceId),
        eq(schema.spaceMembers.userId, input.userId),
      ),
    );
  const spaceRole = (spRow?.role as EffectiveRole | undefined) ?? null;

  const effective = maxRole(wsRole, spaceRole);
  if (!effective) return { ok: false, code: 'forbidden' };
  if (RANK[effective] < RANK[input.minRole]) {
    return { ok: false, code: 'forbidden' };
  }
  return { ok: true, role: effective };
}
