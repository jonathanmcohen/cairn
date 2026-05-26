import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { requirePublicPageAccess } from '@/lib/pages/share';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('public share — encrypted refusal', () => {
  it('requirePublicPageAccess returns { ok: false } for an encrypted published page', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [page] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 't',
        createdBy: u.userId,
        published: true,
        publicSlug: 'secret-slug-123',
        encrypted: true,
      })
      .returning();
    if (!page) throw new Error('page insert failed');

    const access = await requirePublicPageAccess(getDb(), 'secret-slug-123', false);
    expect(access.ok).toBe(false);
  });

  it('non-encrypted published page is still accessible', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [page] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'public',
        createdBy: u.userId,
        published: true,
        publicSlug: 'public-slug-456',
        encrypted: false,
      })
      .returning();
    if (!page) throw new Error('page insert failed');

    const access = await requirePublicPageAccess(getDb(), 'public-slug-456', false);
    expect(access.ok).toBe(true);
  });

  it('does not regress when an existing public page is flipped to encrypted', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [page] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'flip',
        createdBy: u.userId,
        published: true,
        publicSlug: 'flip-slug-789',
      })
      .returning();
    if (!page) throw new Error('page insert failed');
    let access = await requirePublicPageAccess(getDb(), 'flip-slug-789', false);
    expect(access.ok).toBe(true);

    await getDb()
      .update(schema.pages)
      .set({ encrypted: true })
      .where(eq(schema.pages.id, page.id));

    access = await requirePublicPageAccess(getDb(), 'flip-slug-789', false);
    expect(access.ok).toBe(false);
  });
});
