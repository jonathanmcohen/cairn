import { and, eq, isNull, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Args = { sourcePageId: string; intoWorkspaceId: string; actorUserId: string };

/**
 * Deep-copy a publicly-shared, duplication-enabled page subtree into another
 * workspace. Mints fresh ids, remaps parent pointers, copies title/icon/content
 * only — share state (published/publicSlug/password/expiry/allowDuplication) is
 * intentionally omitted so the copy starts private. Refuses anything that is not
 * published + allowDuplication + not soft-deleted. Returns the new root page id.
 */
export async function duplicatePublicPage(
  db: PostgresJsDatabase<typeof schema>,
  { sourcePageId, intoWorkspaceId, actorUserId }: Args,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [root] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, sourcePageId),
          eq(schema.pages.published, true),
          eq(schema.pages.allowDuplication, true),
          // v0.9.0 G1 P6 — defense-in-depth: encrypted pages can never be
          // duplicated via the public surface (server has no DEK). The public
          // gate already blocks the page render; this filter keeps the
          // duplicate-helper safe if anyone calls it from a non-public surface.
          eq(schema.pages.encrypted, false),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!root) throw new Error('page not duplicable');

    const rows = (await tx.execute(rawSql`
      WITH RECURSIVE sub AS (
        SELECT * FROM pages WHERE id = ${sourcePageId}
        UNION ALL
        SELECT p.* FROM pages p JOIN sub s ON p.parent_id = s.id WHERE p.deleted_at IS NULL
      )
      SELECT id, parent_id, title, icon, content FROM sub
    `)) as unknown as Array<{
      id: string;
      parent_id: string | null;
      title: string;
      icon: string | null;
      content: unknown;
    }>;

    const idMap = new Map<string, string>();
    for (const r of rows) {
      const remappedParent = r.parent_id ? (idMap.get(r.parent_id) ?? null) : null;
      const [inserted] = await tx
        .insert(schema.pages)
        .values({
          workspaceId: intoWorkspaceId,
          parentId: r.id === sourcePageId ? null : remappedParent,
          title: r.title,
          icon: r.icon,
          content: r.content,
          createdBy: actorUserId,
        })
        .returning({ id: schema.pages.id });
      idMap.set(r.id, inserted!.id);
    }
    return idMap.get(sourcePageId)!;
  });
}
