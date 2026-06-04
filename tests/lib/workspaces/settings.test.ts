import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  loadWorkspaceGeneralSettings,
  SettingsError,
  updateWorkspaceSettings,
} from '@/lib/workspaces/settings';
import { startPostgres, stopPostgres } from '../../helpers/db';

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  pg = postgres(uri);
  db = drizzle(pg, { schema });
});
afterAll(async () => {
  await pg.end();
  await stopPostgres();
});
beforeEach(async () => {
  await pg`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function user(name = 'u') {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}
async function ws(name = 'WS') {
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name, slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('workspace insert failed');
  return w.id;
}
async function page(workspaceId: string, createdBy: string) {
  const [p] = await db
    .insert(schema.pages)
    .values({
      workspaceId,
      title: 'P',
      content: { type: 'doc', content: [] },
      createdBy,
    })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p.id;
}

describe('updateWorkspaceSettings', () => {
  it('updates name and require_2fa', async () => {
    const w = await ws();
    await updateWorkspaceSettings(db, {
      workspaceId: w,
      name: 'Renamed',
      requireTwofa: true,
    });
    const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, w));
    expect(row?.name).toBe('Renamed');
    expect(row?.requireTwofa).toBe(true);
  });

  it('sets home_page_id to a page in the same workspace', async () => {
    const u = await user('owner');
    const w = await ws();
    const p = await page(w, u);
    await updateWorkspaceSettings(db, { workspaceId: w, homePageId: p });
    const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, w));
    expect(row?.homePageId).toBe(p);
  });

  it('clears home_page_id when passed null', async () => {
    const u = await user('owner');
    const w = await ws();
    const p = await page(w, u);
    await updateWorkspaceSettings(db, { workspaceId: w, homePageId: p });
    await updateWorkspaceSettings(db, { workspaceId: w, homePageId: null });
    const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, w));
    expect(row?.homePageId).toBeNull();
  });

  it('rejects a home_page_id from another workspace', async () => {
    const u = await user('owner');
    const w = await ws('A');
    const other = await ws('B');
    const foreign = await page(other, u);
    await expect(
      updateWorkspaceSettings(db, { workspaceId: w, homePageId: foreign }),
    ).rejects.toMatchObject({ code: 'HOME_PAGE_NOT_IN_WORKSPACE' });
  });

  it('rejects an empty name', async () => {
    const w = await ws();
    await expect(
      updateWorkspaceSettings(db, { workspaceId: w, name: '   ' }),
    ).rejects.toBeInstanceOf(SettingsError);
  });
});

describe('loadWorkspaceGeneralSettings (#1 — narrowed projection)', () => {
  it('returns exactly the columns the general page reads', async () => {
    const u = await user('owner');
    const w = await ws('Proj');
    const p = await page(w, u);
    await updateWorkspaceSettings(db, {
      workspaceId: w,
      name: 'Proj',
      requireTwofa: true,
      homePageId: p,
      icon: 'emoji::🪨',
    });

    const row = await loadWorkspaceGeneralSettings(db, w);
    expect(row).not.toBeNull();
    // Exactly the four fields the page consumes — no more (a lagging unrelated
    // column must not be in the projection so it can't 42703 the whole page).
    expect(Object.keys(row ?? {}).sort()).toEqual(['homePageId', 'icon', 'name', 'requireTwofa']);
    expect(row?.name).toBe('Proj');
    expect(row?.requireTwofa).toBe(true);
    expect(row?.homePageId).toBe(p);
    expect(row?.icon).toBe('emoji::🪨');
  });

  it('returns null for a missing workspace', async () => {
    const row = await loadWorkspaceGeneralSettings(db, '00000000-0000-0000-0000-000000000000');
    expect(row).toBeNull();
  });

  it('survives a lagging unrelated column (narrowed SELECT does not touch it)', async () => {
    // Simulate a deploy where an UNRELATED newer column has not yet migrated:
    // drop it, then the narrowed read must still succeed (the bare `.select()`
    // would 42703 here). `enable_federated_search` is unrelated to this page.
    const w = await ws('Lag');
    await pg`ALTER TABLE workspaces DROP COLUMN enable_federated_search`;
    try {
      const row = await loadWorkspaceGeneralSettings(db, w);
      expect(row?.name).toBe('Lag');
    } finally {
      await pg`ALTER TABLE workspaces ADD COLUMN enable_federated_search boolean NOT NULL DEFAULT false`;
    }
  });
});
