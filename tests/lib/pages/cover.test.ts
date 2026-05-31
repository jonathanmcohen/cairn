import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { getPageCover, PageCoverSchema, setPageCover } from '@/lib/pages/cover';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

async function makePage(workspaceId: string, userId: string): Promise<schema.Page> {
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!p) throw new Error('insert failed');
  return p;
}

describe('page cover roundtrip', () => {
  it('returns {} (no cover) for a freshly created page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId);
    const cover = await getPageCover(db, page.id, u.workspaceId);
    expect(cover).toEqual({});
  });

  it('roundtrips a color cover', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId);
    await setPageCover(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      cover: { kind: 'color', value: '#abcdef' },
    });
    expect(await getPageCover(db, page.id, u.workspaceId)).toEqual({
      kind: 'color',
      value: '#abcdef',
    });
  });

  it('roundtrips an unsplash cover', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId);
    await setPageCover(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      cover: { kind: 'unsplash', value: 'https://images.unsplash.com/photo-123' },
    });
    expect(await getPageCover(db, page.id, u.workspaceId)).toEqual({
      kind: 'unsplash',
      value: 'https://images.unsplash.com/photo-123',
    });
  });

  it('roundtrips an upload cover', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId);
    const fakeFileId = '11111111-1111-1111-1111-111111111111';
    await setPageCover(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      cover: { kind: 'upload', value: fakeFileId },
    });
    expect(await getPageCover(db, page.id, u.workspaceId)).toEqual({
      kind: 'upload',
      value: fakeFileId,
    });
  });

  it('clears the cover when given {}', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId);
    await setPageCover(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      cover: { kind: 'color', value: '#abcdef' },
    });
    await setPageCover(db, { pageId: page.id, workspaceId: u.workspaceId, cover: {} });
    expect(await getPageCover(db, page.id, u.workspaceId)).toEqual({});
  });

  it('returns false when called with a workspaceId the page does not belong to', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const page = await makePage(a.workspaceId, a.userId);
    const ok = await setPageCover(db, {
      pageId: page.id,
      workspaceId: b.workspaceId,
      cover: { kind: 'color', value: '#abcdef' },
    });
    expect(ok).toBe(false);
    expect(await getPageCover(db, page.id, a.workspaceId)).toEqual({});
  });

  it('rejects an invalid cover shape', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId);
    await expect(
      setPageCover(db, {
        pageId: page.id,
        workspaceId: u.workspaceId,
        // @ts-expect-error — invalid kind
        cover: { kind: 'gradient', value: 'whatever' },
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe('preset covers (finding U)', () => {
  it('round-trips a known preset key through set/getPageCover', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId);
    const ok = await setPageCover(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      cover: { kind: 'preset', value: 'slate-dusk' },
    });
    expect(ok).toBe(true);
    const cover = await getPageCover(db, page.id, u.workspaceId);
    expect(cover).toEqual({ kind: 'preset', value: 'slate-dusk' });
  });

  it('rejects an unknown preset key at the schema boundary', () => {
    const parsed = PageCoverSchema.safeParse({ kind: 'preset', value: 'not-real' });
    expect(parsed.success).toBe(false);
  });

  it('accepts a known preset key at the schema boundary', () => {
    const parsed = PageCoverSchema.safeParse({ kind: 'preset', value: 'graphite' });
    expect(parsed.success).toBe(true);
  });
});
