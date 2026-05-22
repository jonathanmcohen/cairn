import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { reindexPageLinks } from '@/lib/pages/page-links';
import { emit } from '@/lib/webhooks/dispatch';

export class PageConflictError extends Error {
  constructor(message = 'Page has been modified since you last read it') {
    super(message);
    this.name = 'PageConflictError';
  }
}

export type UpdatePageInput = {
  pageId: string;
  workspaceId: string;
  patch: Partial<{
    title: string;
    icon: string | null;
    coverUrl: string | null;
    content: unknown;
  }>;
  expectedUpdatedAt?: Date;
};

export async function updatePage(
  db: PostgresJsDatabase<typeof schema>,
  input: UpdatePageInput,
): Promise<schema.Page> {
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, input.pageId),
          eq(schema.pages.workspaceId, input.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!current) throw new Error('Page not found');
    if (
      input.expectedUpdatedAt &&
      current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new PageConflictError();
    }

    const values: Partial<schema.NewPage> = {};
    if (input.patch.title !== undefined) values.title = input.patch.title;
    if (input.patch.icon !== undefined) values.icon = input.patch.icon;
    if (input.patch.coverUrl !== undefined) values.coverUrl = input.patch.coverUrl;
    if (input.patch.content !== undefined) values.content = input.patch.content as never;

    const [updated] = await tx
      .update(schema.pages)
      .set(values)
      .where(eq(schema.pages.id, current.id))
      .returning();
    if (!updated) throw new Error('Update returned no row');
    // Keep the page_links index in lockstep with the saved doc. Inside the same
    // transaction so a failed reindex rolls back the content write (index must
    // never drift from `pages.content`).
    if (input.patch.content !== undefined) {
      await reindexPageLinks(tx, current.id, input.patch.content);
    }
    return updated;
  });
  // Fire-and-forget webhook (self-guarding; never throws into the caller).
  void emit('page.updated', updated.workspaceId, { id: updated.id, title: updated.title });
  return updated;
}
