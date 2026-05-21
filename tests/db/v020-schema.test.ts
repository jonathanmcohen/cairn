import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('v0.2.0 schema columns', () => {
  it('users has nullable email_verified + image', async () => {
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'a@b.c', passwordHash: 'h', name: 'A' })
      .returning();
    expect(u?.emailVerified).toBeNull();
    expect(u?.image).toBeNull();

    const verified = new Date();
    const [u2] = await db
      .insert(schema.users)
      .values({
        email: 'oauth@b.c',
        passwordHash: 'h',
        name: 'O',
        emailVerified: verified,
        image: 'https://x/y.png',
      })
      .returning();
    expect(u2?.emailVerified?.getTime()).toBe(verified.getTime());
    expect(u2?.image).toBe('https://x/y.png');
  });

  it('pages has published default false + unique public_slug', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    expect(p.published).toBe(false);
    expect(p.publicSlug).toBeNull();

    await db
      .update(schema.pages)
      .set({ published: true, publicSlug: 'p-abc123' })
      .where(eq(schema.pages.id, p.id));
    const [p2] = await db.select().from(schema.pages).where(eq(schema.pages.id, p.id));
    expect(p2?.published).toBe(true);
    expect(p2?.publicSlug).toBe('p-abc123');
  });

  it('public_slug is unique', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [a] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'A', createdBy: u.userId, publicSlug: 'dup' })
      .returning();
    expect(a?.publicSlug).toBe('dup');
    await expect(
      db
        .insert(schema.pages)
        .values({ workspaceId: u.workspaceId, title: 'B', createdBy: u.userId, publicSlug: 'dup' }),
    ).rejects.toThrow();
  });
});
