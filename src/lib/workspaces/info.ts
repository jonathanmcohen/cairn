import { eq, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';

export type WorkspaceInfo = {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
};

/**
 * Return basic workspace info (id, name, slug, member count). Thin helper carved
 * specifically for the MCP `workspaces.info` tool. Throws HttpError(404) when
 * the workspace does not exist (defensive — callers typically have a valid
 * workspaceId from the token context).
 */
export async function getWorkspaceInfo(
  db: PostgresJsDatabase<typeof schema>,
  args: { workspaceId: string },
): Promise<WorkspaceInfo> {
  const [ws] = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      slug: schema.workspaces.slug,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, args.workspaceId))
    .limit(1);
  if (!ws) throw new HttpError(404, 'Workspace not found');

  const [{ count } = { count: 0 }] = (await db.execute(rawSql`
    SELECT count(*)::int AS count
    FROM workspace_members
    WHERE workspace_id = ${args.workspaceId}
  `)) as unknown as { count: number }[];

  return { id: ws.id, name: ws.name, slug: ws.slug, memberCount: Number(count) };
}
