import * as schema from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { emptyDocument } from './empty-document';

export type CreatePageInput = {
  workspaceId: string;
  createdBy: string;
  parentId?: string;
  title?: string;
  icon?: string | null;
};

export async function createPage(
  db: PostgresJsDatabase<typeof schema>,
  input: CreatePageInput,
): Promise<schema.Page> {
  return db.transaction(async (tx) => {
    if (input.parentId) {
      const [parent] = await tx
        .select({ workspaceId: schema.pages.workspaceId })
        .from(schema.pages)
        .where(
          and(eq(schema.pages.id, input.parentId), eq(schema.pages.workspaceId, input.workspaceId)),
        )
        .limit(1);
      if (!parent) {
        throw new Error('parent page is missing or belongs to a different workspace');
      }
    }
    const [page] = await tx
      .insert(schema.pages)
      .values({
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        title: input.title ?? 'Untitled',
        icon: input.icon ?? null,
        content: emptyDocument(),
        createdBy: input.createdBy,
      })
      .returning();
    if (!page) throw new Error('failed to insert page');
    return page;
  });
}
