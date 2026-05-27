/**
 * v0.9.0 G8 P42 — GET /api/admin/upgrade/status.
 *
 * Returns the bundled `package.json#version` and the latest known
 * available version from the notifications table. Admin-gated.
 */

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
  await sql`TRUNCATE notifications, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  activeCookie = undefined;
  const a = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  a.__set(null);
});

describe('GET /api/admin/upgrade/status', () => {
  it('returns 401 unauthenticated', async () => {
    const { GET } = await import('@/app/api/admin/upgrade/status/route');
    const res = await GET(new Request('http://x/api/admin/upgrade/status'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for editor', async () => {
    const editor = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(editor.userId, editor.workspaceId);
    const { GET } = await import('@/app/api/admin/upgrade/status/route');
    const res = await GET(new Request('http://x/api/admin/upgrade/status'));
    expect(res.status).toBe(403);
  });

  it('returns current + null available when no upgrade_available notifications', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(admin.userId, admin.workspaceId);
    const { GET } = await import('@/app/api/admin/upgrade/status/route');
    const res = await GET(new Request('http://x/api/admin/upgrade/status'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      currentVersion: string;
      availableVersion: string | null;
      releaseNotesUrl: string | null;
    };
    expect(body.currentVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.availableVersion).toBeNull();
    expect(body.releaseNotesUrl).toBeNull();
  });

  it('returns latest available version from notifications', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(admin.userId, admin.workspaceId);
    await db.insert(schema.notifications).values([
      {
        userId: admin.userId,
        workspaceId: admin.workspaceId,
        type: 'upgrade_available',
        payload: { version: '0.9.0', releaseNotesUrl: 'https://x/v0.9.0' },
      },
      {
        userId: admin.userId,
        workspaceId: admin.workspaceId,
        type: 'upgrade_available',
        payload: { version: '0.10.0', releaseNotesUrl: 'https://x/v0.10.0' },
      },
    ]);
    const { GET } = await import('@/app/api/admin/upgrade/status/route');
    const res = await GET(new Request('http://x/api/admin/upgrade/status'));
    const body = (await res.json()) as {
      availableVersion: string;
      releaseNotesUrl: string;
    };
    expect(body.availableVersion).toBe('0.10.0');
    expect(body.releaseNotesUrl).toBe('https://x/v0.10.0');
  });
});
