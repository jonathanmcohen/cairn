import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listWorkspacePins } from '@/lib/pins/list';
import { startPostgres, stopPostgres } from '../../helpers/db';

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
  await sql`TRUNCATE workspace_pins, audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seed() {
  const db = getDb();
  const ts = `${Date.now()}-${Math.random()}`;
  const [user] = await db
    .insert(schema.users)
    .values({ email: `u${ts}@x.test`, passwordHash: 'h', name: 'u' })
    .returning();
  if (!user) throw new Error('user');
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'w', slug: `w-${ts}` })
    .returning();
  if (!ws) throw new Error('ws');
  await db.insert(schema.workspaceMembers).values({
    workspaceId: ws.id,
    userId: user.id,
    role: 'owner',
  });
  const [p1] = await db
    .insert(schema.pages)
    .values({ workspaceId: ws.id, title: 'A', createdBy: user.id, content: {} })
    .returning();
  const [p2] = await db
    .insert(schema.pages)
    .values({ workspaceId: ws.id, title: 'B', createdBy: user.id, content: {} })
    .returning();
  const [p3deleted] = await db
    .insert(schema.pages)
    .values({
      workspaceId: ws.id,
      title: 'C',
      createdBy: user.id,
      content: {},
      deletedAt: new Date(),
    })
    .returning();
  if (!p1 || !p2 || !p3deleted) throw new Error('page');
  await db.insert(schema.workspacePins).values([
    { workspaceId: ws.id, pageId: p1.id, position: 1, pinnedBy: user.id },
    { workspaceId: ws.id, pageId: p2.id, position: 0, pinnedBy: user.id },
    { workspaceId: ws.id, pageId: p3deleted.id, position: 2, pinnedBy: user.id },
  ]);
  return { db, ws, p1, p2, p3deleted, user };
}

describe('listWorkspacePins', () => {
  it('returns pins ordered by position, excluding soft-deleted pages', async () => {
    const { ws, p1, p2 } = await seed();
    const rows = await listWorkspacePins(getDb(), ws.id);
    expect(rows.map((r) => r.pageId)).toEqual([p2.id, p1.id]);
    expect(rows[0]?.title).toBe('B');
  });

  it('returns empty array for a workspace with no pins', async () => {
    const db = getDb();
    const ts = `${Date.now()}-${Math.random()}`;
    const [u] = await db
      .insert(schema.users)
      .values({ email: `a${ts}@x.test`, passwordHash: 'h', name: 'a' })
      .returning();
    if (!u) throw new Error('user');
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'empty', slug: `empty-${ts}` })
      .returning();
    if (!ws) throw new Error('ws');
    expect(await listWorkspacePins(db, ws.id)).toEqual([]);
  });
});
