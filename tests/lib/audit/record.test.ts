import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
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

async function makeWs() {
  const [u] = await db
    .insert(schema.users)
    .values({ email: `a-${Math.random()}@x.com`, passwordHash: 'h', name: 'A' })
    .returning();
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!u || !ws) throw new Error('seed failed');
  return { userId: u.id, workspaceId: ws.id };
}

describe('recordAudit', () => {
  it('inserts a row inside the given transaction', async () => {
    const { userId, workspaceId } = await makeWs();
    await db.transaction(async (tx) => {
      await recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        action: 'workspace.ownership_transferred',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: { fromUserId: userId, toUserId: userId },
      });
    });
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('workspace.ownership_transferred');
    expect(rows[0]?.metadata).toMatchObject({ fromUserId: userId, toUserId: userId });
  });

  it('rolls back with its transaction (no orphan audit row on failure)', async () => {
    const { userId, workspaceId } = await makeWs();
    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, {
          workspaceId,
          actorUserId: userId,
          action: 'workspace.deleted',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });

  it('accepts a null actor (system/cron) and defaults metadata to {}', async () => {
    const { workspaceId } = await makeWs();
    await db.transaction((tx) =>
      recordAudit(tx, { workspaceId, actorUserId: null, action: 'backup.created' }),
    );
    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(row?.actorUserId).toBeNull();
    expect(row?.metadata).toEqual({});
  });
});
