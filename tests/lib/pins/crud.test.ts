import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { addPin, removePin, reorderPins } from '@/lib/pins/crud';
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
  const [u] = await db
    .insert(schema.users)
    .values({ email: `u${ts}@x.test`, passwordHash: 'h', name: 'u' })
    .returning();
  if (!u) throw new Error('user');
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'w', slug: `w-${ts}` })
    .returning();
  if (!ws) throw new Error('ws');
  await db.insert(schema.workspaceMembers).values({
    workspaceId: ws.id,
    userId: u.id,
    role: 'admin',
  });
  const [p1] = await db
    .insert(schema.pages)
    .values({ workspaceId: ws.id, title: 'A', createdBy: u.id, content: {} })
    .returning();
  const [p2] = await db
    .insert(schema.pages)
    .values({ workspaceId: ws.id, title: 'B', createdBy: u.id, content: {} })
    .returning();
  if (!p1 || !p2) throw new Error('page');
  return { db, u, ws, p1, p2 };
}

describe('addPin', () => {
  it('appends at next position', async () => {
    const { db, u, ws, p1, p2 } = await seed();
    const r1 = await addPin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    expect(r1.position).toBe(0);
    const r2 = await addPin(db, { workspaceId: ws.id, pageId: p2.id, actorId: u.id });
    expect(r2.position).toBe(1);
  });

  it('rejects cross-workspace pageId with not_found', async () => {
    const { db, u, ws } = await seed();
    const ts = `${Date.now()}-${Math.random()}`;
    const [otherWs] = await db
      .insert(schema.workspaces)
      .values({ name: 'o', slug: `o-${ts}` })
      .returning();
    if (!otherWs) throw new Error('ws');
    await db.insert(schema.workspaceMembers).values({
      workspaceId: otherWs.id,
      userId: u.id,
      role: 'admin',
    });
    const [otherPage] = await db
      .insert(schema.pages)
      .values({ workspaceId: otherWs.id, title: 'p', createdBy: u.id, content: {} })
      .returning();
    if (!otherPage) throw new Error('page');
    await expect(
      addPin(db, { workspaceId: ws.id, pageId: otherPage.id, actorId: u.id }),
    ).rejects.toThrow(/not_found/);
  });

  it('is idempotent (re-add does not duplicate)', async () => {
    const { db, u, ws, p1 } = await seed();
    await addPin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    await addPin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    const rows = await db
      .select()
      .from(schema.workspacePins)
      .where(
        and(
          eq(schema.workspacePins.workspaceId, ws.id),
          eq(schema.workspacePins.pageId, p1.id),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('writes a workspace.pin_added audit row', async () => {
    const { db, u, ws, p1 } = await seed();
    await addPin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'workspace.pin_added'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.workspaceId).toBe(ws.id);
    expect(auditRows[0]?.actorUserId).toBe(u.id);
  });
});

describe('removePin', () => {
  it('removes the pin row', async () => {
    const { db, u, ws, p1 } = await seed();
    await addPin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    const ok = await removePin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    expect(ok).toBe(true);
    const rows = await db
      .select()
      .from(schema.workspacePins)
      .where(eq(schema.workspacePins.workspaceId, ws.id));
    expect(rows).toHaveLength(0);
  });

  it('returns false for non-existent pin', async () => {
    const { db, u, ws, p1 } = await seed();
    const ok = await removePin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    expect(ok).toBe(false);
  });
});

describe('reorderPins', () => {
  it('writes 0..N positions in the given order', async () => {
    const { db, u, ws, p1, p2 } = await seed();
    await addPin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    await addPin(db, { workspaceId: ws.id, pageId: p2.id, actorId: u.id });
    await reorderPins(db, {
      workspaceId: ws.id,
      actorId: u.id,
      orderedPageIds: [p2.id, p1.id],
    });
    const rows = await db
      .select()
      .from(schema.workspacePins)
      .where(eq(schema.workspacePins.workspaceId, ws.id));
    const map = new Map(rows.map((r) => [r.pageId, r.position]));
    expect(map.get(p2.id)).toBe(0);
    expect(map.get(p1.id)).toBe(1);
  });

  it('throws when orderedPageIds includes a non-pinned page', async () => {
    const { db, u, ws, p1, p2 } = await seed();
    await addPin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    await expect(
      reorderPins(db, { workspaceId: ws.id, actorId: u.id, orderedPageIds: [p1.id, p2.id] }),
    ).rejects.toThrow();
  });
});
