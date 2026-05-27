import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { archiveRow, createRow, updateCells } from '@/lib/databases/rows';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { updatePage } from '@/lib/pages/update';
import * as dispatch from '@/lib/webhooks/dispatch';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => stopPostgres());
afterEach(() => vi.restoreAllMocks());

describe('emit wiring (pages)', () => {
  it('createPage / updatePage / softDeletePage each emit the right event', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    const emit = vi.spyOn(dispatch, 'emit').mockResolvedValue(undefined);

    const page = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    // v0.9.0 G1 P6 — page.created / page.updated now carry the
    // redaction-aware payload { page: { id, title, encrypted }, body }.
    expect(emit).toHaveBeenCalledWith(
      'page.created',
      u.workspaceId,
      expect.objectContaining({ page: expect.objectContaining({ id: page.id }) }),
    );

    await updatePage(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      byUserId: u.userId,
      adminOverride: true,
      patch: { title: 'X' },
    });
    expect(emit).toHaveBeenCalledWith(
      'page.updated',
      u.workspaceId,
      expect.objectContaining({ page: expect.objectContaining({ id: page.id }) }),
    );

    await softDeletePage(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      adminOverride: true,
    });
    // page.deleted intentionally keeps the legacy `{id}` shape — there's no
    // content/body to redact at delete time.
    expect(emit).toHaveBeenCalledWith(
      'page.deleted',
      u.workspaceId,
      expect.objectContaining({ id: page.id }),
    );
  });
});

describe('emit wiring (rows)', () => {
  async function setup() {
    const u = await createTestWorkspaceWithUser(getDb());
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const d = await createDatabase(getDb(), {
      workspaceId: u.workspaceId,
      pageId: p.id,
      createdBy: u.userId,
    });
    const [titleProp] = await getDb()
      .select()
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.databaseId, d.id));
    if (!titleProp) throw new Error('no seeded property');
    return { u, d, titleProp };
  }

  it('createRow / updateCells / archiveRow each emit the right event', async () => {
    const { u, d, titleProp } = await setup();
    const emit = vi.spyOn(dispatch, 'emit').mockResolvedValue(undefined);

    const row = await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    expect(emit).toHaveBeenCalledWith(
      'row.created',
      u.workspaceId,
      expect.objectContaining({ id: row.id, databaseId: d.id }),
    );

    await updateCells(getDb(), {
      rowId: row.id,
      databaseId: d.id,
      workspaceId: u.workspaceId,
      cells: { [titleProp.id]: 'Hello' },
    });
    expect(emit).toHaveBeenCalledWith(
      'row.updated',
      u.workspaceId,
      expect.objectContaining({ id: row.id, databaseId: d.id }),
    );

    await archiveRow(getDb(), { rowId: row.id, databaseId: d.id, workspaceId: u.workspaceId });
    expect(emit).toHaveBeenCalledWith(
      'row.deleted',
      u.workspaceId,
      expect.objectContaining({ id: row.id, databaseId: d.id }),
    );
  });
});
