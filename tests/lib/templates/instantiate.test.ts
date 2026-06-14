import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { captureDatabase, capturePage } from '@/lib/templates/capture';
import { instantiateTemplate } from '@/lib/templates/instantiate';
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
    sql`TRUNCATE templates, pages, databases, db_properties, db_views, db_rows, db_cells, workspaces, users, workspace_members RESTART IDENTITY CASCADE`,
  );
});

describe('instantiateTemplate', () => {
  it('round-trips a captured page subtree into a different workspace with fresh ids', async () => {
    const src = await createTestWorkspaceWithUser(getDb());
    const dst = await createTestWorkspaceWithUser(getDb());

    // build a small page tree in the source workspace
    const [root] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: src.workspaceId,
        parentId: null,
        title: 'Playbook',
        content: { type: 'doc', content: [] },
        createdBy: src.userId,
      })
      .returning();
    if (!root) throw new Error('root insert failed');
    await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: src.workspaceId,
        parentId: root.id,
        title: 'Step 1',
        content: { type: 'doc', content: [] },
        createdBy: src.userId,
      });

    const payload = await capturePage(getDb(), {
      workspaceId: src.workspaceId,
      rootPageId: root.id,
    });
    const [tpl] = await getDb()
      .insert(schema.templates)
      .values({
        workspaceId: src.workspaceId,
        name: 'Playbook',
        kind: 'page',
        payload,
        builtIn: false,
      })
      .returning();
    if (!tpl) throw new Error('template insert failed');

    const result = await instantiateTemplate(getDb(), {
      templateId: tpl.id,
      targetWorkspaceId: dst.workspaceId,
      createdBy: dst.userId,
    });

    // new pages live in dst, none in src beyond the originals
    const dstPages = await getDb()
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, dst.workspaceId));
    expect(dstPages.map((p) => p.title).sort()).toEqual(['Playbook', 'Step 1']);
    const newRoot = dstPages.find((p) => p.title === 'Playbook');
    const newChild = dstPages.find((p) => p.title === 'Step 1');
    if (!newRoot || !newChild) throw new Error('expected pages missing');
    expect(newRoot.id).not.toBe(root.id); // fresh id
    expect(newChild.parentId).toBe(newRoot.id); // parent link rewritten to the new root
    expect(result.rootPageId).toBe(newRoot.id);

    // scoped to dst only — source workspace untouched count
    const srcPages = await getDb()
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, src.workspaceId));
    expect(srcPages).toHaveLength(2);
  });

  it('grafts the root under a supplied parentId', async () => {
    const src = await createTestWorkspaceWithUser(getDb());
    const dst = await createTestWorkspaceWithUser(getDb());
    const [parent] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: dst.workspaceId,
        parentId: null,
        title: 'Home',
        content: { type: 'doc', content: [] },
        createdBy: dst.userId,
      })
      .returning();
    if (!parent) throw new Error('parent insert failed');

    const [root] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: src.workspaceId,
        parentId: null,
        title: 'Grafted',
        content: { type: 'doc', content: [] },
        createdBy: src.userId,
      })
      .returning();
    if (!root) throw new Error('root insert failed');
    const payload = await capturePage(getDb(), {
      workspaceId: src.workspaceId,
      rootPageId: root.id,
    });
    const [tpl] = await getDb()
      .insert(schema.templates)
      .values({
        workspaceId: src.workspaceId,
        name: 'Grafted',
        kind: 'page',
        payload,
        builtIn: false,
      })
      .returning();
    if (!tpl) throw new Error('template insert failed');

    const result = await instantiateTemplate(getDb(), {
      templateId: tpl.id,
      targetWorkspaceId: dst.workspaceId,
      createdBy: dst.userId,
      parentId: parent.id,
    });

    const [newRoot] = await getDb()
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, result.rootPageId as string));
    if (!newRoot) throw new Error('new root missing');
    expect(newRoot.parentId).toBe(parent.id);
  });

  it('instantiates a captured database with fresh ids and rewritten view config', async () => {
    const src = await createTestWorkspaceWithUser(getDb());
    const dst = await createTestWorkspaceWithUser(getDb());

    const [hostPage] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: src.workspaceId,
        parentId: null,
        title: 'Host',
        content: { type: 'doc', content: [] },
        createdBy: src.userId,
      })
      .returning();
    if (!hostPage) throw new Error('host insert failed');
    const [db] = await getDb()
      .insert(schema.databases)
      .values({
        workspaceId: src.workspaceId,
        pageId: hostPage.id,
        name: 'Tracker',
        createdBy: src.userId,
      })
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

    const payload = await captureDatabase(getDb(), {
      workspaceId: src.workspaceId,
      databaseId: db.id,
    });
    const [tpl] = await getDb()
      .insert(schema.templates)
      .values({
        workspaceId: src.workspaceId,
        name: 'Tracker',
        kind: 'database',
        payload,
        builtIn: false,
      })
      .returning();
    if (!tpl) throw new Error('template insert failed');

    const result = await instantiateTemplate(getDb(), {
      templateId: tpl.id,
      targetWorkspaceId: dst.workspaceId,
      createdBy: dst.userId,
    });

    // a fresh database lands in dst with a fresh id
    const dstDbs = await getDb()
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.workspaceId, dst.workspaceId));
    expect(dstDbs).toHaveLength(1);
    const newDb = dstDbs[0];
    if (!newDb) throw new Error('new db missing');
    expect(newDb.id).not.toBe(db.id);
    expect(result.rootDatabaseId).toBe(newDb.id);

    // its host page is freshly minted in dst
    const [host] = await getDb()
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, newDb.pageId));
    if (!host) throw new Error('host page missing');
    expect(host.workspaceId).toBe(dst.workspaceId);
    // B1: the minted host page id must surface as rootPageId — it's what the
    // gallery navigates to. rootDatabaseId alone cannot move the browser.
    expect(result.rootPageId).toBe(host.id);

    // property carried over with a fresh id
    const props = await getDb()
      .select()
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.databaseId, newDb.id));
    expect(props).toHaveLength(1);
    const newProp = props[0];
    if (!newProp) throw new Error('new prop missing');
    expect(newProp.id).not.toBe(prop.id);
    expect(newProp.name).toBe('Status');

    // view config's visibleProperties point at the NEW property id
    const views = await getDb()
      .select()
      .from(schema.dbViews)
      .where(eq(schema.dbViews.databaseId, newDb.id));
    expect(views).toHaveLength(1);
    const view = views[0];
    if (!view) throw new Error('new view missing');
    const cfg = view.config as { visibleProperties: string[] };
    expect(cfg.visibleProperties).toEqual([newProp.id]);

    // no old id survives anywhere in the dst entities
    const serialized = JSON.stringify({ dstDbs, props, views });
    expect(serialized).not.toContain(db.id);
    expect(serialized).not.toContain(prop.id);
  });
});
