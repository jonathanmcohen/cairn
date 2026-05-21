import * as schema from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type CreateDatabaseInput = {
  workspaceId: string;
  pageId: string;
  createdBy: string;
  name?: string;
};

export async function createDatabase(
  db: PostgresJsDatabase<typeof schema>,
  input: CreateDatabaseInput,
): Promise<schema.Database> {
  return db.transaction(async (tx) => {
    const [page] = await tx
      .select({ workspaceId: schema.pages.workspaceId })
      .from(schema.pages)
      .where(
        and(eq(schema.pages.id, input.pageId), eq(schema.pages.workspaceId, input.workspaceId)),
      )
      .limit(1);
    if (!page) throw new Error('page not found in workspace');

    const [database] = await tx
      .insert(schema.databases)
      .values({
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        createdBy: input.createdBy,
        name: input.name ?? 'Untitled database',
      })
      .returning();
    if (!database) throw new Error('failed to insert database');

    const [nameProp] = await tx
      .insert(schema.dbProperties)
      .values({ databaseId: database.id, name: 'Name', type: 'text', position: 0 })
      .returning();
    if (!nameProp) throw new Error('failed to insert property');

    await tx.insert(schema.dbViews).values({
      databaseId: database.id,
      type: 'table',
      name: 'Default',
      config: { sorts: [], filters: [], visibleProperties: [nameProp.id] },
      position: 0,
    });
    return database;
  });
}
