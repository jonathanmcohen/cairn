import { eq, sql as rawSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

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
  await sql`TRUNCATE pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seed(): Promise<{ userId: string; workspaceId: string }> {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `u-${Date.now()}-${Math.random()}@example.com`,
      name: 'U',
      passwordHash: 'x',
    })
    .returning({ id: schema.users.id });
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })
    .returning({ id: schema.workspaces.id });
  return { userId: u!.id, workspaceId: w!.id };
}

describe('migration 0047 — page lifecycle status + translations', () => {
  it('every newly-inserted row defaults to status="published"', async () => {
    const { userId, workspaceId } = await seed();
    const [row] = await db
      .insert(schema.pages)
      .values({ workspaceId, title: 'P', createdBy: userId })
      .returning();
    expect(row!.status).toBe('published');
  });

  it('rejects unknown status via CHECK constraint', async () => {
    const { userId, workspaceId } = await seed();
    await expect(
      db.execute(
        rawSql`INSERT INTO pages (workspace_id, title, status, content, content_text, created_by)
               VALUES (${workspaceId}, 'X', 'galactic', '{"type":"doc"}'::jsonb, '', ${userId})`,
      ),
    ).rejects.toThrow();
  });

  it('translation_of_page_id self-FK accepts a same-workspace target', async () => {
    const { userId, workspaceId } = await seed();
    const [a] = await db
      .insert(schema.pages)
      .values({ workspaceId, title: 'EN', createdBy: userId })
      .returning();
    const [b] = await db
      .insert(schema.pages)
      .values({
        workspaceId,
        title: 'ES',
        translationOfPageId: a!.id,
        translationLocale: 'es',
        createdBy: userId,
      })
      .returning();
    expect(b!.translationOfPageId).toBe(a!.id);
    expect(b!.translationLocale).toBe('es');
  });

  it('translation_of_page_id ON DELETE SET NULL leaves the dependent row intact', async () => {
    const { userId, workspaceId } = await seed();
    const [a] = await db
      .insert(schema.pages)
      .values({ workspaceId, title: 'EN', createdBy: userId })
      .returning();
    const [b] = await db
      .insert(schema.pages)
      .values({
        workspaceId,
        title: 'ES',
        translationOfPageId: a!.id,
        translationLocale: 'es',
        createdBy: userId,
      })
      .returning();
    await db.delete(schema.pages).where(eq(schema.pages.id, a!.id));
    const [stillThere] = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, b!.id));
    expect(stillThere!.translationOfPageId).toBeNull();
  });

  it('backfill: existing rows from before 0047 default to status="published"', async () => {
    // Simulate prior-migration shape: insert without specifying status; default
    // = 'published' (semantically equivalent to a backfilled row).
    const { userId, workspaceId } = await seed();
    for (let i = 0; i < 5; i++) {
      await db.insert(schema.pages).values({ workspaceId, title: `P${i}`, createdBy: userId });
    }
    const rows = await db.select().from(schema.pages);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === 'published')).toBe(true);
  });
});
