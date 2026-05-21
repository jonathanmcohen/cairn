import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export async function getPage(
  db: PostgresJsDatabase<typeof schema>,
  args: { pageId: string; workspaceId: string },
): Promise<schema.Page | null> {
  const [row] = await db
    .select()
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.id, args.pageId),
        eq(schema.pages.workspaceId, args.workspaceId),
        isNull(schema.pages.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
