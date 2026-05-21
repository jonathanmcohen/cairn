import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export async function listComments(
  db: PostgresJsDatabase<typeof schema>,
  pageId: string,
  workspaceId: string,
): Promise<schema.Comment[]> {
  return db
    .select()
    .from(schema.comments)
    .where(and(eq(schema.comments.pageId, pageId), eq(schema.comments.workspaceId, workspaceId)))
    .orderBy(asc(schema.comments.createdAt));
}
