import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import {
  acceptSuggestion as acceptDoc,
  type Json,
  rejectSuggestion as rejectDoc,
} from './transform';

type Db = PostgresJsDatabase<typeof schema>;

/** Insert an `open` suggestion row for a page and return its id. */
export async function proposeSuggestion(
  db: Db,
  args: { pageId: string; authorId: string },
): Promise<string> {
  const [row] = await db
    .insert(schema.suggestions)
    .values({ pageId: args.pageId, authorId: args.authorId, status: 'open' })
    .returning({ id: schema.suggestions.id });
  if (!row) throw new Error('insert failed');
  return row.id;
}

/** Open suggestions for a page, in insertion order. */
export function listOpenSuggestions(db: Db, pageId: string) {
  return db
    .select()
    .from(schema.suggestions)
    .where(and(eq(schema.suggestions.pageId, pageId), eq(schema.suggestions.status, 'open')));
}

type ResolveArgs = { pageId: string; suggestionId: string; resolverId: string };
type ResolveResult = { resolved: boolean };

/**
 * Flip a single suggestion from `open` to `status` with a STATUS-GUARDED
 * conditional update — only an `open` row is affected, so concurrent resolvers
 * race and exactly one wins. The winner materializes the resolved doc into
 * `pages.content` via the pure transform.
 */
async function resolve(
  db: Db,
  args: ResolveArgs,
  status: 'accepted' | 'rejected',
  transformDoc: (doc: Json, id: string) => Json,
): Promise<ResolveResult> {
  return db.transaction(async (tx) => {
    const flipped = await tx
      .update(schema.suggestions)
      .set({ status, resolvedBy: args.resolverId, resolvedAt: sql`now()` })
      .where(
        and(eq(schema.suggestions.id, args.suggestionId), eq(schema.suggestions.status, 'open')),
      )
      .returning({ id: schema.suggestions.id });
    if (flipped.length === 0) return { resolved: false };

    const [page] = await tx
      .select({ content: schema.pages.content })
      .from(schema.pages)
      .where(eq(schema.pages.id, args.pageId));
    if (page?.content) {
      const next = transformDoc(page.content as Json, args.suggestionId);
      await tx
        .update(schema.pages)
        .set({ content: next, updatedAt: sql`now()` })
        .where(eq(schema.pages.id, args.pageId));
    }
    return { resolved: true };
  });
}

export const acceptSuggestion = (db: Db, args: ResolveArgs) =>
  resolve(db, args, 'accepted', acceptDoc);
export const rejectSuggestion = (db: Db, args: ResolveArgs) =>
  resolve(db, args, 'rejected', rejectDoc);
