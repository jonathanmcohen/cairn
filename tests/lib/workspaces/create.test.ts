import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createWorkspace } from '@/lib/workspaces/create';
import { eq } from 'drizzle-orm';
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

async function makeUser(email = 'o@x.com') {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: 'O' })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}

describe('createWorkspace', () => {
  it('creates the workspace + an owner membership', async () => {
    const userId = await makeUser();
    const ws = await createWorkspace(db, { name: 'My Team', ownerUserId: userId });
    expect(ws.name).toBe('My Team');

    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, ws.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(userId);
    expect(members[0]?.role).toBe('owner');
  });

  it('slugifies the name with a random suffix', async () => {
    const userId = await makeUser();
    const ws = await createWorkspace(db, { name: 'My Team!', ownerUserId: userId });
    expect(ws.slug).toMatch(/^my-team-[0-9a-f]{6}$/);
  });

  it('two workspaces with the same name get distinct slugs (no collision)', async () => {
    const userId = await makeUser();
    const a = await createWorkspace(db, { name: 'Dup', ownerUserId: userId });
    const b = await createWorkspace(db, { name: 'Dup', ownerUserId: userId });
    expect(a.slug).not.toBe(b.slug);
    expect(a.slug).toMatch(/^dup-[0-9a-f]{6}$/);
    expect(b.slug).toMatch(/^dup-[0-9a-f]{6}$/);
  });
});
