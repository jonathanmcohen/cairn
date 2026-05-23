import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { SearchFilters } from '@/lib/pages/search';

type Db = PostgresJsDatabase<typeof schema>;

export type CreateSavedSearchInput = {
  workspaceId: string;
  userId: string;
  name: string;
  query: string;
  filters: SearchFilters;
};

export async function createSavedSearch(
  db: Db,
  input: CreateSavedSearchInput,
): Promise<schema.SavedSearch> {
  const [row] = await db
    .insert(schema.savedSearches)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.name,
      query: input.query,
      filters: input.filters,
    })
    .returning();
  if (!row) throw new Error('failed to create saved search');
  return row;
}

export async function listSavedSearches(
  db: Db,
  input: { workspaceId: string; userId: string },
): Promise<schema.SavedSearch[]> {
  return db
    .select()
    .from(schema.savedSearches)
    .where(
      and(
        eq(schema.savedSearches.workspaceId, input.workspaceId),
        eq(schema.savedSearches.userId, input.userId),
      ),
    )
    .orderBy(desc(schema.savedSearches.createdAt));
}

export async function updateSavedSearch(
  db: Db,
  input: {
    id: string;
    userId: string;
    name?: string;
    query?: string;
    filters?: SearchFilters;
  },
): Promise<schema.SavedSearch> {
  const patch: Partial<typeof schema.savedSearches.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.query !== undefined) patch.query = input.query;
  if (input.filters !== undefined) patch.filters = input.filters;
  const [row] = await db
    .update(schema.savedSearches)
    .set(patch)
    .where(
      and(eq(schema.savedSearches.id, input.id), eq(schema.savedSearches.userId, input.userId)),
    )
    .returning();
  if (!row) throw new Error('saved search not found or not owned by user');
  return row;
}

export async function deleteSavedSearch(
  db: Db,
  input: { id: string; userId: string },
): Promise<void> {
  const deleted = await db
    .delete(schema.savedSearches)
    .where(
      and(eq(schema.savedSearches.id, input.id), eq(schema.savedSearches.userId, input.userId)),
    )
    .returning({ id: schema.savedSearches.id });
  if (deleted.length === 0) throw new Error('saved search not found or not owned by user');
}
