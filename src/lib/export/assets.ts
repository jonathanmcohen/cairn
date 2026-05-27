import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type AssetRef = {
  fileId: string;
  destFilename: string;
  mimeType: string | null;
  storagePath: string;
};

type Node = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
};

/**
 * Media-bearing TipTap node types that surface a `/api/files/<id>` URL in
 * `attrs.src`. Kept narrow to avoid over-rewriting nodes that happen to carry
 * an unrelated `src` attr.
 */
const MEDIA_NODE_TYPES = new Set([
  'image',
  'cairnImage',
  'file',
  'fileAttachment',
  'videoBlock',
  'audioBlock',
  'pdfBlock',
]);
const FILE_URL_RE = /^\/api\/files\/([0-9a-f-]{36})(?:\?|$)/;

function collectMediaSrcs(node: Node, acc: { node: Node; fileId: string; attr: 'src' | 'href' }[]): void {
  if (!node || typeof node !== 'object') return;
  if (node.type && MEDIA_NODE_TYPES.has(node.type)) {
    const src = node.attrs?.src;
    if (typeof src === 'string') {
      const m = src.match(FILE_URL_RE);
      if (m?.[1]) acc.push({ node, fileId: m[1], attr: 'src' });
    }
    // fileAttachment uses `href`.
    const href = node.attrs?.href;
    if (typeof href === 'string') {
      const m = href.match(FILE_URL_RE);
      if (m?.[1]) acc.push({ node, fileId: m[1], attr: 'href' });
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectMediaSrcs(child, acc);
  }
}

function sanitize(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  return cleaned || 'file';
}

/**
 * Mutates `doc` in place: every media node's `attrs.src` (or `attrs.href` for
 * `fileAttachment`) becomes `./assets/<unique-filename>`. Returns the rewritten
 * doc + the list of asset refs the orchestrator must download + write into
 * `docs/assets/`.
 *
 * Filename collision avoidance: prefix every dest filename with the file id so
 * two files with the same `name` never collide.
 *
 * Cross-workspace refs are dropped silently — a stale `/api/files/<uuid>`
 * referencing a file in a different workspace must never bundle into another
 * tenant's export.
 */
export async function extractAndRewriteAssets(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  doc: unknown,
): Promise<{ rewritten: unknown; assets: AssetRef[] }> {
  const hits: { node: Node; fileId: string; attr: 'src' | 'href' }[] = [];
  collectMediaSrcs(doc as Node, hits);
  if (hits.length === 0) return { rewritten: doc, assets: [] };

  const fileIds = [...new Set(hits.map((h) => h.fileId))];
  const rows = await db
    .select({
      id: schema.files.id,
      workspaceId: schema.files.workspaceId,
      path: schema.files.path,
      name: schema.files.name,
      mimeType: schema.files.mimeType,
    })
    .from(schema.files)
    .where(inArray(schema.files.id, fileIds));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const assets: AssetRef[] = [];
  const seenDestFiles = new Set<string>();
  for (const { node, fileId, attr } of hits) {
    const f = byId.get(fileId);
    if (!f || f.workspaceId !== workspaceId) continue;
    const dest = `${fileId}-${sanitize(f.name ?? 'file')}`;
    node.attrs = { ...(node.attrs ?? {}), [attr]: `./assets/${dest}` };
    if (!seenDestFiles.has(dest)) {
      seenDestFiles.add(dest);
      assets.push({
        fileId,
        destFilename: dest,
        mimeType: f.mimeType,
        storagePath: f.path,
      });
    }
  }
  return { rewritten: doc, assets };
}
