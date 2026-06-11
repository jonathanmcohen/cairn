import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as Y from 'yjs';
import * as schema from '@/db/schema';
import { applyProseJsonToFragment } from '@/lib/collab/apply-prose';
import { getStorage } from '@/lib/files/get-storage';
import { incrementStorageUsed } from '@/lib/quotas/quota';
import { appVersion } from '@/lib/version';
import { parseDbUrl } from '@/server/cli-internal';
import { type ContentRemapMaps, remapDocContent, remapIdsDeep } from './content-remap';
import { type BackupJob, type SelectiveRestoreJobResult, trackAsyncJob } from './jobs';

/**
 * v0.10.0 C4 — selective restore: copy a page subtree (or a whole workspace's
 * pages) OUT of a snapshot bundle INTO a live workspace without touching any
 * existing row.
 *
 * Pipeline (runSelectiveRestore):
 *   1. `pg_restore --no-owner` the full dump into a SCRATCH DATABASE
 *      `cairn_restore_<8hex>_<epochSeconds>` on the same Postgres instance.
 *      The plan said "scratch schema", but pg_restore cannot retarget schemas
 *      on a custom-format dump without fragile SQL rewriting; a scratch
 *      database is the established equivalent in this codebase (the upgrade
 *      dry-run, src/lib/upgrade/preview.ts, already creates/drops
 *      `cairn_preview_*` databases the same way) and the cleanup guarantees
 *      are identical: dropped in `finally` on success AND failure, plus a
 *      crash-resilience sweep at job start that force-drops any leftover
 *      `cairn_restore_*` DB older than 1 h (its birth time is embedded in the
 *      name). CREATEDB is available because the app's role owns the instance
 *      in the documented single-container deploy (POSTGRES_USER in the
 *      official image is a superuser; verified on the dev container and the
 *      CI service, both pgvector/pg18 images).
 *   2. Extract the selected rows from the scratch DB (recursive CTE over the
 *      snapshot's `pages` for mode 'page'; all non-deleted pages of the
 *      source workspace for mode 'workspace'). Soft-deleted pages are
 *      excluded; E2E-encrypted pages (and their descendants) are excluded too
 *      because their DEKs do not transfer with a row copy.
 *   3. Remap (pure, unit-tested): every restored entity gets a NEW uuid;
 *      `workspace_id` is stamped with the target everywhere; the subtree
 *      root's parent becomes NULL (top-level page in the target); parent
 *      chains, database/property/row/cell/view links, comment targets and
 *      embedded content references are rewritten through the id map.
 *      Restored rows are attributed (`created_by`/`author_id`/`uploaded_by`)
 *      to the admin who ran the restore — the snapshot's user ids may not
 *      exist in this instance, and `users` rows are deliberately NOT copied.
 *   4. Files: a row is restored only when its binary still exists in the
 *      file storage (the uploads tar is a separate artefact and may never
 *      have been restored). Present binaries are COPIED to a new
 *      `<targetWorkspace>/<newId><ext>` path so the copy never shares a blob
 *      with the original (trash purge deletes blobs by path); missing ones
 *      are counted in `skippedFiles` and their file/image nodes stripped
 *      from the restored content.
 *   5. Insert into the live DB in FK order inside ONE transaction (pages
 *      parents-before-children, then files, databases → properties → rows →
 *      cells → views, comments last). `content_text`/`content_tsv` need no
 *      handling: the `pages_search_sync_trigger` BEFORE INSERT trigger
 *      (drizzle/migrations/0003) derives them from `content` on every write.
 *   6. Yjs: each restored page gets a fresh `page_yjs` state encoded from its
 *      remapped content via the SAME schema-free writer the collab server
 *      uses (applyProseJsonToFragment, src/lib/collab/apply-prose.ts), so the
 *      editor renders the restored doc on first open.
 *
 * NO maintenance (read-only) mode is engaged, unlike the C2 full restore:
 * a selective restore is purely ADDITIVE — it only ever INSERTs brand-new
 * rows with brand-new ids, so concurrent writes cannot race a table drop the
 * way they can during `pg_restore --clean` of the live DB.
 *
 * Version guard: a snapshot whose manifest MAJOR.MINOR is NEWER than the
 * running app is refused upfront (its schema may contain tables/columns this
 * code has never seen). OLDER snapshots are attempted; if the extraction
 * hits a missing column/table (pre-v0.9 schemas), the undefined-column/table
 * error is translated into a friendly "snapshot schema too old — use full
 * restore" failure.
 */

export class SelectiveRestoreError extends Error {
  constructor(
    public readonly code:
      | 'source-not-found'
      | 'snapshot-schema-too-old'
      | 'encrypted-passphrase-missing'
      | 'pg-restore-failed',
    message: string,
  ) {
    super(message);
    this.name = 'SelectiveRestoreError';
  }
}

// ---------------------------------------------------------------------------
// Version guard
// ---------------------------------------------------------------------------

/**
 * True when the snapshot's MAJOR.MINOR is strictly newer than the running
 * app's. Unparseable versions (hand-rolled manifests, 'unknown') answer false
 * — the restore is attempted and the schema-tolerance path covers the rest.
 */
export function snapshotVersionTooNew(snapshotVersion: string, currentVersion: string): boolean {
  const parse = (v: string): [number, number] | null => {
    const m = /^v?(\d+)\.(\d+)/.exec(v.trim());
    return m?.[1] && m[2] ? [Number(m[1]), Number(m[2])] : null;
  };
  const snap = parse(snapshotVersion);
  const cur = parse(currentVersion);
  if (!snap || !cur) return false;
  if (snap[0] !== cur[0]) return snap[0] > cur[0];
  return snap[1] > cur[1];
}

// ---------------------------------------------------------------------------
// Extraction (scratch-DB reads)
// ---------------------------------------------------------------------------

export type SnapshotSelection =
  | { mode: 'page'; sourcePageId: string }
  | { mode: 'workspace'; sourceWorkspaceId: string };

export type ExtractedPage = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  cover: unknown;
  content: unknown;
  metadata: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  translationOfPageId: string | null;
  translationLocale: string | null;
};

export type ExtractedDatabase = {
  id: string;
  pageId: string;
  name: string;
  config: unknown;
  createdAt: Date;
  archivedAt: Date | null;
};

export type ExtractedProperty = {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  config: unknown;
  position: number;
};

export type ExtractedDbRow = {
  id: string;
  databaseId: string;
  parentRowId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  body: unknown;
};

export type ExtractedCell = { rowId: string; propertyId: string; value: unknown };

export type ExtractedView = {
  id: string;
  databaseId: string;
  type: string;
  name: string;
  config: unknown;
  position: number;
};

export type ExtractedComment = {
  id: string;
  pageId: string | null;
  targetType: string;
  targetId: string | null;
  body: string;
  anchor: unknown;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExtractedFile = {
  id: string;
  pageId: string | null;
  name: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: Date;
};

export type ExtractedRows = {
  pages: ExtractedPage[];
  databases: ExtractedDatabase[];
  properties: ExtractedProperty[];
  rows: ExtractedDbRow[];
  cells: ExtractedCell[];
  views: ExtractedView[];
  comments: ExtractedComment[];
  files: ExtractedFile[];
};

type ScratchSql = ReturnType<typeof postgres>;

/**
 * Read the selected rows out of the scratch database. Old snapshots whose
 * schema predates a referenced column/table surface as the friendly
 * 'snapshot-schema-too-old' error (spec'd fallback: use the C2 full restore).
 */
export async function extractSnapshotRows(
  sql: ScratchSql,
  selection: SnapshotSelection,
): Promise<ExtractedRows> {
  try {
    const pages = (selection.mode === 'page'
      ? await sql`
            WITH RECURSIVE subtree AS (
              SELECT * FROM pages
              WHERE id = ${selection.sourcePageId} AND deleted_at IS NULL AND encrypted = false
              UNION ALL
              SELECT p.* FROM pages p
              JOIN subtree s ON p.parent_id = s.id
              WHERE p.deleted_at IS NULL AND p.encrypted = false
            )
            SELECT id, parent_id AS "parentId", title, icon, cover_url AS "coverUrl", cover,
                   content, metadata, status, created_at AS "createdAt", updated_at AS "updatedAt",
                   translation_of_page_id AS "translationOfPageId",
                   translation_locale AS "translationLocale"
            FROM subtree
          `
      : await sql`
            SELECT id, parent_id AS "parentId", title, icon, cover_url AS "coverUrl", cover,
                   content, metadata, status, created_at AS "createdAt", updated_at AS "updatedAt",
                   translation_of_page_id AS "translationOfPageId",
                   translation_locale AS "translationLocale"
            FROM pages
            WHERE workspace_id = ${selection.sourceWorkspaceId}
              AND deleted_at IS NULL AND encrypted = false
          `) as unknown as ExtractedPage[];

    if (pages.length === 0) {
      throw new SelectiveRestoreError(
        'source-not-found',
        selection.mode === 'page'
          ? `source page ${selection.sourcePageId} not found in the snapshot (or it is deleted/encrypted)`
          : `no restorable pages found for workspace ${selection.sourceWorkspaceId} in the snapshot`,
      );
    }

    const pageIds = pages.map((p) => p.id);

    const databases = (await sql`
      SELECT id, page_id AS "pageId", name, config, created_at AS "createdAt",
             archived_at AS "archivedAt"
      FROM databases WHERE page_id IN ${sql(pageIds)}
    `) as unknown as ExtractedDatabase[];
    const databaseIds = databases.map((d) => d.id);

    const properties =
      databaseIds.length === 0
        ? []
        : ((await sql`
            SELECT id, database_id AS "databaseId", name, type, config, position
            FROM db_properties WHERE database_id IN ${sql(databaseIds)}
          `) as unknown as ExtractedProperty[]);

    const rows =
      databaseIds.length === 0
        ? []
        : ((await sql`
            SELECT id, database_id AS "databaseId", parent_row_id AS "parentRowId",
                   created_at AS "createdAt", updated_at AS "updatedAt",
                   archived_at AS "archivedAt", body
            FROM db_rows WHERE database_id IN ${sql(databaseIds)}
          `) as unknown as ExtractedDbRow[]);
    const rowIds = rows.map((r) => r.id);

    const cells =
      rowIds.length === 0
        ? []
        : ((await sql`
            SELECT row_id AS "rowId", property_id AS "propertyId", value
            FROM db_cells WHERE row_id IN ${sql(rowIds)}
          `) as unknown as ExtractedCell[]);

    const views =
      databaseIds.length === 0
        ? []
        : ((await sql`
            SELECT id, database_id AS "databaseId", type, name, config, position
            FROM db_views WHERE database_id IN ${sql(databaseIds)}
          `) as unknown as ExtractedView[]);

    const comments = (await sql`
      SELECT id, page_id AS "pageId", target_type AS "targetType", target_id AS "targetId",
             body, anchor, resolved_at AS "resolvedAt", created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM comments WHERE page_id IN ${sql(pageIds)}
    `) as unknown as ExtractedComment[];

    const files = (await sql`
      SELECT id, page_id AS "pageId", name, mime_type AS "mimeType", size, path,
             created_at AS "createdAt"
      FROM files WHERE page_id IN ${sql(pageIds)}
    `) as unknown as ExtractedFile[];

    return { pages, databases, properties, rows, cells, views, comments, files };
  } catch (err) {
    // 42703 undefined_column / 42P01 undefined_table: the snapshot predates a
    // column/table this extraction expects (e.g. pre-v0.9 `pages.status`).
    const code = (err as { code?: string }).code;
    if (code === '42703' || code === '42P01') {
      throw new SelectiveRestoreError(
        'snapshot-schema-too-old',
        `snapshot schema is too old for selective restore (${(err as Error).message}); use the full restore instead`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Remap (pure — unit-tested without a database)
// ---------------------------------------------------------------------------

export type RemapOptions = {
  targetWorkspaceId: string;
  /** User id stamped as created_by/author_id/uploaded_by on every restored row. */
  restoredBy: string;
  /** File ids whose binary exists in storage; all others are skipped + stripped. */
  availableFileIds: ReadonlySet<string>;
  /** Test seam: deterministic id factory. Defaults to randomUUID. */
  newId?: () => string;
};

export type RemappedFile = {
  row: typeof schema.files.$inferInsert;
  /** Storage path of the ORIGINAL blob, copied to `row.path` at insert time. */
  sourcePath: string;
};

export type RemappedRows = {
  /** Parent-before-child order (safe to insert sequentially or chunked). */
  pages: (typeof schema.pages.$inferInsert)[];
  files: RemappedFile[];
  databases: (typeof schema.databases.$inferInsert)[];
  properties: (typeof schema.dbProperties.$inferInsert)[];
  /** Parent-before-child order. */
  rows: (typeof schema.dbRows.$inferInsert)[];
  cells: (typeof schema.dbCells.$inferInsert)[];
  views: (typeof schema.dbViews.$inferInsert)[];
  comments: (typeof schema.comments.$inferInsert)[];
  idMap: {
    pages: Map<string, string>;
    databases: Map<string, string>;
    files: Map<string, string>;
    rows: Map<string, string>;
  };
  skippedFiles: number;
};

/** Order entities parent-before-child; unreachable parents become roots. */
function topoSort<T extends { id: string }>(items: T[], parentOf: (item: T) => string | null): T[] {
  const inSet = new Set(items.map((i) => i.id));
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const rawParent = parentOf(item);
    const key = rawParent && inSet.has(rawParent) ? rawParent : null;
    const bucket = children.get(key);
    if (bucket) bucket.push(item);
    else children.set(key, [item]);
  }
  const out: T[] = [];
  const queue = [...(children.get(null) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    out.push(next);
    queue.push(...(children.get(next.id) ?? []));
  }
  // Cycles cannot happen through valid parent FKs, but never lose rows.
  if (out.length < items.length) {
    const seen = new Set(out.map((i) => i.id));
    for (const item of items) if (!seen.has(item.id)) out.push(item);
  }
  return out;
}

/**
 * Pure remap of the extracted snapshot rows into insert-ready live rows. All
 * new ids; workspace stamped; parent chains, FK links and embedded content
 * references rewritten; sharing/lock/encryption state deliberately reset
 * (restored pages are private drafts of their content, never published).
 */
export function remapSnapshotRows(extracted: ExtractedRows, opts: RemapOptions): RemappedRows {
  const newId = opts.newId ?? randomUUID;

  const pageIdMap = new Map(extracted.pages.map((p) => [p.id, newId()]));
  const databaseIdMap = new Map(extracted.databases.map((d) => [d.id, newId()]));
  const propertyIdMap = new Map(extracted.properties.map((p) => [p.id, newId()]));
  const rowIdMap = new Map(extracted.rows.map((r) => [r.id, newId()]));
  const viewIdMap = new Map(extracted.views.map((v) => [v.id, newId()]));
  const commentIdMap = new Map(extracted.comments.map((c) => [c.id, newId()]));

  const fileIdMap = new Map<string, string>();
  const skippedFileIds = new Set<string>();
  for (const file of extracted.files) {
    if (opts.availableFileIds.has(file.id)) fileIdMap.set(file.id, newId());
    else skippedFileIds.add(file.id);
  }

  // One combined map drives the deep-remap of cell values / configs / anchors
  // (relation cells hold row ids, view filters hold property ids, relation
  // property configs hold database ids — all bare uuid strings).
  const allIds = new Map<string, string>([
    ...pageIdMap,
    ...databaseIdMap,
    ...propertyIdMap,
    ...rowIdMap,
    ...fileIdMap,
  ]);

  const contentMaps: ContentRemapMaps = {
    pageIds: pageIdMap,
    databaseIds: databaseIdMap,
    fileIds: fileIdMap,
    skippedFileIds,
  };

  const validStatuses = new Set<string>(schema.PAGE_STATUSES);

  const pages = topoSort(extracted.pages, (p) => p.parentId).map(
    (p): typeof schema.pages.$inferInsert => {
      const mappedId = pageIdMap.get(p.id);
      if (!mappedId) throw new Error(`page id ${p.id} missing from id map`);
      const mappedParent = p.parentId ? (pageIdMap.get(p.parentId) ?? null) : null;
      return {
        id: mappedId,
        workspaceId: opts.targetWorkspaceId,
        // The subtree root's parent lives outside the restored set → NULL
        // (top-level page in the target workspace).
        parentId: mappedParent,
        spaceId: null, // spaces are workspace-local and not part of the restore
        title: p.title,
        icon: p.icon,
        coverUrl: p.coverUrl,
        cover: p.cover ?? {},
        content: remapDocContent(p.content, contentMaps),
        metadata: (p.metadata ?? {}) as Record<string, unknown>,
        status: validStatuses.has(p.status) ? (p.status as schema.PageStatus) : 'draft',
        // Sharing/lock/encryption state intentionally reset: published:false,
        // no public slug, no lock, encrypted:false (encrypted pages were
        // excluded at extraction).
        createdBy: opts.restoredBy,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        translationOfPageId: p.translationOfPageId
          ? (pageIdMap.get(p.translationOfPageId) ?? null)
          : null,
        translationLocale: p.translationLocale,
      };
    },
  );

  const files: RemappedFile[] = [];
  for (const f of extracted.files) {
    const mappedId = fileIdMap.get(f.id);
    if (!mappedId) continue; // binary missing — skipped
    const ext = path.extname(f.path).slice(0, 9); // mirrors storeUpload's bound
    files.push({
      sourcePath: f.path,
      row: {
        id: mappedId,
        workspaceId: opts.targetWorkspaceId,
        pageId: f.pageId ? (pageIdMap.get(f.pageId) ?? null) : null,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        path: `${opts.targetWorkspaceId}/${mappedId}${ext}`,
        uploadedBy: opts.restoredBy,
        createdAt: f.createdAt,
      },
    });
  }

  const databases = extracted.databases.flatMap((d): (typeof schema.databases.$inferInsert)[] => {
    const mappedId = databaseIdMap.get(d.id);
    const mappedPage = pageIdMap.get(d.pageId);
    if (!mappedId || !mappedPage) return [];
    return [
      {
        id: mappedId,
        workspaceId: opts.targetWorkspaceId,
        pageId: mappedPage,
        name: d.name,
        config: remapIdsDeep(d.config ?? {}, allIds) as object,
        createdBy: opts.restoredBy,
        createdAt: d.createdAt,
        archivedAt: d.archivedAt,
      },
    ];
  });

  const properties = extracted.properties.flatMap(
    (p): (typeof schema.dbProperties.$inferInsert)[] => {
      const mappedId = propertyIdMap.get(p.id);
      const mappedDb = databaseIdMap.get(p.databaseId);
      if (!mappedId || !mappedDb) return [];
      return [
        {
          id: mappedId,
          databaseId: mappedDb,
          name: p.name,
          type: p.type as schema.PropertyType,
          config: remapIdsDeep(p.config ?? {}, allIds),
          position: p.position,
        },
      ];
    },
  );

  const rows = topoSort(extracted.rows, (r) => r.parentRowId).flatMap(
    (r): (typeof schema.dbRows.$inferInsert)[] => {
      const mappedId = rowIdMap.get(r.id);
      const mappedDb = databaseIdMap.get(r.databaseId);
      if (!mappedId || !mappedDb) return [];
      return [
        {
          id: mappedId,
          databaseId: mappedDb,
          parentRowId: r.parentRowId ? (rowIdMap.get(r.parentRowId) ?? null) : null,
          createdBy: opts.restoredBy,
          updatedBy: null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          archivedAt: r.archivedAt,
          body: r.body === null ? null : remapDocContent(r.body, contentMaps),
        },
      ];
    },
  );

  const cells = extracted.cells.flatMap((c): (typeof schema.dbCells.$inferInsert)[] => {
    const mappedRow = rowIdMap.get(c.rowId);
    const mappedProperty = propertyIdMap.get(c.propertyId);
    if (!mappedRow || !mappedProperty) return [];
    return [
      {
        rowId: mappedRow,
        propertyId: mappedProperty,
        value: remapIdsDeep(c.value, allIds),
      },
    ];
  });

  const views = extracted.views.flatMap((v): (typeof schema.dbViews.$inferInsert)[] => {
    const mappedId = viewIdMap.get(v.id);
    const mappedDb = databaseIdMap.get(v.databaseId);
    if (!mappedId || !mappedDb) return [];
    return [
      {
        id: mappedId,
        databaseId: mappedDb,
        type: v.type as schema.ViewType,
        name: v.name,
        // View configs only reference their own database's property ids, all
        // of which are in the map — deep remap covers them; nothing to drop.
        config: remapIdsDeep(v.config ?? {}, allIds),
        position: v.position,
      },
    ];
  });

  const comments = extracted.comments.flatMap((c): (typeof schema.comments.$inferInsert)[] => {
    const mappedId = commentIdMap.get(c.id);
    const mappedPage = c.pageId ? pageIdMap.get(c.pageId) : null;
    if (!mappedId || !mappedPage) return [];
    // A comment on a file whose binary vanished would dangle — drop it.
    if (c.targetId && skippedFileIds.has(c.targetId)) return [];
    return [
      {
        id: mappedId,
        workspaceId: opts.targetWorkspaceId,
        pageId: mappedPage,
        targetType: c.targetType as schema.Comment['targetType'],
        targetId: c.targetId ? ((allIds.get(c.targetId) ?? c.targetId) as string) : null,
        authorId: opts.restoredBy,
        body: c.body,
        anchor: remapIdsDeep(c.anchor, allIds) as schema.Comment['anchor'],
        chatMessageId: null, // never re-link a restored copy to a chat thread
        resolvedAt: c.resolvedAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      },
    ];
  });

  return {
    pages,
    files,
    databases,
    properties,
    rows,
    cells,
    views,
    comments,
    idMap: { pages: pageIdMap, databases: databaseIdMap, files: fileIdMap, rows: rowIdMap },
    skippedFiles: skippedFileIds.size,
  };
}

// ---------------------------------------------------------------------------
// Yjs state regeneration
// ---------------------------------------------------------------------------

/**
 * Encode a fresh page_yjs state from ProseMirror JSON using the SAME
 * schema-free writer the collab process uses (applyProseJsonToFragment), so
 * custom nodes (callout/database/…) round-trip exactly like a live session
 * would have produced. A fresh doc is correct here because the page id is
 * brand-new — there is no existing Yjs history to merge against.
 */
export function encodePageYjsState(content: unknown): Buffer {
  const ydoc = new Y.Doc();
  try {
    ydoc.transact(() => {
      applyProseJsonToFragment(ydoc.getXmlFragment('default'), content);
    });
    return Buffer.from(Y.encodeStateAsUpdate(ydoc));
  } finally {
    ydoc.destroy();
  }
}

// ---------------------------------------------------------------------------
// Live-DB insert
// ---------------------------------------------------------------------------

type Db = PostgresJsDatabase<typeof schema>;

/** Bulk-insert chunk size; well under postgres' 65534-parameter statement cap. */
const CHUNK = 200;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/**
 * Insert the remapped rows into the live DB in FK order, inside one
 * transaction. `copyFile` stages each surviving file blob to its new path
 * (inside the txn, mirroring storeUpload: an orphan blob after a rollback is
 * invisible to the quota counter and reconciled by the existing backstop).
 *
 * Self-FK ordering note: pages/rows arrive parent-before-child (topoSort) and
 * FK constraints are AFTER-statement checks in Postgres, so chunked bulk
 * inserts in that order always see the parent row first.
 */
export async function insertRestoredRows(
  db: Db,
  remapped: RemappedRows,
  deps: { copyFile: (sourcePath: string, destPath: string) => Promise<void> },
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const batch of chunks(remapped.pages)) {
      await tx.insert(schema.pages).values(batch);
    }

    // Regenerate collab state for every restored page from its (remapped)
    // content so the editor binds the restored doc on first open.
    const yjsRows = remapped.pages.flatMap((p) =>
      p.id ? [{ pageId: p.id, state: encodePageYjsState(p.content) }] : [],
    );
    for (const batch of chunks(yjsRows)) {
      await tx.insert(schema.pageYjs).values(batch);
    }

    let fileBytes = 0;
    for (const file of remapped.files) {
      if (!file.row.path) continue;
      await deps.copyFile(file.sourcePath, file.row.path);
      fileBytes += file.row.size;
    }
    for (const batch of chunks(remapped.files.map((f) => f.row))) {
      await tx.insert(schema.files).values(batch);
    }
    if (fileBytes > 0) {
      await incrementStorageUsed(tx, remapped.files[0]?.row.workspaceId ?? '', fileBytes);
    }

    for (const batch of chunks(remapped.databases)) {
      await tx.insert(schema.databases).values(batch);
    }
    for (const batch of chunks(remapped.properties)) {
      await tx.insert(schema.dbProperties).values(batch);
    }
    for (const batch of chunks(remapped.rows)) {
      await tx.insert(schema.dbRows).values(batch);
    }
    for (const batch of chunks(remapped.cells)) {
      await tx.insert(schema.dbCells).values(batch);
    }
    for (const batch of chunks(remapped.views)) {
      await tx.insert(schema.dbViews).values(batch);
    }
    for (const batch of chunks(remapped.comments)) {
      await tx.insert(schema.comments).values(batch);
    }
  });
}

// ---------------------------------------------------------------------------
// Scratch-database lifecycle + pg_restore
// ---------------------------------------------------------------------------

const SCRATCH_PREFIX = 'cairn_restore_';
const SCRATCH_MAX_AGE_MS = 60 * 60 * 1000; // 1 h crash-resilience sweep
const SCRATCH_NAME_RE = /^cairn_restore_[a-z0-9_]+$/;

function withDbName(databaseUrl: string, dbName: string): string {
  const u = new URL(databaseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

/**
 * Drop leftover `cairn_restore_*` scratch DBs whose embedded epoch-seconds
 * birth stamp is older than 1 h — a crashed job's `finally` never ran.
 */
async function dropStaleScratchDatabases(admin: ScratchSql): Promise<void> {
  const rows = (await admin`
    SELECT datname FROM pg_database WHERE datname LIKE ${`${SCRATCH_PREFIX}%`}
  `) as unknown as { datname: string }[];
  for (const { datname } of rows) {
    if (!SCRATCH_NAME_RE.test(datname)) continue;
    const stamp = /_(\d+)$/.exec(datname)?.[1];
    const bornMs = stamp ? Number(stamp) * 1000 : 0;
    if (Date.now() - bornMs < SCRATCH_MAX_AGE_MS) continue;
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    } catch {
      // best-effort: an in-use or already-gone DB is not this job's problem
    }
  }
}

const STDERR_TAIL_BYTES = 2_048;

/** `pg_restore --no-owner` the dump into the scratch DB (same conn style as the CLI). */
function runPgRestore(bundlePath: string, scratchUrl: string): Promise<void> {
  const conn = parseDbUrl(scratchUrl);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pg_restore',
      [
        '--no-owner',
        '-h',
        conn.host,
        '-p',
        String(conn.port),
        '-U',
        conn.user,
        '-d',
        conn.database,
        bundlePath,
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, PGPASSWORD: conn.password },
      },
    );
    let stderrTail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });
    child.on('error', (err) => reject(new SelectiveRestoreError('pg-restore-failed', err.message)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new SelectiveRestoreError(
            'pg-restore-failed',
            `pg_restore exited with code ${code}${stderrTail.trim() ? `: ${stderrTail.trim()}` : ''}`,
          ),
        );
      }
    });
  });
}

async function readAll(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type SelectiveRestoreParams = {
  databaseUrl: string;
  /** Resolved bundle path (`.dump` or `.dump.enc`). */
  bundlePath: string;
  selection: SnapshotSelection;
  targetWorkspaceId: string;
  restoredBy: string;
};

export async function runSelectiveRestore(
  params: SelectiveRestoreParams,
): Promise<SelectiveRestoreJobResult> {
  const adminUrl = new URL(params.databaseUrl);
  adminUrl.pathname = '/postgres';
  const scratchName = `${SCRATCH_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 8)}_${Math.floor(
    Date.now() / 1000,
  )}`;

  const admin = postgres(adminUrl.toString(), { max: 1 });
  let scratchCreated = false;
  let tmpDir: string | null = null;
  try {
    await dropStaleScratchDatabases(admin);
    await admin.unsafe(`CREATE DATABASE "${scratchName}"`);
    scratchCreated = true;

    // Encrypted bundles: decrypt to a private tmp sibling first (same
    // envelope reader the CLI restore uses), removed in `finally`.
    let restoreInput = params.bundlePath;
    if (restoreInput.endsWith('.enc')) {
      const passphrase = process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE;
      if (!passphrase) {
        throw new SelectiveRestoreError(
          'encrypted-passphrase-missing',
          'bundle is encrypted but CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is unset on the server',
        );
      }
      const { decryptBackup } = await import('./encryption');
      tmpDir = await mkdtemp(path.join(tmpdir(), 'cairn-selective-restore-'));
      const plainPath = path.join(tmpDir, 'bundle.dump');
      await pipeline(
        createReadStream(restoreInput),
        decryptBackup(passphrase),
        createWriteStream(plainPath),
      );
      restoreInput = plainPath;
    }

    const scratchUrl = withDbName(params.databaseUrl, scratchName);
    await runPgRestore(restoreInput, scratchUrl);

    const scratchSql = postgres(scratchUrl, { max: 1 });
    let extracted: ExtractedRows;
    try {
      extracted = await extractSnapshotRows(scratchSql, params.selection);
    } finally {
      await scratchSql.end({ timeout: 5 });
    }

    // Files: only rows whose binary still exists in storage survive (the
    // uploads tar is a separate artefact; the DB dump never carries blobs).
    const storage = getStorage();
    const availableFileIds = new Set<string>();
    for (const file of extracted.files) {
      if (await storage.exists(file.path)) availableFileIds.add(file.id);
    }

    const remapped = remapSnapshotRows(extracted, {
      targetWorkspaceId: params.targetWorkspaceId,
      restoredBy: params.restoredBy,
      availableFileIds,
    });

    const liveSql = postgres(params.databaseUrl, { max: 1 });
    try {
      const db = drizzle(liveSql, { schema });
      await insertRestoredRows(db, remapped, {
        copyFile: async (sourcePath, destPath) => {
          const body = await readAll(storage.read(sourcePath));
          await storage.put(destPath, body, 'application/octet-stream');
        },
      });
    } finally {
      await liveSql.end({ timeout: 5 });
    }

    return {
      pagesRestored: remapped.pages.length,
      rowsRestored: remapped.rows.length,
      skippedFiles: remapped.skippedFiles,
    };
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    if (scratchCreated) {
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
      } catch {
        // leftover is swept by the next job's stale-scratch pass
      }
    }
    await admin.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------
// Job start (route-facing)
// ---------------------------------------------------------------------------

export type StartSelectiveRestoreJobResult =
  | { ok: true; job: BackupJob }
  | { ok: false; error: 'bundle-missing' | 'encrypted-passphrase-missing' }
  | {
      ok: false;
      error: 'snapshot-version-newer';
      snapshotVersion: string;
      currentVersion: string;
    };

/**
 * Upfront gates (friendly route errors instead of doomed jobs), then spawn
 * the async pipeline through the shared job registry. No maintenance mode —
 * see the module header: a selective restore is additive-only.
 */
export async function startSelectiveRestoreJob(opts: {
  /** Bundle directory (CAIRN_BACKUP_DIR). */
  dir: string;
  /** Bundle timestamp slug. */
  ts: string;
  selection: SnapshotSelection;
  targetWorkspaceId: string;
  restoredBy: string;
  databaseUrl: string;
}): Promise<StartSelectiveRestoreJobResult> {
  const plainPath = path.join(opts.dir, `cairn-backup-${opts.ts}.dump`);
  const encPath = `${plainPath}.enc`;
  const bundlePath = existsSync(plainPath) ? plainPath : existsSync(encPath) ? encPath : null;
  if (!bundlePath) return { ok: false, error: 'bundle-missing' };

  if (bundlePath.endsWith('.enc') && !process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE) {
    return { ok: false, error: 'encrypted-passphrase-missing' };
  }

  // Version guard: refuse snapshots from a NEWER MAJOR.MINOR than this app —
  // their schema may contain structures this extraction has never seen.
  // Bundles without a readable manifest (operator-uploaded dumps) are
  // attempted; the schema-tolerance path covers genuinely old dumps.
  const currentVersion = appVersion();
  let snapshotVersion = 'unknown';
  try {
    const manifestRaw = await readFile(
      path.join(opts.dir, `cairn-backup-${opts.ts}.manifest.json`),
      'utf8',
    );
    const manifest = JSON.parse(manifestRaw) as { version?: unknown };
    if (typeof manifest.version === 'string') snapshotVersion = manifest.version;
  } catch {
    // no manifest — attempt the restore
  }
  if (snapshotVersionTooNew(snapshotVersion, currentVersion)) {
    return { ok: false, error: 'snapshot-version-newer', snapshotVersion, currentVersion };
  }

  const job = trackAsyncJob({
    kind: 'selective-restore',
    run: () =>
      runSelectiveRestore({
        databaseUrl: opts.databaseUrl,
        bundlePath,
        selection: opts.selection,
        targetWorkspaceId: opts.targetWorkspaceId,
        restoredBy: opts.restoredBy,
      }),
  });
  return { ok: true, job };
}
