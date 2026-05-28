import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { signFileUrl } from '@/lib/files/signing';

/**
 * Resolve a page for the public render surface. Returns the page only when:
 *   - `public_slug` matches,
 *   - `published=true` (the public-share toggle), AND
 *   - `status='published'` (v0.9.0 G4 P26 lifecycle gate — drafts/review/archived
 *     refuse to render at `/p/<slug>` even if `published=true` because of
 *     leftover share state),
 *   - `deleted_at IS NULL`.
 * Otherwise returns null. This is the sole authorization gate for `/p/<slug>` —
 * no session involved. Returning null (not throwing) lets callers map to 404
 * without leaking existence.
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
        eq(schema.pages.status, 'published'),
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
 * Return a deep copy of `doc` with every file-bearing node's URL attribute
 * re-minted as a fresh 1-hour signed `/api/files/<id>` URL derived from the
 * node's `fileId`:
 *   - `cairnImage` → `src`
 *   - `fileAttachment` → `href`
 *   - `video` (v0.8.0 P24) → `src` (transient public-render override read by
 *     `VideoNode.renderHTML`; never persisted into the editing surface)
 *   - `cairnAudio` (v0.9.0 G3 P22) → `src` (transient public-render override
 *     read by `AudioView` — same shape as the video override)
 * Nodes without a `fileId` are left untouched. Pure: the input document is
 * not mutated.
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
      } else if (next.type === 'video') {
        next.attrs = { ...next.attrs, src: signedUrlFor(fileId, secret) };
      } else if (next.type === 'cairnAudio') {
        next.attrs = { ...next.attrs, src: signedUrlFor(fileId, secret) };
      }
    }
    if (Array.isArray(next.content)) {
      next.content = next.content.map(walk);
    }
    return next;
  }
  return walk(doc as ProseNode);
}
