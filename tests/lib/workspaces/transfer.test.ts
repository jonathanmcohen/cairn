import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { TransferError, transferOwnership } from '@/lib/workspaces/transfer';
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
  await pg`TRUNCATE audit_log, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
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
async function role(workspaceId: string, userId: string) {
  const [m] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    );
  return m?.role;
}

describe('transferOwnership', () => {
  it('promotes target to owner, demotes old owner to admin, audits the change', async () => {
    const w = await ws();
    const oldOwner = await user('old');
    const newOwner = await user('new');
    await add(w, oldOwner, 'owner');
    await add(w, newOwner, 'admin');

    await transferOwnership(db, {
      workspaceId: w,
      fromUserId: oldOwner,
      toUserId: newOwner,
    });

    expect(await role(w, newOwner)).toBe('owner');
    expect(await role(w, oldOwner)).toBe('admin');

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, w));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('workspace.ownership_transferred');
    expect(audits[0]?.metadata).toMatchObject({
      fromUserId: oldOwner,
      toUserId: newOwner,
    });
  });

  it('rejects when actor is not the owner', async () => {
    const w = await ws();
    const owner = await user('owner');
    const adminUser = await user('admin');
    const target = await user('target');
    await add(w, owner, 'owner');
    await add(w, adminUser, 'admin');
    await add(w, target, 'editor');
    await expect(
      transferOwnership(db, {
        workspaceId: w,
        fromUserId: adminUser,
        toUserId: target,
      }),
    ).rejects.toMatchObject({ code: 'NOT_OWNER' });
  });

  it('rejects when target is not a member of the workspace', async () => {
    const w = await ws();
    const owner = await user('owner');
    const stranger = await user('stranger');
    await add(w, owner, 'owner');
    await expect(
      transferOwnership(db, {
        workspaceId: w,
        fromUserId: owner,
        toUserId: stranger,
      }),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_MEMBER' });
  });

  it('rejects self-transfer with a TransferError', async () => {
    const w = await ws();
    const owner = await user('owner');
    await add(w, owner, 'owner');
    await expect(
      transferOwnership(db, {
        workspaceId: w,
        fromUserId: owner,
        toUserId: owner,
      }),
    ).rejects.toBeInstanceOf(TransferError);
  });
});
