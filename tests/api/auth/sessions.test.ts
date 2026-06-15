import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createSession, listActiveSessions } from '@/lib/auth/session-store';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string; sid?: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId }, sid: ctx.sid } : null),
    __set: (c: { userId: string; sid?: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(c: { userId: string; sid?: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string; sid?: string } | null) => void;
  };
  mod.__set(c);
}

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
  await sql`TRUNCATE auth_sessions, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function listRoute() {
  const { GET } = await import('@/app/api/auth/sessions/route');
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

async function revokeRoute(body?: unknown) {
  const { POST } = await import('@/app/api/auth/sessions/revoke-all/route');
  const req = new Request('http://local/api/auth/sessions/revoke-all', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

async function revokeOneRoute(sessionId: string) {
  const { POST } = await import('@/app/api/auth/sessions/[sessionId]/revoke/route');
  const req = new Request(`http://local/api/auth/sessions/${sessionId}/revoke`, { method: 'POST' });
  const res = await POST(req, { params: Promise.resolve({ sessionId }) });
  return { status: res.status, body: await res.json() };
}

describe('/api/auth/sessions', () => {
  it('GET unauthenticated → 401', async () => {
    await setUser(null);
    expect((await listRoute()).status).toBe(401);
  });

  it('GET lists active sessions and flags the current sid', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const a = await createSession(getDb(), { userId: me.userId, userAgent: 'this' });
    await createSession(getDb(), { userId: me.userId, userAgent: 'phone' });
    await setUser({ userId: me.userId, sid: a });
    const r = await listRoute();
    expect(r.status).toBe(200);
    const sessions = (r.body as { sessions: Array<{ id: string; current: boolean }> }).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.id === a)?.current).toBe(true);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it('POST revoke-all (default) revokes others, keeps current', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const a = await createSession(getDb(), { userId: me.userId });
    await createSession(getDb(), { userId: me.userId });
    await createSession(getDb(), { userId: me.userId });
    await setUser({ userId: me.userId, sid: a });
    const r = await revokeRoute();
    expect(r.status).toBe(200);
    expect((r.body as { revoked: number }).revoked).toBe(2);
    const active = await listActiveSessions(getDb(), me.userId);
    expect(active.map((s) => s.id)).toEqual([a]);
  });

  it('POST revoke-all { scope: "all" } revokes current too', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const a = await createSession(getDb(), { userId: me.userId });
    await createSession(getDb(), { userId: me.userId });
    await setUser({ userId: me.userId, sid: a });
    const r = await revokeRoute({ scope: 'all' });
    expect(r.status).toBe(200);
    expect((r.body as { revoked: number }).revoked).toBe(2);
    expect(await listActiveSessions(getDb(), me.userId)).toHaveLength(0);
  });

  it('POST unauthenticated → 401', async () => {
    await setUser(null);
    expect((await revokeRoute()).status).toBe(401);
  });

  // v0.10.3 Q-2 — per-session revoke route.
  it('POST [sessionId]/revoke revokes one session, leaves the current one', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const current = await createSession(getDb(), { userId: me.userId, userAgent: 'this' });
    const phone = await createSession(getDb(), { userId: me.userId, userAgent: 'phone' });
    await setUser({ userId: me.userId, sid: current });
    const r = await revokeOneRoute(phone);
    expect(r.status).toBe(200);
    expect((r.body as { revoked: boolean }).revoked).toBe(true);
    const active = await listActiveSessions(getDb(), me.userId);
    expect(active.map((s) => s.id)).toEqual([current]);
  });

  it("POST [sessionId]/revoke → 404 for another user's session (no cross-account revoke)", async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const theirSid = await createSession(getDb(), { userId: other.userId });
    await setUser({ userId: me.userId, sid: await createSession(getDb(), { userId: me.userId }) });
    const r = await revokeOneRoute(theirSid);
    expect(r.status).toBe(404);
    expect((r.body as { revoked: boolean }).revoked).toBe(false);
    // their session is untouched
    expect(await listActiveSessions(getDb(), other.userId)).toHaveLength(1);
  });

  it('POST [sessionId]/revoke unauthenticated → 401', async () => {
    await setUser(null);
    expect((await revokeOneRoute('00000000-0000-0000-0000-000000000000')).status).toBe(401);
  });
});
