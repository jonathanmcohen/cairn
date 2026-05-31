import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createSession, revokeAllSessions } from '@/lib/auth/session-store';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

// Drive the resolved Auth.js session and the active-workspace cookie.
vi.mock('@/lib/auth/config', () => {
  let s: { user: { id: string }; sid?: string } | null = null;
  return {
    auth: async () => s,
    __set: (v: typeof s) => {
      s = v;
    },
  };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

type MockSession = { user: { id: string }; sid?: string } | null;

async function setSession(v: MockSession) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (v: MockSession) => void;
  };
  mod.__set(v);
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
  await sql`TRUNCATE auth_sessions, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  vi.resetModules();
});

async function loadGate() {
  // Re-import after resetModules so the require-role module binds the mocks.
  return (await import('@/lib/auth/require-role')).getAuthContext;
}

describe('getAuthContext sid revocation (#70)', () => {
  it('returns a context for an active sid', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const sid = await createSession(getDb(), { userId: me.userId });
    await setSession({ user: { id: me.userId }, sid });
    const getAuthContext = await loadGate();
    const ctx = await getAuthContext();
    expect(ctx?.userId).toBe(me.userId);
  });

  it('returns null when the sid is revoked', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const sid = await createSession(getDb(), { userId: me.userId });
    await revokeAllSessions(getDb(), me.userId, {});
    await setSession({ user: { id: me.userId }, sid });
    const getAuthContext = await loadGate();
    expect(await getAuthContext()).toBeNull();
  });

  it('returns null when the sid row is missing entirely', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession({ user: { id: me.userId }, sid: crypto.randomUUID() });
    const getAuthContext = await loadGate();
    expect(await getAuthContext()).toBeNull();
  });

  it('allows a session with no sid (legacy/OAuth token)', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession({ user: { id: me.userId } });
    const getAuthContext = await loadGate();
    const ctx = await getAuthContext();
    expect(ctx?.userId).toBe(me.userId);
  });
});
