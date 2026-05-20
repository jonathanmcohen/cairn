import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE files, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('files schema + pages.cover_url', () => {
  it('inserts a file row with all required columns', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [f] = await db
      .insert(schema.files)
      .values({
        workspaceId: u.workspaceId,
        name: 'photo.png',
        mimeType: 'image/png',
        size: 12345,
        path: `${u.workspaceId}/abc.png`,
        uploadedBy: u.userId,
      })
      .returning();
    expect(f?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(f?.mimeType).toBe('image/png');
  });

  it('pages.cover_url accepts a URL string', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'P',
        createdBy: u.userId,
        coverUrl: '/api/files/abc?sig=xyz',
      })
      .returning();
    expect(p?.coverUrl).toBe('/api/files/abc?sig=xyz');
  });

  it('deleting a page nulls files.page_id (set null)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('no page');
    await db.insert(schema.files).values({
      workspaceId: u.workspaceId,
      pageId: p.id,
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 1,
      path: `${u.workspaceId}/a.txt`,
      uploadedBy: u.userId,
    });
    await sql`DELETE FROM pages WHERE id = ${p.id}`;
    const [f] = await db.select().from(schema.files);
    expect(f?.pageId).toBeNull();
  });
});
