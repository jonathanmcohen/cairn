import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import type { MigrationStatus } from '@/lib/upgrade/status';
import { loadJournalFromPath, resolveJournalPath } from '@/lib/upgrade/status';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

// v0.10.0 D7 — route-level coverage for GET /api/admin/migrations: role gate
// (admin/owner only, same posture as the sibling /api/admin/health route) and
// the happy-path shape against a fully-migrated Testcontainers database.

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
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

async function asUser(role: schema.MemberRole) {
  const u = await createTestWorkspaceWithUser(db, { role });
  await setUser(u.userId);
  return u;
}

beforeEach(async () => {
  // NOTE: drizzle.__drizzle_migrations is deliberately NOT touched — the
  // happy-path test asserts against the fully-migrated state.
  await sql`TRUNCATE workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await setUser(null);
});

describe('GET /api/admin/migrations', () => {
  it('401 without a session', async () => {
    const { GET } = await import('@/app/api/admin/migrations/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 for an editor', async () => {
    await asUser('editor');
    const { GET } = await import('@/app/api/admin/migrations/route');
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('403 for a viewer', async () => {
    await asUser('viewer');
    const { GET } = await import('@/app/api/admin/migrations/route');
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('admin gets the full status shape; the test DB is fully migrated → OK state', async () => {
    await asUser('admin');
    const { GET } = await import('@/app/api/admin/migrations/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as MigrationStatus;

    const journalPath = resolveJournalPath();
    expect(journalPath).not.toBeNull();
    const journal = await loadJournalFromPath(journalPath as string);

    expect(body.journalCount).toBe(journal.entries.length);
    expect(body.appliedCount).toBe(journal.entries.length);
    expect(body.pending).toEqual([]);
    expect(body.drifted).toBe(false);
    expect(body.currentVersion).toBe(journal.entries.at(-1)?.tag);
    expect(body.applied).toHaveLength(journal.entries.length);
    for (const entry of body.applied) {
      expect(typeof entry.tag).toBe('string');
      // appliedAt is the row's created_at normalized to ISO.
      expect(typeof entry.appliedAt).toBe('string');
      expect(Number.isNaN(Date.parse(entry.appliedAt as string))).toBe(false);
    }
  });
});
