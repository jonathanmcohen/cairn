import { eq, inArray } from 'drizzle-orm';
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

/**
 * v0.9.0 G2 P12 — Audit-trail smoke. Confirms the three new audit actions
 * land on the canonical pin lifecycle (add → reorder → remove), so admin
 * audit-log filters / compliance exports see the events.
 */
describe('pin audit kinds', () => {
  it('records added / reordered / removed in a single workspace', async () => {
    const db = getDb();
    const ts = `${Date.now()}-${Math.random()}`;
    const [u] = await db
      .insert(schema.users)
      .values({ email: `a${ts}@x.test`, passwordHash: 'h', name: 'a' })
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
    await addPin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    await addPin(db, { workspaceId: ws.id, pageId: p2.id, actorId: u.id });
    await reorderPins(db, {
      workspaceId: ws.id,
      actorId: u.id,
      orderedPageIds: [p2.id, p1.id],
    });
    await removePin(db, { workspaceId: ws.id, pageId: p1.id, actorId: u.id });
    const rows = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(
        inArray(schema.auditLog.action, [
          'workspace.pin_added',
          'workspace.pin_removed',
          'workspace.pins_reordered',
        ]),
      );
    const kinds = rows.map((r) => r.action).sort();
    expect(kinds).toEqual([
      'workspace.pin_added',
      'workspace.pin_added',
      'workspace.pin_removed',
      'workspace.pins_reordered',
    ]);
    // Workspace-id is stamped on every audit row.
    const wsScoped = await db
      .select({ workspaceId: schema.auditLog.workspaceId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, ws.id));
    expect(wsScoped.length).toBeGreaterThanOrEqual(4);
  });
});
