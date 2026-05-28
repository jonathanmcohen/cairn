import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type VisibleSpace = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  position: number;
  parentSpaceId: string | null;
};

const ADMIN_RANK = new Set(['owner', 'admin']);

/**
 * Server-side lister used by the sidebar and the admin settings UI. Returns
 * every space in `workspaceId` that `userId` can see, ordered by
 * (position asc, name asc).
 *
 * Visibility heuristic (workspace-public until membership is added):
 * - Workspace owner/admin see every space.
 * - Any other workspace member sees spaces that EITHER have no
 *   `space_members` rows yet (workspace-public) OR include them as a member.
 * - Non-members of the workspace see nothing.
 */
export async function listVisibleSpaces(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  userId: string,
): Promise<VisibleSpace[]> {
  const [wsRow] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    );
  if (!wsRow) return [];

  const isAdmin = ADMIN_RANK.has(wsRow.role);

  const rows = await db
    .select({
      id: schema.spaces.id,
      name: schema.spaces.name,
      slug: schema.spaces.slug,
      icon: schema.spaces.icon,
      position: schema.spaces.position,
      parentSpaceId: schema.spaces.parentSpaceId,
      hasMembers: sql<boolean>`EXISTS (
        SELECT 1 FROM ${schema.spaceMembers}
         WHERE ${schema.spaceMembers.spaceId} = ${schema.spaces.id}
      )`,
      iAmMember: sql<boolean>`EXISTS (
        SELECT 1 FROM ${schema.spaceMembers}
         WHERE ${schema.spaceMembers.spaceId} = ${schema.spaces.id}
           AND ${schema.spaceMembers.userId} = ${userId}
      )`,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.workspaceId, workspaceId))
    .orderBy(asc(schema.spaces.position), asc(schema.spaces.name));

  return rows
    .filter((r) => isAdmin || !r.hasMembers || r.iAmMember)
    .map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      icon: r.icon,
      position: r.position,
      parentSpaceId: r.parentSpaceId,
    }));
}

export type SpacePageRow = {
  id: string;
  title: string;
  parentId: string | null;
  icon: string | null;
};

/**
 * Pages belonging to `spaceId`, excluding soft-deleted, ordered by createdAt
 * to match the sidebar's existing page tree convention (v0.8 P4 uses the
 * same ordering on `flattenedPageTree`).
 */
export async function listSpacePages(
  db: PostgresJsDatabase<typeof schema>,
  spaceId: string,
): Promise<SpacePageRow[]> {
  const rows = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      parentId: schema.pages.parentId,
      icon: schema.pages.icon,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.spaceId, spaceId), isNull(schema.pages.deletedAt)))
    .orderBy(asc(schema.pages.createdAt));
  return rows;
}

/**
 * Pages with NULL space_id ("Unfiled") for the workspace. The sidebar puts
 * these under a synthetic group at the bottom.
 */
export async function listUnfiledPages(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<SpacePageRow[]> {
  const rows = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      parentId: schema.pages.parentId,
      icon: schema.pages.icon,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.workspaceId, workspaceId),
        isNull(schema.pages.spaceId),
        isNull(schema.pages.deletedAt),
      ),
    )
    .orderBy(asc(schema.pages.createdAt));
  return rows;
}
