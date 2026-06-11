import { describe, expect, it } from 'vitest';
import {
  type ExtractedRows,
  remapSnapshotRows,
  snapshotVersionTooNew,
} from '@/lib/backups/selective-restore';

// v0.10.0 C4 — pure core of the selective restore: the version guard and the
// id-map remap over extracted row arrays. Both are pure functions by design
// (RemapOptions.newId is the deterministic test seam) so this suite needs
// neither pg_restore nor a database; the scratch-DB lifecycle and live insert
// are covered by tests/e2e/item-C4-selective-restore.spec.ts.

describe('snapshotVersionTooNew', () => {
  it('refuses snapshots with a newer MAJOR or MINOR than the app', () => {
    expect(snapshotVersionTooNew('1.0.0', '0.10.0')).toBe(true);
    expect(snapshotVersionTooNew('0.11.0', '0.10.3')).toBe(true);
  });

  it('allows same and older MAJOR.MINOR (patch is ignored)', () => {
    expect(snapshotVersionTooNew('0.10.5', '0.10.0')).toBe(false);
    expect(snapshotVersionTooNew('0.9.19', '0.10.0')).toBe(false);
    expect(snapshotVersionTooNew('0.10.0', '0.10.0')).toBe(false);
  });

  it('attempts unparseable versions (manifest-less uploads, "unknown")', () => {
    expect(snapshotVersionTooNew('unknown', '0.10.0')).toBe(false);
    expect(snapshotVersionTooNew('0.10.0', 'unknown')).toBe(false);
  });
});

// --- remap fixture -----------------------------------------------------------

const WS_TARGET = 'f0000000-0000-0000-0000-00000000000f';
const ADMIN = 'e0000000-0000-0000-0000-00000000000e';

const PAGE_A = '10000000-0000-0000-0000-000000000001';
const PAGE_B = '10000000-0000-0000-0000-000000000002';
const OUTSIDE_PARENT = '10000000-0000-0000-0000-00000000000f';
const DB_1 = '20000000-0000-0000-0000-000000000001';
const PROP_1 = '30000000-0000-0000-0000-000000000001';
const ROW_1 = '40000000-0000-0000-0000-000000000001';
const ROW_2 = '40000000-0000-0000-0000-000000000002';
const VIEW_1 = '50000000-0000-0000-0000-000000000001';
const COMMENT_1 = '60000000-0000-0000-0000-000000000001';
const FILE_OK = '70000000-0000-0000-0000-000000000001';
const FILE_GONE = '70000000-0000-0000-0000-000000000002';

const NOW = new Date('2026-06-01T00:00:00Z');

function fixture(): ExtractedRows {
  return {
    pages: [
      // B listed FIRST to prove the remap topo-sorts parents before children.
      {
        id: PAGE_B,
        parentId: PAGE_A,
        title: 'Child B',
        icon: null,
        coverUrl: null,
        cover: {},
        content: {
          type: 'doc',
          content: [
            { type: 'database', attrs: { databaseId: DB_1 } },
            { type: 'cairnImage', attrs: { fileId: FILE_GONE, src: 'x', alt: '' } },
          ],
        },
        metadata: {},
        status: 'published',
        createdAt: NOW,
        updatedAt: NOW,
        translationOfPageId: null,
        translationLocale: null,
      },
      {
        id: PAGE_A,
        parentId: OUTSIDE_PARENT, // outside the restored set → becomes a root
        title: 'Root A',
        icon: 'emoji::🪨',
        coverUrl: null,
        cover: {},
        content: {
          type: 'doc',
          content: [{ type: 'pageEmbed', attrs: { targetPageId: PAGE_B, label: 'B' } }],
        },
        metadata: { custom: true },
        status: 'bogus-status', // unknown snapshot status → normalized to draft
        createdAt: NOW,
        updatedAt: NOW,
        translationOfPageId: null,
        translationLocale: null,
      },
    ],
    databases: [
      { id: DB_1, pageId: PAGE_B, name: 'Tasks', config: {}, createdAt: NOW, archivedAt: null },
    ],
    properties: [
      {
        id: PROP_1,
        databaseId: DB_1,
        name: 'Linked',
        type: 'relation',
        config: { databaseId: DB_1 },
        position: 0,
      },
    ],
    rows: [
      // Child row first — same topo-sort proof as pages.
      {
        id: ROW_2,
        databaseId: DB_1,
        parentRowId: ROW_1,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        body: null,
      },
      {
        id: ROW_1,
        databaseId: DB_1,
        parentRowId: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        body: null,
      },
    ],
    cells: [
      // Relation cell value embeds a row id → deep remap.
      { rowId: ROW_1, propertyId: PROP_1, value: [ROW_2] },
    ],
    views: [
      {
        id: VIEW_1,
        databaseId: DB_1,
        type: 'table',
        name: 'All',
        config: { sorts: [{ propertyId: PROP_1, dir: 'asc' }] },
        position: 0,
      },
    ],
    comments: [
      {
        id: COMMENT_1,
        pageId: PAGE_B,
        targetType: 'db_row',
        targetId: ROW_1,
        body: 'hello',
        anchor: null,
        resolvedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    files: [
      {
        id: FILE_OK,
        pageId: PAGE_B,
        name: 'pic.png',
        mimeType: 'image/png',
        size: 10,
        path: `wsold/${FILE_OK}.png`,
        createdAt: NOW,
      },
      {
        id: FILE_GONE,
        pageId: PAGE_B,
        name: 'lost.png',
        mimeType: 'image/png',
        size: 20,
        path: `wsold/${FILE_GONE}.png`,
        createdAt: NOW,
      },
    ],
  };
}

function deterministicIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `99999999-0000-0000-0000-${String(n).padStart(12, '0')}`;
  };
}

describe('remapSnapshotRows', () => {
  it('renames every entity, stamps the target workspace + restoring admin, and rewires the parent chain', () => {
    const out = remapSnapshotRows(fixture(), {
      targetWorkspaceId: WS_TARGET,
      restoredBy: ADMIN,
      availableFileIds: new Set([FILE_OK]),
      newId: deterministicIds(),
    });

    // All-new page ids, root first (topo order), root's outside parent → null.
    expect(out.pages).toHaveLength(2);
    const [rootA, childB] = out.pages;
    expect(rootA?.title).toBe('Root A');
    expect(rootA?.parentId).toBeNull();
    expect(rootA?.id).not.toBe(PAGE_A);
    expect(childB?.title).toBe('Child B');
    expect(childB?.parentId).toBe(rootA?.id);
    expect(childB?.id).not.toBe(PAGE_B);
    for (const p of out.pages) {
      expect(p.workspaceId).toBe(WS_TARGET);
      expect(p.createdBy).toBe(ADMIN);
    }

    // Unknown snapshot status normalized; known one preserved.
    expect(rootA?.status).toBe('draft');
    expect(childB?.status).toBe('published');

    // Content remap: embed points at the NEW child id; database node at the
    // NEW database id; missing-file image stripped.
    const rootContent = rootA?.content as { content: { attrs: { targetPageId: string } }[] };
    expect(rootContent.content[0]?.attrs.targetPageId).toBe(childB?.id);
    const childContent = childB?.content as { content: { type: string; attrs?: unknown }[] };
    expect(childContent.content).toHaveLength(1);
    expect(childContent.content[0]?.type).toBe('database');
    expect((childContent.content[0]?.attrs as { databaseId: string }).databaseId).toBe(
      out.databases[0]?.id,
    );

    // Database chain: page link, property/db links, row topo order + parent.
    expect(out.databases[0]?.pageId).toBe(childB?.id);
    expect(out.databases[0]?.workspaceId).toBe(WS_TARGET);
    expect(out.properties[0]?.databaseId).toBe(out.databases[0]?.id);
    // Relation property config's database id remapped via deep map.
    expect((out.properties[0]?.config as { databaseId: string }).databaseId).toBe(
      out.databases[0]?.id,
    );
    expect(out.rows).toHaveLength(2);
    const [parentRow, childRow] = out.rows;
    expect(parentRow?.parentRowId).toBeNull();
    expect(childRow?.parentRowId).toBe(parentRow?.id);
    expect(out.rows.every((r) => r.createdBy === ADMIN)).toBe(true);

    // Cell: row/property remapped AND the relation value's row id remapped.
    expect(out.cells[0]?.rowId).toBe(parentRow?.id);
    expect(out.cells[0]?.propertyId).toBe(out.properties[0]?.id);
    expect(out.cells[0]?.value).toEqual([childRow?.id]);

    // View config property ids remapped.
    expect(out.views[0]?.databaseId).toBe(out.databases[0]?.id);
    expect((out.views[0]?.config as { sorts: { propertyId: string }[] }).sorts[0]?.propertyId).toBe(
      out.properties[0]?.id,
    );

    // Comment: page + target remapped, authored by the restoring admin.
    expect(out.comments[0]?.pageId).toBe(childB?.id);
    expect(out.comments[0]?.targetId).toBe(parentRow?.id);
    expect(out.comments[0]?.authorId).toBe(ADMIN);

    // Files: present binary remapped to a target-workspace path; missing one
    // skipped + counted.
    expect(out.files).toHaveLength(1);
    expect(out.files[0]?.sourcePath).toBe(`wsold/${FILE_OK}.png`);
    expect(out.files[0]?.row.path).toBe(`${WS_TARGET}/${out.files[0]?.row.id}.png`);
    expect(out.files[0]?.row.uploadedBy).toBe(ADMIN);
    expect(out.skippedFiles).toBe(1);
  });

  it('drops comments whose target is a skipped file', () => {
    const extracted = fixture();
    extracted.comments = [
      {
        id: COMMENT_1,
        pageId: PAGE_B,
        targetType: 'file',
        targetId: FILE_GONE,
        body: 'on a vanished file',
        anchor: null,
        resolvedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const out = remapSnapshotRows(extracted, {
      targetWorkspaceId: WS_TARGET,
      restoredBy: ADMIN,
      availableFileIds: new Set([FILE_OK]),
      newId: deterministicIds(),
    });
    expect(out.comments).toHaveLength(0);
  });
});
