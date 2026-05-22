import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { captureDatabase, capturePage } from '@/lib/templates/capture';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => stopPostgres());
beforeEach(async () => {
  await getDb().execute(
    sql`TRUNCATE pages, databases, db_properties, db_views, db_rows, db_cells, workspaces, users, workspace_members RESTART IDENTITY CASCADE`,
  );
});

describe('capturePage', () => {
  it('captures a page subtree and embedded databases (no workspaceId in payload)', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    // host page for the database (databases require a non-null pageId FK)
    const [host] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        parentId: null,
        title: 'Host',
        content: { type: 'doc', content: [] },
        createdBy: u.userId,
      })
      .returning();
    if (!host) throw new Error('host insert failed');
    const [db] = await getDb()
      .insert(schema.databases)
      .values({ workspaceId: u.workspaceId, pageId: host.id, name: 'Tracker', createdBy: u.userId })
      .returning();
    if (!db) throw new Error('db insert failed');
    const [root] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        parentId: null,
        title: 'Root',
        content: { type: 'doc', content: [{ type: 'database', attrs: { databaseId: db.id } }] },
        createdBy: u.userId,
      })
      .returning();
    if (!root) throw new Error('page insert failed');
    const [child] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        parentId: root.id,
        title: 'Child',
        content: { type: 'doc', content: [] },
        createdBy: u.userId,
      })
      .returning();
    if (!child) throw new Error('child insert failed');
    await getDb()
      .insert(schema.dbProperties)
      .values({
        databaseId: db.id,
        name: 'Status',
        type: 'select',
        config: { options: [] },
        position: 0,
      });

    const payload = await capturePage(getDb(), { workspaceId: u.workspaceId, rootPageId: root.id });

    expect(payload.kind).toBe('page');
    expect(payload.rootPageId).toBe(root.id);
    expect(payload.pages.map((p) => p.title).sort()).toEqual(['Child', 'Root']);
    // child points at root via parentId
    expect(payload.pages.find((p) => p.title === 'Child')?.parentId).toBe(root.id);
    // embedded database captured with its property
    expect(payload.databases).toHaveLength(1);
    expect(payload.databases[0]?.id).toBe(db.id);
    expect(payload.databases[0]?.properties[0]?.name).toBe('Status');
    // payload is workspace-free
    expect(JSON.stringify(payload)).not.toContain(u.workspaceId);
  });
});

describe('captureDatabase', () => {
  it('captures properties + views but NOT rows by default', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    const [page] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        parentId: null,
        title: 'P',
        content: { type: 'doc', content: [] },
        createdBy: u.userId,
      })
      .returning();
    if (!page) throw new Error('page insert failed');
    const [db] = await getDb()
      .insert(schema.databases)
      .values({ workspaceId: u.workspaceId, pageId: page.id, name: 'Tracker', createdBy: u.userId })
      .returning();
    if (!db) throw new Error('db insert failed');
    const [prop] = await getDb()
      .insert(schema.dbProperties)
      .values({
        databaseId: db.id,
        name: 'Status',
        type: 'select',
        config: { options: [{ id: 'o1', name: 'Open' }] },
        position: 0,
      })
      .returning();
    if (!prop) throw new Error('prop insert failed');
    await getDb()
      .insert(schema.dbViews)
      .values({
        databaseId: db.id,
        type: 'table',
        name: 'All',
        config: { visibleProperties: [prop.id], sorts: [], filters: [], groupBy: null },
        position: 0,
      });
    const [r] = await getDb()
      .insert(schema.dbRows)
      .values({ databaseId: db.id, createdBy: u.userId })
      .returning();
    if (r)
      await getDb().insert(schema.dbCells).values({ rowId: r.id, propertyId: prop.id, value: 'x' });

    const noRows = await captureDatabase(getDb(), {
      workspaceId: u.workspaceId,
      databaseId: db.id,
    });
    expect(noRows.databases[0]?.properties).toHaveLength(1);
    expect(noRows.databases[0]?.views).toHaveLength(1);
    expect(noRows.databases[0]?.rows).toHaveLength(0);

    const withRows = await captureDatabase(getDb(), {
      workspaceId: u.workspaceId,
      databaseId: db.id,
      withSampleRows: true,
    });
    expect(withRows.databases[0]?.rows).toHaveLength(1);
    expect(withRows.databases[0]?.rows[0]?.cells[0]?.value).toBe('x');
  });
});
