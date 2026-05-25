import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type UnlinkedMention = {
  id: string;
  title: string;
  /** Short body fragment showing the mention context (ts_headline output). */
  snippet: string;
};

const MAX_RESULTS = 20;

/**
 * Find pages in the same workspace that mention the target page's title in
 * their content (Postgres FTS over `pages.content_tsv`) and are NOT already
 * linked to the target page via `page_links` (any kind). Excludes the target
 * page itself and any soft-deleted page. Capped at MAX_RESULTS.
 *
 * The shape complements the existing `findUnlinkedMentions` in
 * `src/lib/pages/page-links.ts` which returns plain `{id, title}` and is
 * still used by the v0.6 P10 backlinks route — this v0.8 helper adds an
 * anti-join (via LEFT JOIN + IS NULL) and a `ts_headline` snippet for the
 * new BacklinksPanel rendering.
 */
export async function findUnlinkedMentions(
  db: Db,
  input: { pageId: string; workspaceId: string },
): Promise<UnlinkedMention[]> {
  // Fetch the target's title for the FTS query.
  const target = (await db.execute(
    sql`SELECT title FROM pages WHERE id = ${input.pageId} LIMIT 1`,
  )) as unknown as Array<{ title: string }>;
  const title = target[0]?.title?.trim();
  if (!title) return [];

  // plainto_tsquery handles tokenization safely (no user-controlled SQL
  // operators reach the parser). content_tsv is the project-wide FTS column
  // (maintained by the pages trigger from `content` + `title`). The
  // LEFT JOIN ... WHERE l.source_page_id IS NULL is the anti-join that
  // excludes pages already linked to the target.
  //
  // ts_headline produces a short snippet centered on the match.
  const rows = (await db.execute(sql`
    SELECT
      p.id            AS id,
      p.title         AS title,
      ts_headline(
        'english',
        p.content_text,
        plainto_tsquery('english', ${title}),
        'MaxFragments=1, MaxWords=20, MinWords=5'
      )               AS snippet
    FROM pages p
    LEFT JOIN page_links l
      ON l.source_page_id = p.id AND l.target_page_id = ${input.pageId}
    WHERE p.workspace_id = ${input.workspaceId}
      AND p.id <> ${input.pageId}
      AND p.deleted_at IS NULL
      AND p.content_tsv @@ plainto_tsquery('english', ${title})
      AND l.source_page_id IS NULL
    ORDER BY p.updated_at DESC
    LIMIT ${MAX_RESULTS}
  `)) as unknown as Array<{ id: string; title: string; snippet: string | null }>;

  return rows.map((r) => ({ id: r.id, title: r.title, snippet: r.snippet ?? '' }));
}
