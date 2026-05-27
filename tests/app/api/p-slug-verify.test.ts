import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { publishPage } from '@/lib/pages/publish';
import { setShareSettings } from '@/lib/pages/share';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET ??= 'a'.repeat(32);
  process.env.NEXTAUTH_URL ??= 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log RESTART IDENTITY CASCADE`;
});

async function seedProtectedPage(password: string) {
  const u = await createTestWorkspaceWithUser(getDb());
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'V', createdBy: u.userId })
    .returning();
  if (!p) throw new Error('seed failed');
  const { slug } = await publishPage(getDb(), {
    pageId: p.id,
    workspaceId: u.workspaceId,
    actorUserId: u.userId,
  });
  await setShareSettings(getDb(), {
    pageId: p.id,
    workspaceId: u.workspaceId,
    actorUserId: u.userId,
    password,
  });
  return { slug, pageId: p.id, workspaceId: u.workspaceId };
}

describe('POST /p/[slug]/verify (v0.9.0 G6 P33)', () => {
  it('issues a 5-minute cookie (Max-Age ~300s) on successful verify', async () => {
    const { slug } = await seedProtectedPage('pw');
    const { POST } = await import('@/app/p/[slug]/verify/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'pw' }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('cairn_pub_');
    const m = setCookie.match(/Max-Age=(\d+)/i);
    expect(m).not.toBeNull();
    const age = Number(m![1]);
    // 5-minute TTL, with a small allowance for the test latency. The
    // previous default was 12h (43200s); anything ≤ 300 confirms we are on
    // the new cap.
    expect(age).toBeGreaterThan(0);
    expect(age).toBeLessThanOrEqual(300);
  });

  it('writes share.password_used audit row on success', async () => {
    const { slug, pageId } = await seedProtectedPage('pw');
    const { POST } = await import('@/app/p/[slug]/verify/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'pw' }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select({ action: schema.auditLog.action, targetId: schema.auditLog.targetId })
      .from(schema.auditLog);
    const uses = rows.filter((r) => r.action === 'share.password_used' && r.targetId === pageId);
    expect(uses.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT write a share.password_used row on a failed verify', async () => {
    const { slug } = await seedProtectedPage('pw');
    const { POST } = await import('@/app/p/[slug]/verify/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(401);
    const rows = await db.select().from(schema.auditLog);
    expect(rows.find((r) => r.action === 'share.password_used')).toBeUndefined();
  });
});
