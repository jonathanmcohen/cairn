import { sql as drizzleSql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { purgeWorkspaceTrash } from '@/lib/trash/purge';
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
  await sql`TRUNCATE files, pages, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seedUserAndWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  const db = getDb();
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: ws.id, userId: u.id, role: 'admin' });
  return { userId: u.id, workspaceId: ws.id };
}

async function seedTrashPage(
  workspaceId: string,
  userId: string,
  deletedDaysAgo: number,
): Promise<string> {
  const rows = (await getDb().execute(drizzleSql`
    INSERT INTO pages (workspace_id, created_by, title, content, deleted_at, deleted_root, created_at, updated_at)
    VALUES (
      ${workspaceId},
      ${userId},
      'gone',
      '{}'::jsonb,
      now() - (${String(deletedDaysAgo)} || ' days')::interval,
      true,
      now() - (${String(deletedDaysAgo)} || ' days')::interval,
      now() - (${String(deletedDaysAgo)} || ' days')::interval
    )
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('purgeWorkspaceTrash', () => {
  it('deletes trashed pages older than retentionDays and keeps fresh ones', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    const old = await seedTrashPage(workspaceId, userId, 40);
    const fresh = await seedTrashPage(workspaceId, userId, 5);
    const res = await purgeWorkspaceTrash(getDb(), {
      workspaceId,
      retentionDays: 30,
      reason: 'auto',
    });
    expect(res.purgedCount).toBe(1);
    expect(res.purgedPageIds).toEqual([old]);
    const remaining = (await getDb().execute(drizzleSql`
      SELECT id FROM pages WHERE workspace_id = ${workspaceId}
    `)) as unknown as Array<{ id: string }>;
    expect(remaining.map((r) => r.id)).toEqual([fresh]);
  });

  it('writes a single trash.purged_auto audit row with count metadata', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    await seedTrashPage(workspaceId, userId, 60);
    await purgeWorkspaceTrash(getDb(), { workspaceId, retentionDays: 30, reason: 'auto' });
    const audits = (await getDb().execute(drizzleSql`
      SELECT action, metadata FROM audit_log WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC
    `)) as unknown as Array<{ action: string; metadata: Record<string, unknown> }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('trash.purged_auto');
    expect((audits[0]?.metadata as { count: number }).count).toBe(1);
    expect((audits[0]?.metadata as { retentionDays: number }).retentionDays).toBe(30);
  });

  it('writes trash.purged_manual when reason is manual', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    await seedTrashPage(workspaceId, userId, 60);
    await purgeWorkspaceTrash(getDb(), { workspaceId, retentionDays: 30, reason: 'manual' });
    const audits = (await getDb().execute(drizzleSql`
      SELECT action FROM audit_log WHERE workspace_id = ${workspaceId}
    `)) as unknown as Array<{ action: string }>;
    expect(audits[0]?.action).toBe('trash.purged_manual');
  });

  it('isolates purges per workspace', async () => {
    const a = await seedUserAndWorkspace();
    const b = await seedUserAndWorkspace();
    await seedTrashPage(a.workspaceId, a.userId, 60);
    const keepB = await seedTrashPage(b.workspaceId, b.userId, 60);
    await purgeWorkspaceTrash(getDb(), {
      workspaceId: a.workspaceId,
      retentionDays: 30,
      reason: 'auto',
    });
    const remaining = (await getDb().execute(drizzleSql`
      SELECT id, workspace_id FROM pages
    `)) as unknown as Array<{ id: string; workspace_id: string }>;
    expect(remaining.map((r) => r.id)).toEqual([keepB]);
  });

  it('returns 0 with no audit row when nothing crosses the cutoff', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    await seedTrashPage(workspaceId, userId, 5);
    const res = await purgeWorkspaceTrash(getDb(), {
      workspaceId,
      retentionDays: 30,
      reason: 'auto',
    });
    expect(res.purgedCount).toBe(0);
    const audits = (await getDb().execute(drizzleSql`
      SELECT action FROM audit_log WHERE workspace_id = ${workspaceId}
    `)) as unknown as Array<{ action: string }>;
    expect(audits).toHaveLength(0);
  });

  it('retentionDays=0 purges everything in trash (manual empty-trash semantics)', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    const recent = await seedTrashPage(workspaceId, userId, 1);
    const res = await purgeWorkspaceTrash(getDb(), {
      workspaceId,
      retentionDays: 0,
      reason: 'manual',
    });
    expect(res.purgedCount).toBe(1);
    expect(res.purgedPageIds).toEqual([recent]);
  });

  it('only purges deleted_root=true rows (skips trash descendants)', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    // A trashed root and a row also flagged deleted but NOT a root — only the
    // root should be considered for the cutoff calculation. Descendant cleanup
    // is handled by the recursive collection step inside the implementation.
    const root = await seedTrashPage(workspaceId, userId, 60);
    // Non-root trashed row (e.g. orphan). It still has deleted_at < cutoff but
    // is NOT a root — must not be picked up by the root-level filter.
    const orphanRows = (await getDb().execute(drizzleSql`
      INSERT INTO pages (workspace_id, created_by, title, content, deleted_at, deleted_root)
      VALUES (${workspaceId}, ${userId}, 'orphan', '{}'::jsonb, now() - interval '60 days', false)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const orphan = orphanRows[0]!.id;
    const res = await purgeWorkspaceTrash(getDb(), {
      workspaceId,
      retentionDays: 30,
      reason: 'auto',
    });
    expect(res.purgedPageIds).toEqual([root]);
    const remaining = (await getDb().execute(drizzleSql`
      SELECT id FROM pages WHERE workspace_id = ${workspaceId}
    `)) as unknown as Array<{ id: string }>;
    expect(remaining.map((r) => r.id)).toEqual([orphan]);
  });
});
