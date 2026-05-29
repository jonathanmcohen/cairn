import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { removeMember, setMemberRole } from '@/lib/workspaces/admin-members';
import { startPostgres, stopPostgres } from '../../helpers/db';

// Pins the no-last-owner / no-owner-removal invariants against a real DB so a
// future refactor of admin-members.ts cannot silently drop them (#62 server
// guard). The guards already exist; this is a regression test, not new logic.

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  pg = postgres(uri);
  db = drizzle(pg, { schema });
});
afterAll(async () => {
  await pg.end();
  await stopPostgres();
});
beforeEach(async () => {
  await pg`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function user(name: string) {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user seed failed');
  return u.id;
}
async function ws() {
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('ws seed failed');
  return w.id;
}
async function add(workspaceId: string, userId: string, role: schema.MemberRole) {
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

describe('admin-members owner invariants', () => {
  it('refuses to remove an owner (CANNOT_REMOVE_OWNER)', async () => {
    const w = await ws();
    const u1 = await user('owner');
    const u2 = await user('admin');
    await add(w, u1, 'owner');
    await add(w, u2, 'admin');
    await expect(
      removeMember(db, { workspaceId: w, actorUserId: u2, targetUserId: u1 }),
    ).rejects.toMatchObject({ code: 'CANNOT_REMOVE_OWNER' });
  });

  it('refuses to demote the last owner (LAST_OWNER)', async () => {
    const w = await ws();
    const u1 = await user('owner');
    await add(w, u1, 'owner');
    await expect(
      setMemberRole(db, { workspaceId: w, actorUserId: u1, targetUserId: u1, role: 'admin' }),
    ).rejects.toMatchObject({ code: 'LAST_OWNER' });
  });

  it('refuses self-removal (CANNOT_REMOVE_SELF)', async () => {
    const w = await ws();
    const u1 = await user('owner');
    await add(w, u1, 'owner');
    await expect(
      removeMember(db, { workspaceId: w, actorUserId: u1, targetUserId: u1 }),
    ).rejects.toMatchObject({ code: 'CANNOT_REMOVE_SELF' });
  });
});
