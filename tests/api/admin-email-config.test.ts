import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
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
  await sql`TRUNCATE instance_email_config, audit_log, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
  for (const k of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'SMTP_SECURE',
  ]) {
    delete process.env[k];
  }
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
  const { GET } = await import('@/app/api/admin/email-config/route');
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

async function put(body: unknown) {
  const { PUT } = await import('@/app/api/admin/email-config/route');
  const res = await PUT(
    new Request('http://localhost/api/admin/email-config', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function postTest() {
  const { POST } = await import('@/app/api/admin/email-config/test/route');
  const res = await POST();
  return { status: res.status, body: await res.json() };
}

const VALID = {
  host: 'smtp.example.com',
  port: 587,
  tlsMode: 'starttls',
  username: 'mailer',
  password: 'hunter2',
  fromAddress: 'noreply@example.com',
  replyTo: null,
};

describe('admin email-config API', () => {
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

  it('admin PUT saves, masks the password on read-back, and audits', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(userId);

    const saved = await put(VALID);
    expect(saved.status).toBe(200);
    expect(saved.body.passwordSet).toBe(true);
    expect(saved.body.source).toBe('db');
    // Never echoes the password back.
    expect(JSON.stringify(saved.body)).not.toContain('hunter2');

    const fetched = await get();
    expect(fetched.body.host).toBe('smtp.example.com');
    expect(fetched.body.passwordSet).toBe(true);
    expect(JSON.stringify(fetched.body)).not.toContain('hunter2');

    const audits = await sql`SELECT action FROM audit_log WHERE action = 'config.email_updated'`;
    expect(audits.length).toBe(1);
  });

  it('password is write-once: omitting it on a later PUT keeps the stored one', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(userId);
    await put(VALID);
    const { password: _omit, ...withoutPassword } = VALID;
    const r = await put({ ...withoutPassword, host: 'smtp2.example.com' });
    expect(r.status).toBe(200);
    expect(r.body.host).toBe('smtp2.example.com');
    expect(r.body.passwordSet).toBe(true);
  });

  it('test endpoint reports not_configured when email is off', async () => {
    const { userId } = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(userId);
    const r = await postTest();
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe('not_configured');
  });
});
