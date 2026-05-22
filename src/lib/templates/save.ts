import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { captureDatabase, capturePage } from './capture';

type Db = PostgresJsDatabase<typeof schema>;

export async function savePageAsTemplate(
  db: Db,
  input: { workspaceId: string; rootPageId: string; name: string },
): Promise<schema.Template> {
  const payload = await capturePage(db, {
    workspaceId: input.workspaceId,
    rootPageId: input.rootPageId,
  });
  const [row] = await db
    .insert(schema.templates)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      kind: 'page',
      payload,
      builtIn: false,
    })
    .returning();
  if (!row) throw new Error('failed to save template');
  return row;
}

export async function saveDatabaseAsTemplate(
  db: Db,
  input: { workspaceId: string; databaseId: string; name: string; withSampleRows?: boolean },
): Promise<schema.Template> {
  const payload = await captureDatabase(db, {
    workspaceId: input.workspaceId,
    databaseId: input.databaseId,
    withSampleRows: input.withSampleRows,
  });
  const [row] = await db
    .insert(schema.templates)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      kind: 'database',
      payload,
      builtIn: false,
    })
    .returning();
  if (!row) throw new Error('failed to save template');
  return row;
}
