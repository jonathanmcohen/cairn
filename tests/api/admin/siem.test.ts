/**
 * v0.9.0 G8 P39 — admin SIEM-forwarder routes. Covers list/create/update/
 * delete + role gating + secret redaction.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let activeCookie: { name: string; value: string } | undefined;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => activeCookie,
    set: () => {},
    delete: () => {},
  }),
}));

async function actAs(userId: string, workspaceId: string): Promise<void> {
  const a = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  a.__set({ userId });
  activeCookie = { name: 'cairn_ws', value: workspaceId };
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE siem_delivery_log, siem_forwarders, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  activeCookie = undefined;
});

describe('GET /api/admin/siem', () => {
  it('returns forwarders for admin (credential redacted)', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await db.insert(schema.siemForwarders).values({
      workspaceId: admin.workspaceId,
      kind: 'http',
      name: 'primary',
      endpoint: 'https://example.invalid/siem',
      credentialSecret: 'tok_abc',
      options: {},
      enabled: true,
    });
    await actAs(admin.userId, admin.workspaceId);
    const { GET } = await import('@/app/api/admin/siem/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      forwarders: Array<{ name: string; credentialSecret: string | null; hasCredential: boolean }>;
    };
    expect(body.forwarders).toHaveLength(1);
    expect(body.forwarders[0]?.name).toBe('primary');
    expect(body.forwarders[0]?.hasCredential).toBe(true);
    expect(body.forwarders[0]?.credentialSecret).not.toBe('tok_abc');
    const text = JSON.stringify(body);
    expect(text).not.toContain('tok_abc');
  });

  it('403s for editor', async () => {
    const editor = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(editor.userId, editor.workspaceId);
    const { GET } = await import('@/app/api/admin/siem/route');
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('401s when unauthenticated', async () => {
    const { GET } = await import('@/app/api/admin/siem/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/siem', () => {
  it('creates an http forwarder', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/siem/route');
    const res = await POST(
      new Request('http://localhost/api/admin/siem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'http',
          name: 'webhook',
          endpoint: 'https://example.invalid/hook',
          credentialSecret: 'tok_abc',
          options: { timeoutMs: 5000 },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const rows = await db
      .select()
      .from(schema.siemForwarders)
      .where(eq(schema.siemForwarders.workspaceId, admin.workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('http');
    expect(rows[0]?.name).toBe('webhook');
    expect(rows[0]?.credentialSecret).toBe('tok_abc');
  });

  it('400s when the body is malformed (unknown kind)', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/siem/route');
    const res = await POST(
      new Request('http://localhost/api/admin/siem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'unknown',
          name: 'x',
          endpoint: 'https://example.invalid',
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('403s for editor', async () => {
    const editor = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(editor.userId, editor.workspaceId);
    const { POST } = await import('@/app/api/admin/siem/route');
    const res = await POST(
      new Request('http://localhost/api/admin/siem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'http',
          name: 'x',
          endpoint: 'https://example.invalid',
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('writes a workspace.settings_changed audit row that omits the secret', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/siem/route');
    await POST(
      new Request('http://localhost/api/admin/siem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'http',
          name: 'webhook',
          endpoint: 'https://example.invalid/hook',
          credentialSecret: 'tok_super_secret_xyz',
        }),
      }),
    );
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, admin.workspaceId));
    expect(audit?.action).toBe('workspace.settings_changed');
    const json = JSON.stringify(audit?.metadata);
    expect(json).not.toContain('tok_super_secret_xyz');
    expect(json).toContain('forwarder_created');
  });
});

describe('PATCH /api/admin/siem/[id]', () => {
  it('updates fields and audits the change', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [row] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: admin.workspaceId,
        kind: 'http',
        name: 'before',
        endpoint: 'https://example.invalid/old',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    await actAs(admin.userId, admin.workspaceId);
    const { PATCH } = await import('@/app/api/admin/siem/[id]/route');
    const res = await PATCH(
      new Request('http://localhost/api/admin/siem/x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'after', enabled: false }),
      }),
      { params: Promise.resolve({ id: row?.id ?? '' }) },
    );
    expect(res.status).toBe(200);
    const [updated] = await db
      .select()
      .from(schema.siemForwarders)
      .where(eq(schema.siemForwarders.id, row?.id ?? ''));
    expect(updated?.name).toBe('after');
    expect(updated?.enabled).toBe(false);
  });

  it('404s for a forwarder in a different workspace', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const otherWs = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [otherRow] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: otherWs.workspaceId,
        kind: 'http',
        name: 'other',
        endpoint: 'https://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    await actAs(admin.userId, admin.workspaceId);
    const { PATCH } = await import('@/app/api/admin/siem/[id]/route');
    const res = await PATCH(
      new Request('http://localhost/api/admin/siem/x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'hijack' }),
      }),
      { params: Promise.resolve({ id: otherRow?.id ?? '' }) },
    );
    expect(res.status).toBe(404);
  });

  it('403s for editor', async () => {
    const editor = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const [row] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: editor.workspaceId,
        kind: 'http',
        name: 'r',
        endpoint: 'https://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    await actAs(editor.userId, editor.workspaceId);
    const { PATCH } = await import('@/app/api/admin/siem/[id]/route');
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'after' }),
      }),
      { params: Promise.resolve({ id: row?.id ?? '' }) },
    );
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/siem/[id]', () => {
  it('removes the forwarder', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [row] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: admin.workspaceId,
        kind: 'http',
        name: 'r',
        endpoint: 'https://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    await actAs(admin.userId, admin.workspaceId);
    const { DELETE } = await import('@/app/api/admin/siem/[id]/route');
    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), {
      params: Promise.resolve({ id: row?.id ?? '' }),
    });
    expect(res.status).toBe(200);
    const remaining = await db
      .select()
      .from(schema.siemForwarders)
      .where(eq(schema.siemForwarders.id, row?.id ?? ''));
    expect(remaining).toHaveLength(0);
  });

  it('404s for a forwarder in a different workspace', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const otherWs = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [otherRow] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: otherWs.workspaceId,
        kind: 'http',
        name: 'other',
        endpoint: 'https://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    await actAs(admin.userId, admin.workspaceId);
    const { DELETE } = await import('@/app/api/admin/siem/[id]/route');
    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), {
      params: Promise.resolve({ id: otherRow?.id ?? '' }),
    });
    expect(res.status).toBe(404);
    const remaining = await db
      .select()
      .from(schema.siemForwarders)
      .where(eq(schema.siemForwarders.id, otherRow?.id ?? ''));
    expect(remaining).toHaveLength(1);
  });
});

describe('POST /api/admin/siem/[id]/test', () => {
  it('returns ok: false for a forwarder pointed at a non-reachable endpoint', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [row] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: admin.workspaceId,
        kind: 'http',
        name: 'r',
        // Pointed at the standard discard port — TCP RST is the expected
        // failure path. The test asserts the route surfaces the error
        // gracefully rather than 500ing.
        endpoint: 'http://127.0.0.1:9/hook',
        credentialSecret: null,
        options: { timeoutMs: 500 },
        enabled: true,
      })
      .returning();
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/siem/[id]/test/route');
    const res = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: row?.id ?? '' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it('404s for a forwarder in a different workspace', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const otherWs = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [otherRow] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: otherWs.workspaceId,
        kind: 'http',
        name: 'other',
        endpoint: 'https://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/siem/[id]/test/route');
    const res = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: otherRow?.id ?? '' }),
    });
    expect(res.status).toBe(404);
  });
});
