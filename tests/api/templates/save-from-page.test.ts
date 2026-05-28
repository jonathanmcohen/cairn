import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

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
  await sql`TRUNCATE templates, pages, workspace_members, workspaces, users, audit_log, sessions, accounts RESTART IDENTITY CASCADE`;
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer' = 'editor') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function seedPage(workspaceId: string, userId: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({
      workspaceId,
      title: 'P',
      content: { type: 'doc', content: [{ type: 'paragraph' }] } as never,
      createdBy: userId,
    } as never)
    .returning({ id: schema.pages.id });
  if (!p) throw new Error('seed page failed');
  return p.id;
}

async function call(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('@/app/api/templates/save-from-page/route');
  const res = await POST(
    new Request('http://localhost/api/templates/save-from-page', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('POST /api/templates/save-from-page', () => {
  it('200 + creates template with the chosen visibility', async () => {
    const u = await asUser('editor');
    const pageId = await seedPage(u.workspaceId, u.userId);
    const r = await call({ pageId, name: 'tpl', visibility: 'workspace' });
    expect(r.status).toBe(200);
    const body = r.body as { templateId: string };
    expect(body.templateId).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await getDb()
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.id, body.templateId));
    expect(row?.visibility).toBe('workspace');
    expect(row?.workspaceId).toBe(u.workspaceId);
  });

  it('400 on unknown visibility', async () => {
    const u = await asUser('editor');
    const pageId = await seedPage(u.workspaceId, u.userId);
    const r = await call({ pageId, name: 'x', visibility: 'galactic' });
    expect(r.status).toBe(400);
  });

  it('404 on cross-workspace page', async () => {
    const u1 = await asUser('editor');
    const pageId = await seedPage(u1.workspaceId, u1.userId);
    // Switch to a second user in a different workspace
    const u2 = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const mod = (await import('@/lib/auth/config')) as unknown as {
      __set: (c: { userId: string } | null) => void;
    };
    mod.__set({ userId: u2.userId });
    const r = await call({ pageId, name: 'x', visibility: 'workspace' });
    expect(r.status).toBe(404);
  });

  it('401 when not signed in', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as {
      __set: (c: { userId: string } | null) => void;
    };
    mod.__set(null);
    const r = await call({
      pageId: '00000000-0000-0000-0000-000000000000',
      name: 'x',
      visibility: 'workspace',
    });
    expect(r.status).toBe(401);
  });

  it('403 when caller lacks editor role', async () => {
    const u = await asUser('viewer');
    const pageId = await seedPage(u.workspaceId, u.userId);
    const r = await call({ pageId, name: 'x', visibility: 'workspace' });
    expect(r.status).toBe(403);
  });
});
