import * as schema from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

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
    content: unknown;
  }>;
  expectedUpdatedAt?: Date;
};

export async function updatePage(
  db: PostgresJsDatabase<typeof schema>,
  input: UpdatePageInput,
): Promise<schema.Page> {
  return db.transaction(async (tx) => {
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
    if (input.patch.content !== undefined) values.content = input.patch.content as never;

    const [updated] = await tx
      .update(schema.pages)
      .set(values)
      .where(eq(schema.pages.id, current.id))
      .returning();
    if (!updated) throw new Error('Update returned no row');
    return updated;
  });
}
