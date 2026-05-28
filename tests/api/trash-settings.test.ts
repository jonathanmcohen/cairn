import { sql as drizzleSql, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE files, pages, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

describe('PATCH /api/workspace/trash-settings', () => {
  it('updates trash_retention_days and writes a workspace.settings_changed audit row', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/workspace/trash-settings/route');
    const res = await PATCH(
      new Request('http://localhost/api/workspace/trash-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retentionDays: 7 }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await getDb()
      .select({ retention: schema.workspaces.trashRetentionDays })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, u.workspaceId));
    expect(rows[0]?.retention).toBe(7);
    const audits = (await getDb().execute(drizzleSql`
      SELECT action, metadata FROM audit_log WHERE workspace_id = ${u.workspaceId}
    `)) as unknown as Array<{ action: string; metadata: Record<string, unknown> }>;
    expect(audits[0]?.action).toBe('workspace.settings_changed');
    expect((audits[0]?.metadata as { setting: string }).setting).toBe('trash_retention_days');
  });

  it('rejects negative or huge values', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/workspace/trash-settings/route');
    const r1 = await PATCH(
      new Request('http://localhost/api/workspace/trash-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retentionDays: -1 }),
      }),
    );
    expect(r1.status).toBe(400);
    const r2 = await PATCH(
      new Request('http://localhost/api/workspace/trash-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retentionDays: 99999 }),
      }),
    );
    expect(r2.status).toBe(400);
  });

  it('rejects non-admin', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/workspace/trash-settings/route');
    const res = await PATCH(
      new Request('http://localhost/api/workspace/trash-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retentionDays: 7 }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/workspace/trash-empty', () => {
  it('purges every trashed page and writes a trash.purged_manual audit row', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await getDb().execute(drizzleSql`
      INSERT INTO pages (workspace_id, created_by, title, content, deleted_at, deleted_root)
      VALUES (
        ${u.workspaceId}::uuid,
        ${u.userId}::uuid,
        'recent trash',
        '{}'::jsonb,
        now() - interval '1 day',
        true
      )
    `);
    await setUser(u.userId);
    const { POST } = await import('@/app/api/workspace/trash-empty/route');
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { purgedCount: number };
    expect(body.purgedCount).toBe(1);
    const audits = (await getDb().execute(drizzleSql`
      SELECT action FROM audit_log WHERE workspace_id = ${u.workspaceId}
    `)) as unknown as Array<{ action: string }>;
    expect(audits.map((a) => a.action)).toContain('trash.purged_manual');
    const remaining = (await getDb().execute(drizzleSql`
      SELECT id FROM pages WHERE workspace_id = ${u.workspaceId}
    `)) as unknown as Array<{ id: string }>;
    expect(remaining).toHaveLength(0);
  });

  it('rejects non-admin', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    await setUser(u.userId);
    const { POST } = await import('@/app/api/workspace/trash-empty/route');
    const res = await POST();
    expect(res.status).toBe(403);
  });
});
