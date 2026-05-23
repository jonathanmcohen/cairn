import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  AdminMemberError,
  listWorkspaceMembers,
  removeMember,
  setMemberRole,
} from '@/lib/workspaces/admin-members';
import { startPostgres, stopPostgres } from '../../helpers/db';

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

describe('admin member helpers', () => {
  it('listWorkspaceMembers returns each member with name/email/role', async () => {
    const w = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w, owner, 'owner');
    await add(w, ed, 'editor');
    const members = await listWorkspaceMembers(db, w);
    expect(members).toHaveLength(2);
    const byRole = Object.fromEntries(members.map((m) => [m.role, m]));
    expect(byRole.owner?.userId).toBe(owner);
    expect(byRole.editor?.email).toContain('editor-');
  });

  it('setMemberRole changes a member role (admin actor)', async () => {
    const w = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w, owner, 'owner');
    await add(w, ed, 'editor');
    await setMemberRole(db, {
      workspaceId: w,
      actorUserId: owner,
      targetUserId: ed,
      role: 'admin',
    });
    const [m] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(eq(schema.workspaceMembers.workspaceId, w), eq(schema.workspaceMembers.userId, ed)),
      );
    expect(m?.role).toBe('admin');
  });

  it('setMemberRole refuses to promote to owner (use transfer)', async () => {
    const w = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w, owner, 'owner');
    await add(w, ed, 'editor');
    await expect(
      setMemberRole(db, {
        workspaceId: w,
        actorUserId: owner,
        targetUserId: ed,
        role: 'owner' as schema.MemberRole,
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_SET_OWNER' });
  });

  it('setMemberRole refuses to demote the last owner', async () => {
    const w = await ws();
    const owner = await user('owner');
    await add(w, owner, 'owner');
    await expect(
      setMemberRole(db, {
        workspaceId: w,
        actorUserId: owner,
        targetUserId: owner,
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'LAST_OWNER' });
  });

  it('removeMember removes a non-owner', async () => {
    const w = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w, owner, 'owner');
    await add(w, ed, 'editor');
    await removeMember(db, { workspaceId: w, actorUserId: owner, targetUserId: ed });
    const rows = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(eq(schema.workspaceMembers.workspaceId, w), eq(schema.workspaceMembers.userId, ed)),
      );
    expect(rows).toHaveLength(0);
  });

  it('removeMember refuses to remove an owner', async () => {
    const w = await ws();
    const owner = await user('owner');
    const admin = await user('admin');
    await add(w, owner, 'owner');
    await add(w, admin, 'admin');
    await expect(
      removeMember(db, { workspaceId: w, actorUserId: admin, targetUserId: owner }),
    ).rejects.toMatchObject({ code: 'CANNOT_REMOVE_OWNER' });
  });

  it('removeMember refuses self-removal (use leave)', async () => {
    const w = await ws();
    const admin = await user('admin');
    await add(w, admin, 'admin');
    await expect(
      removeMember(db, { workspaceId: w, actorUserId: admin, targetUserId: admin }),
    ).rejects.toBeInstanceOf(AdminMemberError);
  });
});
