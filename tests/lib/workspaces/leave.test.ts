import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { LeaveError, leaveWorkspace } from '@/lib/workspaces/leave';
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

async function makeUser(name: string) {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}

async function makeWorkspace() {
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!ws) throw new Error('ws insert failed');
  return ws.id;
}

async function addMember(workspaceId: string, userId: string, role: schema.MemberRole) {
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

describe('leaveWorkspace', () => {
  it('removes a non-owner member', async () => {
    const ws = await makeWorkspace();
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    await addMember(ws, owner, 'owner');
    await addMember(ws, editor, 'editor');

    await leaveWorkspace(db, { workspaceId: ws, userId: editor });

    const remaining = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, ws),
          eq(schema.workspaceMembers.userId, editor),
        ),
      );
    expect(remaining).toHaveLength(0);
  });

  it('rejects the sole owner', async () => {
    const ws = await makeWorkspace();
    const owner = await makeUser('owner');
    await addMember(ws, owner, 'owner');
    await expect(leaveWorkspace(db, { workspaceId: ws, userId: owner })).rejects.toBeInstanceOf(
      LeaveError,
    );
    const still = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, ws));
    expect(still).toHaveLength(1);
  });

  it('allows an owner to leave when another owner remains', async () => {
    const ws = await makeWorkspace();
    const a = await makeUser('owner-a');
    const b = await makeUser('owner-b');
    await addMember(ws, a, 'owner');
    await addMember(ws, b, 'owner');
    await leaveWorkspace(db, { workspaceId: ws, userId: a });
    const owners = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(eq(schema.workspaceMembers.workspaceId, ws), eq(schema.workspaceMembers.role, 'owner')),
      );
    expect(owners).toHaveLength(1);
    expect(owners[0]?.userId).toBe(b);
  });

  it('throws NOT_MEMBER when the user is not a member', async () => {
    const ws = await makeWorkspace();
    const stranger = await makeUser('stranger');
    await expect(leaveWorkspace(db, { workspaceId: ws, userId: stranger })).rejects.toMatchObject({
      code: 'NOT_MEMBER',
    });
  });
});
