import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { signFileUrl } from '@/lib/files/signing';

/**
 * Resolve a page for the public render surface. Returns the page only when it is
 * published, slug-matched, and not soft-deleted; otherwise null. This is the sole
 * authorization gate for `/p/<slug>` — no session involved.
 */
export async function getPublishedPageBySlug(
  db: PostgresJsDatabase<typeof schema>,
  slug: string,
): Promise<schema.Page | null> {
  const [page] = await db
    .select()
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.publicSlug, slug),
        eq(schema.pages.published, true),
        isNull(schema.pages.deletedAt),
      ),
    )
    .limit(1);
  return page ?? null;
}

const PUBLIC_FILE_TTL_SECONDS = 60 * 60;

type ProseNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: ProseNode[];
  [k: string]: unknown;
};

function signedUrlFor(fileId: string, secret: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + PUBLIC_FILE_TTL_SECONDS;
  const sig = signFileUrl({ fileId, expiresAt, secret });
  return `/api/files/${fileId}?sig=${sig}&exp=${expiresAt}`;
}

/**
 * Return a deep copy of `doc` with every cairnImage/fileAttachment node's URL
 * attribute (src / href) re-minted as a fresh 1-hour signed `/api/files/<id>` URL
 * derived from the node's `fileId`. Nodes without a `fileId` are left untouched.
 * Pure: the input document is not mutated.
 */
export function resignDocumentImages(doc: unknown, secret: string): unknown {
  function walk(node: ProseNode): ProseNode {
    const next: ProseNode = { ...node };
    const fileId = next.attrs?.fileId;
    if (typeof fileId === 'string' && fileId.length > 0) {
      if (next.type === 'cairnImage') {
        next.attrs = { ...next.attrs, src: signedUrlFor(fileId, secret) };
      } else if (next.type === 'fileAttachment') {
        next.attrs = { ...next.attrs, href: signedUrlFor(fileId, secret) };
      }
    }
    if (Array.isArray(next.content)) {
      next.content = next.content.map(walk);
    }
    return next;
  }
  return walk(doc as ProseNode);
}
