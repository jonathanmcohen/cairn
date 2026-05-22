import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { publishPage, unpublishPage } from '@/lib/pages/publish';
import { requirePublicPageAccess, setShareSettings } from '@/lib/pages/share';
import { issueAccessCookieValue, verifyAccessCookieValue } from '@/lib/pages/share-cookie';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

const SECRET = 'a'.repeat(32);
const WRONG_SECRET = 'b'.repeat(32);

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

async function protectedPage() {
  const u = await createTestWorkspaceWithUser(db);
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'Secret', createdBy: u.userId })
    .returning();
  const { slug } = await publishPage(db, { pageId: p!.id, workspaceId: u.workspaceId });
  await setShareSettings(db, {
    pageId: p!.id,
    workspaceId: u.workspaceId,
    password: 'correct horse',
  });
  return { pageId: p!.id, slug };
}

describe('security: forged / expired access cookies', () => {
  it('a cookie signed with the wrong secret is rejected', () => {
    const pageId = '33333333-3333-3333-3333-333333333333';
    const forged = issueAccessCookieValue({ pageId, ttlSeconds: 3600, secret: WRONG_SECRET });
    expect(verifyAccessCookieValue({ pageId, value: forged, secret: SECRET })).toBe(false);
  });

  it('a cookie with a tampered exp (extended lifetime) is rejected — exp is signed', () => {
    const pageId = '44444444-4444-4444-4444-444444444444';
    const value = issueAccessCookieValue({ pageId, ttlSeconds: 1, secret: SECRET });
    const sig = value.split('.')[1];
    const farFuture = Math.floor(Date.now() / 1000) + 999999;
    const tampered = `${farFuture}.${sig}`;
    expect(verifyAccessCookieValue({ pageId, value: tampered, secret: SECRET })).toBe(false);
  });

  it('an expired (but validly signed) cookie is rejected', () => {
    const pageId = '55555555-5555-5555-5555-555555555555';
    const past = Math.floor(Date.now() / 1000) - 5;
    const value = issueAccessCookieValue({ pageId, expiresAt: past, secret: SECRET });
    expect(verifyAccessCookieValue({ pageId, value, secret: SECRET })).toBe(false);
  });
});

describe('security: wrong password never grants access', () => {
  it('a protected page without a cookie returns the gate, not content', async () => {
    const { slug } = await protectedPage();
    const r = await requirePublicPageAccess(db, slug, false);
    expect(r.ok).toBe('gate');
    if (r.ok === 'gate') expect(r.page).toBeDefined();
  });
});

describe('security: gated-existence non-leak', () => {
  it('an expired protected page resolves to 404-class (ok:false), NOT 403', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'X', createdBy: u.userId })
      .returning();
    const { slug } = await publishPage(db, { pageId: p!.id, workspaceId: u.workspaceId });
    await setShareSettings(db, {
      pageId: p!.id,
      workspaceId: u.workspaceId,
      password: 'pw',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await requirePublicPageAccess(db, slug, true)).ok).toBe(false);
  });

  it('an unknown slug and an unpublished page are both ok:false (indistinguishable)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'Y', createdBy: u.userId })
      .returning();
    const { slug } = await publishPage(db, { pageId: p!.id, workspaceId: u.workspaceId });
    await unpublishPage(db, { pageId: p!.id, workspaceId: u.workspaceId });
    expect((await requirePublicPageAccess(db, slug, false)).ok).toBe(false);
    expect((await requirePublicPageAccess(db, 'totally-unknown-zzz', false)).ok).toBe(false);
  });
});
