/**
 * v0.10.0 C4 — pure ProseMirror-JSON remap helpers for selective restore.
 *
 * A restored page subtree gets ALL-NEW row ids (pages, databases, files, …),
 * but `pages.content` embeds the OLD ids inside node attrs:
 *   - `database` nodes carry `attrs.databaseId` (src/components/editor/database-node.ts);
 *   - `pageLink` / `pageMention` / `pageEmbed` nodes carry `attrs.targetPageId`
 *     (src/components/editor/page-link-extension.ts);
 *   - file-backed nodes (`cairnImage`, `fileAttachment`, `pdf`, `video`,
 *     `cairnAudio`, gallery children) carry `attrs.fileId` plus denormalized
 *     `src`/`href` URLs of the shape `/api/files/<id>?sig=&exp=`.
 *
 * Policy (documented in docs/operations.md):
 *   - ids that are IN the id map → rewritten to the new id;
 *   - page/database references OUTSIDE the restored set → left as-is. The
 *     link/embed renderers are plain renderHTML anchors to `/pages/<id>` (no
 *     fetch-on-render), so a dangling target renders as a link that 404s —
 *     never a crash;
 *   - file nodes whose `fileId` is in `skippedFileIds` (binary missing from
 *     UPLOAD_DIR, see selective-restore.ts) → the node is STRIPPED from the
 *     doc, because a file node without a blob renders a permanently broken
 *     attachment;
 *   - remapped file nodes get their `src`/`href` re-pointed at the bare
 *     `/api/files/<newId>` path with the stale signature dropped — renderers
 *     re-sign from `fileId` at display time (src/lib/pages/public.ts), so the
 *     unsigned denormalized URL is only a fallback.
 *
 * Everything here is pure (input docs are never mutated) so the unit suite
 * can cover it without pg_restore or a database.
 */

type ProseNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: unknown[];
  content?: unknown[];
};

export type ContentRemapMaps = {
  /** old page id → new page id */
  pageIds: ReadonlyMap<string, string>;
  /** old inline-database id → new id */
  databaseIds: ReadonlyMap<string, string>;
  /** old file id → new id (only files whose binary exists) */
  fileIds: ReadonlyMap<string, string>;
  /** file ids whose binary was missing — nodes referencing them are stripped */
  skippedFileIds: ReadonlySet<string>;
};

/** Node types that reference an uploaded file via `attrs.fileId`. */
const FILE_NODE_TYPES = new Set(['cairnImage', 'fileAttachment', 'pdf', 'video', 'cairnAudio']);

/** Node types that reference another page via `attrs.targetPageId`. */
const PAGE_REF_NODE_TYPES = new Set(['pageLink', 'pageMention', 'pageEmbed']);

function remapFileUrl(value: unknown, oldId: string, newId: string): unknown {
  if (typeof value !== 'string' || !value.includes(oldId)) return value;
  // Drop the stale signature: `/api/files/<old>?sig=…` → `/api/files/<new>`.
  return value.split('?')[0]?.replaceAll(oldId, newId) ?? value;
}

function remapNode(node: ProseNode, maps: ContentRemapMaps): ProseNode | null {
  const attrs = node.attrs ?? {};
  let next: ProseNode = node;

  if (node.type === 'database' && typeof attrs.databaseId === 'string') {
    const mapped = maps.databaseIds.get(attrs.databaseId);
    if (mapped) next = { ...next, attrs: { ...attrs, databaseId: mapped } };
  } else if (node.type && PAGE_REF_NODE_TYPES.has(node.type)) {
    const target = attrs.targetPageId;
    if (typeof target === 'string') {
      const mapped = maps.pageIds.get(target);
      if (mapped) next = { ...next, attrs: { ...attrs, targetPageId: mapped } };
      // Unmapped target: leave the old id — renders as a link to a missing
      // page (404), which is the honest representation of a reference that
      // points outside the restored set.
    }
  } else if (node.type && FILE_NODE_TYPES.has(node.type)) {
    const fileId = attrs.fileId;
    if (typeof fileId === 'string' && fileId.length > 0) {
      if (maps.skippedFileIds.has(fileId)) return null; // strip: blob is gone
      const mapped = maps.fileIds.get(fileId);
      if (mapped) {
        next = {
          ...next,
          attrs: {
            ...attrs,
            fileId: mapped,
            ...('src' in attrs ? { src: remapFileUrl(attrs.src, fileId, mapped) } : {}),
            ...('href' in attrs ? { href: remapFileUrl(attrs.href, fileId, mapped) } : {}),
          },
        };
      }
    }
  }

  if (Array.isArray(next.content)) {
    const children = next.content
      .map((child) => remapNode((child ?? {}) as ProseNode, maps))
      .filter((child): child is ProseNode => child !== null);
    // A gallery whose every image was stripped is an empty shell — drop it.
    if (next.type === 'gallery' && children.length === 0) return null;
    next = next === node ? { ...next, content: children } : { ...next, content: children };
  }

  return next;
}

/**
 * Remap a `pages.content` (or `db_rows.body`) ProseMirror document. Returns a
 * NEW document; the input is never mutated. Non-object inputs pass through
 * unchanged (defensive: jsonb content is `unknown` at the type level).
 */
export function remapDocContent(doc: unknown, maps: ContentRemapMaps): unknown {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  return remapNode(doc as ProseNode, maps) ?? { type: 'doc', content: [] };
}

/**
 * Deep-remap arbitrary jsonb (db_cells values, db_views / db_properties
 * config, comment anchors): every STRING value that is an exact key of
 * `idMap` is replaced with its mapped id; everything else is copied as-is.
 * Relation cells (arrays of row ids), view filters (property ids) and
 * relation-property configs (database ids) are all covered by this one rule
 * because they store bare uuid strings.
 */
export function remapIdsDeep(value: unknown, idMap: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => remapIdsDeep(entry, idMap));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = remapIdsDeep(entry, idMap);
    }
    return out;
  }
  return value;
}
