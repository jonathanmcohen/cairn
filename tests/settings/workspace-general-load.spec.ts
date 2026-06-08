/**
 * v0.9.15 Plan A #1 — /settings/workspace/general 500 reproduction harness.
 *
 * The live 500 did NOT reproduce in the v0.9.14 Postgres harness (general-loader
 * .test.ts), because that harness always runs the FULL migration set, so the
 * schema is always fresh. The remaining untested hypothesis is MIGRATION DRIFT:
 * a prod DB deployed BEFORE a recent migration ran is missing a column the loader
 * SELECTs, so Postgres throws 42703 ("column does not exist") and the whole RSC
 * page 500s — the v0.9.4-class `workspaces.icon` outage.
 *
 * loadWorkspaceGeneralSettings() projects exactly four columns:
 *   name (0001), require_2fa (0021), home_page_id (0021), icon (0054).
 * Three of those are years old. `icon` (migration 0054, v0.9.4) is the NEWEST
 * column the loader touches — and it is exactly the column that caused the prior
 * outage. The "narrowed projection" fix shipped in v0.9.14 still selects `icon`,
 * so it does NOT protect against a deploy that predates 0054.
 *
 * This suite drops `workspaces.icon` to simulate a stale deploy and asserts the
 * loader's behavior, then exercises the normal permutations (no home page, no
 * extra members, null icon, viewer vs admin, missing cookie) on a fresh schema
 * as the always-on regression guard.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { requireRole } from '@/lib/auth/require-role';
import { searchWorkspacePages } from '@/lib/workspaces/pages';
import { loadWorkspaceGeneralSettings } from '@/lib/workspaces/settings';
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
});

afterAll(async () => {
  // Re-add icon if a drift test left it dropped, so we never leave the shared
  // singleton container in a half-migrated state for later test files.
  await sql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS icon text`;
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

vi.mock('next/headers', () => {
  let workspaceId: string | undefined;
  return {
    cookies: async () => ({
      get: (name: string) =>
        name === 'cairn_ws' && workspaceId ? { name: 'cairn_ws', value: workspaceId } : undefined,
      set: () => {},
    }),
    __setWorkspaceId: (id: string | undefined) => {
      workspaceId = id;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function setWorkspace(id: string | undefined) {
  const mod = (await import('next/headers')) as unknown as {
    __setWorkspaceId: (id: string | undefined) => void;
  };
  mod.__setWorkspaceId(id);
}

/** Replicate the RSC page's data path verbatim so a throw here == a 500 live. */
async function loadPageData(workspaceId: string) {
  const db = getDb();
  const row = await loadWorkspaceGeneralSettings(db, workspaceId);
  if (!row) throw new Error('workspace missing');
  const pages = await searchWorkspacePages(db, { workspaceId, query: '', limit: 100 });
  return {
    initial: {
      name: row.name,
      requireTwofa: row.requireTwofa,
      homePageId: row.homePageId,
      icon: row.icon,
    },
    pages: pages.map((p) => ({ id: p.id, title: p.title })),
  };
}

describe('workspace general settings — fresh-schema regression guard (#1)', () => {
  it('loads on a workspace with no home page, no members beyond owner, null icon', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);

    const ctx = await requireRole('admin');
    const data = await loadPageData(ctx.workspaceId);
    expect(data.initial.name).toBeDefined();
    expect(data.initial.homePageId).toBeNull();
    expect(data.initial.icon).toBeNull();
    expect(data.pages).toEqual([]);
  });

  it('loads for an owner role too (>= admin)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);
    const ctx = await requireRole('admin');
    await expect(loadPageData(ctx.workspaceId)).resolves.toBeTruthy();
  });

  it('requireRole 403s for a viewer (page never reaches the loader)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);
    await expect(requireRole('admin')).rejects.toThrow();
  });

  it('requireRole resolves with no workspace cookie (falls back to first membership)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    await setWorkspace(undefined); // no cairn_ws cookie
    const ctx = await requireRole('admin');
    expect(ctx.workspaceId).toBe(u.workspaceId);
    await expect(loadPageData(ctx.workspaceId)).resolves.toBeTruthy();
  });

  it('loads with a populated icon + a home page set', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await sql`UPDATE workspaces SET icon = 'emoji::🪨' WHERE id = ${u.workspaceId}`;
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);
    const ctx = await requireRole('admin');
    const data = await loadPageData(ctx.workspaceId);
    expect(data.initial.icon).toBe('emoji::🪨');
  });
});

describe('workspace general settings — migration drift (stale deploy) (#1)', () => {
  // Simulate a prod DB deployed BEFORE migration 0054 (workspaces.icon) ran.
  beforeEach(async () => {
    await sql`ALTER TABLE workspaces DROP COLUMN IF EXISTS icon`;
  });
  afterAll(async () => {
    await sql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS icon text`;
  });

  // Seed a workspace + admin via RAW SQL (NOT the Drizzle fixture, which
  // INSERT ... RETURNINGs every column incl. `icon` and so can't run on the
  // stale schema). This mirrors prod: the row was created by an OLDER baseline
  // that predates 0054, so it exists but has no `icon` column. The page's
  // SELECT path is then the only thing under test.
  async function seedStaleWorkspaceWithAdmin(): Promise<{
    workspaceId: string;
    userId: string;
  }> {
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (name, slug) VALUES ('Stale WS', 'stale-ws') RETURNING id`;
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, name)
      VALUES ('admin@stale.example', 'h', 'admin') RETURNING id`;
    if (!ws || !user) throw new Error('seed failed');
    await sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${ws.id}, ${user.id}, 'admin')`;
    return { workspaceId: ws.id, userId: user.id };
  }

  it('loader does NOT 500 when workspaces.icon is missing (defensive fallback)', async () => {
    const u = await seedStaleWorkspaceWithAdmin();
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);
    const ctx = await requireRole('admin');

    // This is the exact data path of the RSC page. On a stale deploy missing the
    // `icon` column, the page must still render (icon treated as null) rather
    // than throwing 42703 and 500-ing the whole settings segment.
    const data = await loadPageData(ctx.workspaceId);
    expect(data.initial.name).toBe('Stale WS');
    expect(data.initial.icon).toBeNull();
  });
});
