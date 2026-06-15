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
  // Audit post-write SIEM hook races the per-file pool teardown; no-op it.
  process.env.CAIRN_DISABLE_SIEM_HOOK = '1';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE cron_schedules, audit_log, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function get() {
  const { GET } = await import('@/app/api/admin/schedules/route');
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

async function patch(id: string, body: unknown) {
  const { PATCH } = await import('@/app/api/admin/schedules/[id]/route');
  const res = await PATCH(
    new Request(`http://localhost/api/admin/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

async function runNow(id: string) {
  const { POST } = await import('@/app/api/admin/schedules/[id]/run/route');
  const res = await POST(
    new Request(`http://localhost/api/admin/schedules/${id}/run`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

async function seed(): Promise<string> {
  const [row] = await getDb()
    .insert(schema.cronSchedules)
    .values({
      command: 'trash:purge',
      cronSpec: '0 3 * * *',
      nextRunAt: new Date(Date.now() + 86_400_000),
      enabled: true,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row.id;
}

describe('admin schedules API', () => {
  it('GET is 403 for a non-admin member', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    await setUser(userId);
    const r = await get();
    expect(r.status).toBe(403);
  });

  it('GET is 401 when unauthenticated', async () => {
    await setUser(null);
    const r = await get();
    expect(r.status).toBe(401);
  });

  it('admin GET lists schedules', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(userId);
    await seed();
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.schedules).toHaveLength(1);
    expect(r.body.schedules[0].command).toBe('trash:purge');
  });

  it('admin PATCH updates the cron + audits config.schedule_updated', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(userId);
    const id = await seed();

    const r = await patch(id, { cronSpec: '*/5 * * * *', enabled: false });
    expect(r.status).toBe(200);
    expect(r.body.schedule.cronSpec).toBe('*/5 * * * *');
    expect(r.body.schedule.enabled).toBe(false);

    const audits =
      await sql`SELECT action, target_id FROM audit_log WHERE action = 'config.schedule_updated'`;
    expect(audits.length).toBe(1);
    expect(audits[0]?.target_id).toBe(id);
  });

  it('PATCH with an invalid cron expression is 400', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(userId);
    const id = await seed();
    const r = await patch(id, { cronSpec: 'not a cron' });
    expect(r.status).toBe(400);
    // No write happened.
    const rows = await getDb().select().from(schema.cronSchedules);
    expect(rows[0]?.cronSpec).toBe('0 3 * * *');
  });

  it('PATCH on an unknown id is 404', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(userId);
    const r = await patch('00000000-0000-0000-0000-000000000000', { enabled: false });
    expect(r.status).toBe(404);
  });

  it('POST run marks it due now + audits config.schedule_run', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(userId);
    const id = await seed();

    const r = await runNow(id);
    expect(r.status).toBe(200);
    expect(new Date(r.body.schedule.nextRunAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    const audits = await sql`SELECT action FROM audit_log WHERE action = 'config.schedule_run'`;
    expect(audits.length).toBe(1);
  });

  it('POST run is 403 for a non-admin', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(userId);
    const id = await seed();
    const r = await runNow(id);
    expect(r.status).toBe(403);
  });
});
