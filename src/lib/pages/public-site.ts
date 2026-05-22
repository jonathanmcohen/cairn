import { and, eq, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type SetArgs = { workspaceId: string; slug: string; enabled: boolean };

/** Persist the workspace's public-site slug + enabled flag. Unique slug enforced by the DB. */
export async function setPublicSite(
  db: PostgresJsDatabase<typeof schema>,
  { workspaceId, slug, enabled }: SetArgs,
): Promise<void> {
  await db
    .update(schema.workspaces)
    .set({ publicSiteSlug: slug, publicSiteEnabled: enabled })
    .where(eq(schema.workspaces.id, workspaceId));
}

export type PublicSitePage = {
  id: string;
  title: string;
  icon: string | null;
  slug: string;
  parentId: string | null;
};
export type PublicSite = { workspaceId: string; slug: string; pages: PublicSitePage[] };

/**
 * Resolve an ENABLED public site by its slug and return its published, non-deleted
 * pages as a flat list (caller builds the tree from parentId). Disabled / unknown → null.
 */
export async function getPublicSitePages(
  db: PostgresJsDatabase<typeof schema>,
  workspaceSlug: string,
): Promise<PublicSite | null> {
  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.publicSiteSlug, workspaceSlug),
        eq(schema.workspaces.publicSiteEnabled, true),
      ),
    )
    .limit(1);
  if (!ws) return null;

  const pages = (await db.execute(rawSql`
    SELECT id, title, icon, public_slug AS slug, parent_id
    FROM pages
    WHERE workspace_id = ${ws.id} AND published = true AND deleted_at IS NULL
    ORDER BY title ASC
  `)) as unknown as Array<{
    id: string;
    title: string;
    icon: string | null;
    slug: string;
    parent_id: string | null;
  }>;

  return {
    workspaceId: ws.id,
    slug: workspaceSlug,
    pages: pages.map((p) => ({
      id: p.id,
      title: p.title,
      icon: p.icon,
      slug: p.slug,
      parentId: p.parent_id,
    })),
  };
}
