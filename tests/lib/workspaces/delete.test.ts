import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { DeleteWorkspaceError, deleteWorkspace } from '@/lib/workspaces/delete';
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

describe('deleteWorkspace', () => {
  it('owner deletes the workspace -> workspace + members + pages all gone', async () => {
    const w = await ws();
    const owner = await user('owner');
    const member = await user('member');
    await add(w, owner, 'owner');
    await add(w, member, 'editor');
    // Seed a page so we can verify cascade.
    await db.insert(schema.pages).values({
      workspaceId: w,
      title: 'P',
      createdBy: owner,
    });

    await deleteWorkspace(db, { workspaceId: w, actorUserId: owner });

    const wsRows = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, w));
    expect(wsRows).toHaveLength(0);
    const memberRows = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, w));
    expect(memberRows).toHaveLength(0);
    const pageRows = await db.select().from(schema.pages).where(eq(schema.pages.workspaceId, w));
    expect(pageRows).toHaveLength(0);
    // Per-spec note: audit_log.workspace_id has ON DELETE CASCADE, so the
    // workspace.deleted audit row is removed alongside the workspace it
    // describes. The helper still emits recordAudit for contract symmetry.
    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, w));
    expect(auditRows).toHaveLength(0);
  });

  it('non-owner (admin) cannot delete -> NOT_OWNER', async () => {
    const w = await ws();
    const owner = await user('owner');
    const adminU = await user('admin');
    await add(w, owner, 'owner');
    await add(w, adminU, 'admin');
    await expect(
      deleteWorkspace(db, { workspaceId: w, actorUserId: adminU }),
    ).rejects.toMatchObject({ code: 'NOT_OWNER' });
  });

  it('non-member -> NOT_FOUND', async () => {
    const w = await ws();
    const stranger = await user('stranger');
    await expect(
      deleteWorkspace(db, { workspaceId: w, actorUserId: stranger }),
    ).rejects.toBeInstanceOf(DeleteWorkspaceError);
  });
});
