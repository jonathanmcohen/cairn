import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { publishPage } from '@/lib/pages/publish';
import { requirePublicPageAccess, setShareSettings, verifyShareAccess } from '@/lib/pages/share';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function publishedPage(title = 'Roadmap') {
  const u = await createTestWorkspaceWithUser(db);
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title, createdBy: u.userId })
    .returning();
  if (!p) throw new Error('insert failed');
  const { slug } = await publishPage(db, { pageId: p.id, workspaceId: u.workspaceId });
  return { ...u, page: p, slug };
}

describe('setShareSettings', () => {
  it('hashes the password (Argon2id), stores expiry + allowDuplication', async () => {
    const f = await publishedPage();
    await setShareSettings(db, {
      pageId: f.page.id,
      workspaceId: f.workspaceId,
      password: 'hunter2',
      expiresAt: new Date('2099-01-01'),
      allowDuplication: true,
    });
    const [row] = await db.select().from(schema.pages).where(eq(schema.pages.id, f.page.id));
    expect(row?.linkPasswordHash).toMatch(/^\$argon2id\$/);
    expect(row?.linkPasswordHash).not.toContain('hunter2');
    expect(row?.allowDuplication).toBe(true);
    expect(row?.expiresAt).toBeInstanceOf(Date);
  });

  it('clears the password when password is null', async () => {
    const f = await publishedPage();
    await setShareSettings(db, { pageId: f.page.id, workspaceId: f.workspaceId, password: 'x' });
    await setShareSettings(db, { pageId: f.page.id, workspaceId: f.workspaceId, password: null });
    const [row] = await db.select().from(schema.pages).where(eq(schema.pages.id, f.page.id));
    expect(row?.linkPasswordHash).toBeNull();
  });

  it('rejects a page in another workspace', async () => {
    const f = await publishedPage();
    const other = await createTestWorkspaceWithUser(db);
    await expect(
      setShareSettings(db, { pageId: f.page.id, workspaceId: other.workspaceId, password: 'x' }),
    ).rejects.toThrow();
  });
});

describe('verifyShareAccess', () => {
  it('true for the correct password, false otherwise', async () => {
    const f = await publishedPage();
    await setShareSettings(db, {
      pageId: f.page.id,
      workspaceId: f.workspaceId,
      password: 'hunter2',
    });
    const [row] = await db.select().from(schema.pages).where(eq(schema.pages.id, f.page.id));
    expect(await verifyShareAccess(row!, 'hunter2')).toBe(true);
    expect(await verifyShareAccess(row!, 'wrong')).toBe(false);
  });
});

describe('requirePublicPageAccess', () => {
  it('ok:true for a published page with no password', async () => {
    const f = await publishedPage();
    const r = await requirePublicPageAccess(db, f.slug, false);
    expect(r.ok).toBe(true);
  });

  it('ok:gate for a password-protected page without a valid cookie', async () => {
    const f = await publishedPage();
    await setShareSettings(db, { pageId: f.page.id, workspaceId: f.workspaceId, password: 'pw' });
    const r = await requirePublicPageAccess(db, f.slug, false);
    expect(r.ok).toBe('gate');
  });

  it('ok:true for a password-protected page WITH a valid cookie', async () => {
    const f = await publishedPage();
    await setShareSettings(db, { pageId: f.page.id, workspaceId: f.workspaceId, password: 'pw' });
    const r = await requirePublicPageAccess(db, f.slug, true);
    expect(r.ok).toBe(true);
  });

  it('ok:false (→404) for an EXPIRED page — never 403', async () => {
    const f = await publishedPage();
    await setShareSettings(db, {
      pageId: f.page.id,
      workspaceId: f.workspaceId,
      expiresAt: new Date(Date.now() - 1000),
    });
    const r = await requirePublicPageAccess(db, f.slug, true);
    expect(r.ok).toBe(false);
  });

  it('ok:false for an unpublished page', async () => {
    const f = await publishedPage();
    await db.update(schema.pages).set({ published: false }).where(eq(schema.pages.id, f.page.id));
    expect((await requirePublicPageAccess(db, f.slug, false)).ok).toBe(false);
  });

  it('ok:false for an unknown slug', async () => {
    expect((await requirePublicPageAccess(db, 'nope-abc123', false)).ok).toBe(false);
  });
});
