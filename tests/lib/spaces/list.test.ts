import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listSpacePages, listUnfiledPages, listVisibleSpaces } from '@/lib/spaces/list';
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
  await sql`TRUNCATE space_members, spaces, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seed() {
  const db = getDb();
  const ts = `${Date.now()}-${Math.random()}`;
  const [admin] = await db
    .insert(schema.users)
    .values({ email: `a${ts}@x.test`, passwordHash: 'h', name: 'A' })
    .returning();
  const [editor] = await db
    .insert(schema.users)
    .values({ email: `e${ts}@x.test`, passwordHash: 'h', name: 'E' })
    .returning();
  if (!admin || !editor) throw new Error('user');
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'w', slug: `w-${ts}` })
    .returning();
  if (!ws) throw new Error('ws');
  await db.insert(schema.workspaceMembers).values([
    { workspaceId: ws.id, userId: admin.id, role: 'owner' },
    { workspaceId: ws.id, userId: editor.id, role: 'editor' },
  ]);
  const [pubSpace] = await db
    .insert(schema.spaces)
    .values({ workspaceId: ws.id, name: 'Public', slug: 'public', position: 0 })
    .returning();
  const [privSpace] = await db
    .insert(schema.spaces)
    .values({ workspaceId: ws.id, name: 'Private', slug: 'private', position: 1 })
    .returning();
  if (!pubSpace || !privSpace) throw new Error('space');
  // Mark privSpace as private by adding admin as a member.
  await db.insert(schema.spaceMembers).values({
    spaceId: privSpace.id,
    userId: admin.id,
    role: 'owner',
  });
  return { db, admin, editor, ws, pubSpace, privSpace };
}

describe('listVisibleSpaces', () => {
  it('admin sees every space ordered by position', async () => {
    const { admin, ws, pubSpace, privSpace } = await seed();
    const rows = await listVisibleSpaces(getDb(), ws.id, admin.id);
    expect(rows.map((r) => r.id)).toEqual([pubSpace.id, privSpace.id]);
  });

  it('editor sees public space + only private spaces they belong to', async () => {
    const { editor, ws, pubSpace } = await seed();
    const rows = await listVisibleSpaces(getDb(), ws.id, editor.id);
    expect(rows.map((r) => r.id)).toEqual([pubSpace.id]);
  });

  it('non-member of workspace sees zero spaces', async () => {
    const { ws } = await seed();
    const db = getDb();
    const [other] = await db
      .insert(schema.users)
      .values({ email: 'no-ws@x.test', passwordHash: 'h', name: 'O' })
      .returning();
    if (!other) throw new Error('user');
    const rows = await listVisibleSpaces(getDb(), ws.id, other.id);
    expect(rows).toEqual([]);
  });
});

describe('listSpacePages', () => {
  it('returns pages in space, excluding soft-deleted', async () => {
    const { db, admin, ws, pubSpace } = await seed();
    const [p1] = await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.id,
        spaceId: pubSpace.id,
        title: 'P1',
        createdBy: admin.id,
        content: {},
      })
      .returning();
    await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.id,
        spaceId: pubSpace.id,
        title: 'P2 deleted',
        createdBy: admin.id,
        content: {},
        deletedAt: new Date(),
      })
      .returning();
    if (!p1) throw new Error('page');
    const rows = await listSpacePages(db, pubSpace.id);
    expect(rows.map((r) => r.id)).toEqual([p1.id]);
  });
});

describe('listUnfiledPages', () => {
  it('returns workspace pages with NULL space_id', async () => {
    const { db, admin, ws, pubSpace } = await seed();
    const [unfiled] = await db
      .insert(schema.pages)
      .values({ workspaceId: ws.id, title: 'U', createdBy: admin.id, content: {} })
      .returning();
    await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.id,
        spaceId: pubSpace.id,
        title: 'In Space',
        createdBy: admin.id,
        content: {},
      })
      .returning();
    if (!unfiled) throw new Error('page');
    const rows = await listUnfiledPages(db, ws.id);
    expect(rows.map((r) => r.id)).toEqual([unfiled.id]);
  });
});
