import type { NextAuthConfig } from 'next-auth';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { listActiveSessions } from '@/lib/auth/session-store';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

// `@/lib/auth/config` evaluates `DrizzleAdapter(getDb())` at module load, which
// caches a db connection from the env's DATABASE_URL. Import it lazily AFTER
// `beforeAll` points DATABASE_URL at the Testcontainers instance so the
// callbacks operate against the migrated test db, not a stale dev db.
let jwtCb: NonNullable<NonNullable<NextAuthConfig['callbacks']>['jwt']>;
let sessionCb: NonNullable<NonNullable<NextAuthConfig['callbacks']>['session']>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  const { authConfig } = await import('@/lib/auth/config');
  jwtCb = authConfig.callbacks!.jwt!;
  sessionCb = authConfig.callbacks!.session!;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE auth_sessions, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('jwt callback session store (#70)', () => {
  it('mints a sid + writes one auth_sessions row on sign-in', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const token = (await jwtCb({
      token: {},
      user: { id: me.userId, email: 'a@b.com' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal Auth.js callback args under test
    } as any)) as Record<string, unknown>;
    expect(typeof token.sid).toBe('string');
    const rows = await listActiveSessions(getDb(), me.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(token.sid);
  });

  it('does not create a second row on subsequent (user-less) calls; touches last_seen', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    // biome-ignore lint/suspicious/noExplicitAny: minimal Auth.js callback args under test
    const t1 = (await jwtCb({ token: {}, user: { id: me.userId } } as any)) as Record<
      string,
      unknown
    >;
    const sid = t1.sid as string;
    await sql`UPDATE auth_sessions SET last_seen_at = now() - interval '1 hour' WHERE id = ${sid}`;
    const before = (await listActiveSessions(getDb(), me.userId))[0]?.lastSeenAt;
    // biome-ignore lint/suspicious/noExplicitAny: minimal Auth.js callback args under test
    const t2 = (await jwtCb({ token: { id: me.userId, sid } } as any)) as Record<string, unknown>;
    expect(t2.sid).toBe(sid);
    expect(await listActiveSessions(getDb(), me.userId)).toHaveLength(1);
    const after = (await listActiveSessions(getDb(), me.userId))[0]?.lastSeenAt;
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it('session callback copies sid from token onto the session', async () => {
    const session = (await sessionCb({
      session: { user: { id: 'u1', email: 'a@b.com' } },
      token: { id: 'u1', sid: 'sid-123' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal Auth.js callback args under test
    } as any)) as unknown as Record<string, unknown>;
    expect(session.sid).toBe('sid-123');
  });
});
