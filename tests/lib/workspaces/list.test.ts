import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listUserWorkspaces } from '@/lib/workspaces/list';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeUser() {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `u-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name: 'U',
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}

describe('listUserWorkspaces', () => {
  it('returns the user workspaces with role + name, oldest first', async () => {
    const userId = await makeUser();
    const [a] = await db
      .insert(schema.workspaces)
      .values({ name: 'Alpha', slug: `a-${Math.random().toString(36).slice(2)}` })
      .returning();
    const [b] = await db
      .insert(schema.workspaces)
      .values({ name: 'Beta', slug: `b-${Math.random().toString(36).slice(2)}` })
      .returning();
    if (!a || !b) throw new Error('ws insert failed');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: a.id, userId, role: 'owner', joinedAt: new Date(Date.now()) });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: b.id, userId, role: 'viewer', joinedAt: new Date(Date.now() + 1000) });

    const list = await listUserWorkspaces(db, userId);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: a.id, name: 'Alpha', role: 'owner' });
    expect(list[1]).toMatchObject({ id: b.id, name: 'Beta', role: 'viewer' });
  });

  it('returns an empty array for a member-less user', async () => {
    const userId = await makeUser();
    expect(await listUserWorkspaces(db, userId)).toEqual([]);
  });
});
