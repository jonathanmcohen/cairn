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

async function makePage() {
  const u = await createTestWorkspaceWithUser(db);
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

describe('page_yjs schema', () => {
  it('stores and reads back a bytea state blob', async () => {
    const p = await makePage();
    const blob = Buffer.from([0, 1, 2, 255, 254, 0, 42]);
    await db.insert(schema.pageYjs).values({ pageId: p.id, state: blob });

    const [row] = await db.select().from(schema.pageYjs).where(eq(schema.pageYjs.pageId, p.id));
    expect(row?.state).toBeInstanceOf(Buffer);
    expect(Buffer.compare(row?.state as Buffer, blob)).toBe(0);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('cascades on page delete', async () => {
    const p = await makePage();
    await db.insert(schema.pageYjs).values({ pageId: p.id, state: Buffer.from('x') });
    await db.delete(schema.pages).where(eq(schema.pages.id, p.id));
    const rows = await db.select().from(schema.pageYjs).where(eq(schema.pageYjs.pageId, p.id));
    expect(rows).toHaveLength(0);
  });

  it('rejects a second row for the same page (pk)', async () => {
    const p = await makePage();
    await db.insert(schema.pageYjs).values({ pageId: p.id, state: Buffer.from('a') });
    await expect(
      db.insert(schema.pageYjs).values({ pageId: p.id, state: Buffer.from('b') }),
    ).rejects.toThrow();
  });
});
