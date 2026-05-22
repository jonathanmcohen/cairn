import { and, eq, inArray, isNull, ne, notInArray, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Tx = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'delete' | 'insert'>;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const NODE_KIND: Record<string, 'link' | 'mention' | 'embed'> = {
  pageLink: 'link',
  pageMention: 'mention',
  pageEmbed: 'embed',
};
export type PageLinkRef = { targetPageId: string; kind: 'link' | 'mention' | 'embed' };

export function extractPageLinks(content: unknown): PageLinkRef[] {
  const seen = new Set<string>();
  const out: PageLinkRef[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: { targetPageId?: unknown }; content?: unknown[] };
    const kind = n.type ? NODE_KIND[n.type] : undefined;
    if (kind) {
      const id = n.attrs?.targetPageId;
      if (typeof id === 'string' && UUID_RE.test(id)) {
        const key = `${id}:${kind}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ targetPageId: id, kind });
        }
      }
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(content);
  return out;
}

export async function reindexPageLinks(tx: Tx, pageId: string, content: unknown): Promise<void> {
  await tx.delete(schema.pageLinks).where(eq(schema.pageLinks.sourcePageId, pageId));
  const refs = extractPageLinks(content);
  if (refs.length === 0) return;
  const targetIds = [...new Set(refs.map((r) => r.targetPageId))];
  const existing = await tx
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(inArray(schema.pages.id, targetIds));
  const live = new Set(existing.map((p) => p.id));
  const rows = refs
    .filter((r) => live.has(r.targetPageId))
    .map((r) => ({ sourcePageId: pageId, targetPageId: r.targetPageId, kind: r.kind }));
  if (rows.length > 0) await tx.insert(schema.pageLinks).values(rows);
}

export async function getBacklinks(
  db: PostgresJsDatabase<typeof schema>,
  targetPageId: string,
): Promise<{ sourcePageId: string; kind: 'link' | 'mention' | 'embed' }[]> {
  return db
    .select({ sourcePageId: schema.pageLinks.sourcePageId, kind: schema.pageLinks.kind })
    .from(schema.pageLinks)
    .where(eq(schema.pageLinks.targetPageId, targetPageId));
}

/**
 * Read-time "unlinked mentions": pages in the same workspace whose text contains
 * the target page's `title` but which are NOT already in page_links pointing at
 * `pageId`. Reuses the existing FTS column (`content_tsv`, kept in sync by the
 * pages trigger from `content` + `title`); excludes the target itself and
 * soft-deleted pages. No dedicated index — bounded by the workspace's page
 * count, run on panel open. Returns `{id, title}[]`, capped at 50.
 */
export async function findUnlinkedMentions(
  db: PostgresJsDatabase<typeof schema>,
  input: { workspaceId: string; pageId: string; title: string },
): Promise<{ id: string; title: string }[]> {
  const title = input.title.trim();
  if (title.length === 0) return [];

  // Sources already linking to this page — excluded from "unlinked".
  const linked = await db
    .select({ sourcePageId: schema.pageLinks.sourcePageId })
    .from(schema.pageLinks)
    .where(eq(schema.pageLinks.targetPageId, input.pageId));
  const linkedIds = [...new Set(linked.map((l) => l.sourcePageId))];

  const where = and(
    eq(schema.pages.workspaceId, input.workspaceId),
    isNull(schema.pages.deletedAt),
    ne(schema.pages.id, input.pageId),
    // FTS match on the title's words; plainto_tsquery handles multi-word titles.
    rawSql`${schema.pages.contentTsv} @@ plainto_tsquery('english', ${title})`,
    linkedIds.length > 0 ? notInArray(schema.pages.id, linkedIds) : undefined,
  );

  return db
    .select({ id: schema.pages.id, title: schema.pages.title })
    .from(schema.pages)
    .where(where)
    .limit(50);
}
