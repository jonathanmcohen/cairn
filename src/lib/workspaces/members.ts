import { and, eq, ilike, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type MemberSearchResult = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

/**
 * Members of `workspaceId` whose name OR email matches `query` (ILIKE, substring).
 * Empty query returns the first `limit` members (alphabetical by name) so the
 * mention menu can show something on the bare `@`. Workspace-scoped: only users
 * with a membership row in this workspace are returned.
 */
export async function searchWorkspaceMembers(
  db: PostgresJsDatabase<typeof schema>,
  input: { workspaceId: string; query: string; limit?: number },
): Promise<MemberSearchResult[]> {
  const limit = input.limit ?? 10;
  const q = input.query.trim();
  const like = `%${q}%`;

  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      image: schema.users.image,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, input.workspaceId),
        q.length > 0
          ? or(ilike(schema.users.name, like), ilike(schema.users.email, like))
          : undefined,
      ),
    )
    .orderBy(schema.users.name)
    .limit(limit);

  return rows;
}
