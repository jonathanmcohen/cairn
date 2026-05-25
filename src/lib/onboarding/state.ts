import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type OnboardingState = {
  hasAnyUserPages: boolean;
  workspaceName: string;
};

/**
 * Returns whether the workspace has any user-created (non-system) pages and the
 * current workspace name for the wizard's step-2 confirm.
 *
 * "User-created" excludes pages whose `metadata.systemPage` is set (currently
 * only the inbox page from P8 carries `{systemPage: 'inbox'}`). Soft-deleted
 * pages (deleted_at IS NOT NULL) are also excluded — a workspace that only has
 * trashed pages should still see the wizard.
 */
export async function getOnboardingState(
  db: Db,
  input: { workspaceId: string; userId: string },
): Promise<OnboardingState> {
  const [ws] = await db
    .select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, input.workspaceId))
    .limit(1);
  if (!ws) throw new Error('workspace not found');

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.workspaceId, input.workspaceId),
        isNull(schema.pages.deletedAt),
        or(
          // No metadata at all → user page.
          sql`(${schema.pages.metadata} ->> 'systemPage') IS NULL`,
          // Or metadata exists but the systemPage flag isn't set.
          ne(sql`(${schema.pages.metadata} ->> 'systemPage')`, 'inbox'),
        ),
      ),
    );

  return {
    hasAnyUserPages: (row?.count ?? 0) > 0,
    workspaceName: ws.name,
  };
}
