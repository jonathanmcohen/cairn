import { and, eq, isNull, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Args = { sourcePageId: string; workspaceId: string; actorUserId: string };

/**
 * Authenticated in-workspace deep-copy. Unlike `duplicatePublicPage` (which
 * requires published + allowDuplication and copies across workspaces from the
 * public surface), this lets an editor/owner duplicate any page they can access
 * in-place: same workspace, no share gate.
 *
 * Copies title (prefixed "Copy of "), icon, cover, and content for the whole
 * subtree; remaps parent pointers; mints fresh ids. The copied root keeps the
 * source's parent_id so it lands as a sibling of the original. The copy starts
 * private — share/publish/encryption state is intentionally omitted (mirrors
 * the omissions documented in `duplicate.ts`).
 *
 * Refuses encrypted pages (the server has no DEK) and soft-deleted pages.
 * Returns the new root page id.
 */
export async function duplicateOwnedPage(
  db: PostgresJsDatabase<typeof schema>,
  { sourcePageId, workspaceId, actorUserId }: Args,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [root] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, sourcePageId),
          eq(schema.pages.workspaceId, workspaceId),
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
      SELECT id, parent_id, title, icon, cover, content FROM sub
    `)) as unknown as Array<{
      id: string;
      parent_id: string | null;
      title: string;
      icon: string | null;
      cover: unknown;
      content: unknown;
    }>;

    const idMap = new Map<string, string>();
    for (const r of rows) {
      const isRoot = r.id === sourcePageId;
      const remappedParent = r.parent_id ? (idMap.get(r.parent_id) ?? null) : null;
      const [inserted] = await tx
        .insert(schema.pages)
        .values({
          workspaceId,
          // Root keeps the source's parent (sibling of the original); descendants
          // remap onto their freshly-minted copied parent.
          parentId: isRoot ? root.parentId : remappedParent,
          title: isRoot ? `Copy of ${r.title}` : r.title,
          icon: r.icon,
          cover: r.cover,
          content: r.content,
          createdBy: actorUserId,
        })
        .returning({ id: schema.pages.id });
      idMap.set(r.id, inserted!.id);
    }
    return idMap.get(sourcePageId)!;
  });
}
