import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type DatabaseMeta = {
  database: schema.Database;
  properties: schema.DbProperty[];
  views: schema.DbView[];
};

export async function getDatabaseWithMeta(
  db: PostgresJsDatabase<typeof schema>,
  args: { databaseId: string; workspaceId: string },
): Promise<DatabaseMeta | null> {
  const [database] = await db
    .select()
    .from(schema.databases)
    .where(eq(schema.databases.id, args.databaseId))
    .limit(1);
  if (!database || database.workspaceId !== args.workspaceId) return null;

  const properties = await db
    .select()
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, args.databaseId))
    .orderBy(schema.dbProperties.position);

  const views = await db
    .select()
    .from(schema.dbViews)
    .where(eq(schema.dbViews.databaseId, args.databaseId))
    .orderBy(schema.dbViews.position);

  return { database, properties, views };
}
