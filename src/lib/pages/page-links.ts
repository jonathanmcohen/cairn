import { eq, inArray } from 'drizzle-orm';
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
