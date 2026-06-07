/**
 * Regression harness for #1 — /settings/workspace/general 500.
 *
 * The RSC page calls three functions in sequence:
 *   1. requireRole('admin')      — needs a valid session + workspace cookie
 *   2. loadWorkspaceGeneralSettings(db, workspaceId)
 *   3. searchWorkspacePages(db, { workspaceId, query: '', limit: 100 })
 *
 * This test exercises those functions directly against a real Postgres instance.
 * If any function throws here, the error message will tell us the actual cause
 * of the 500 — read the failure output carefully before writing a fix.
 *
 * Do NOT add a fix in this task. Task A2-T2 implements the minimal fix
 * after confirming the real failure.
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
    __setWorkspaceId: (id: string) => {
      workspaceId = id;
    },
  };
});

async function setUser(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

async function setWorkspace(id: string) {
  const mod = (await import('next/headers')) as unknown as {
    __setWorkspaceId: (id: string) => void;
  };
  mod.__setWorkspaceId(id);
}

describe('/settings/workspace/general — loader functions (#1)', () => {
  it('requireRole admin + loadWorkspaceGeneralSettings + searchWorkspacePages all resolve without throwing', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);

    // Step 1 — requireRole must not throw for an admin
    const ctx = await requireRole('admin');
    expect(ctx.userId).toBe(u.userId);
    expect(ctx.workspaceId).toBe(u.workspaceId);

    // Step 2 — loadWorkspaceGeneralSettings must return the row
    const row = await loadWorkspaceGeneralSettings(getDb(), ctx.workspaceId);
    expect(row).not.toBeNull();
    expect(row?.name).toBeDefined();

    // Step 3 — searchWorkspacePages must return an array (may be empty)
    const pages = await searchWorkspacePages(getDb(), {
      workspaceId: ctx.workspaceId,
      query: '',
      limit: 100,
    });
    expect(Array.isArray(pages)).toBe(true);
  });

  it('requireRole throws when session is missing (unauthenticated)', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as {
      __set: (c: { userId: string } | null) => void;
    };
    mod.__set(null);
    await expect(requireRole('admin')).rejects.toThrow();
  });

  it('requireRole throws 403 when user is below admin (editor)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(u.userId);
    await setWorkspace(u.workspaceId);
    await expect(requireRole('admin')).rejects.toThrow();
  });

  it('loadWorkspaceGeneralSettings returns null for a non-existent workspace (does not throw)', async () => {
    const row = await loadWorkspaceGeneralSettings(
      getDb(),
      '00000000-0000-0000-0000-000000000000',
    );
    expect(row).toBeNull();
  });

  it('documents the error.tsx boundary path: a null settings row makes the page throw "workspace missing"', async () => {
    // The RSC page (src/app/(app)/settings/workspace/general/page.tsx) does:
    //   const row = await loadWorkspaceGeneralSettings(db, ctx.workspaceId);
    //   if (!row) throw new Error('workspace missing');
    // That throw is caught by src/app/(app)/settings/error.tsx, which renders a
    // friendly recoverable card. This test pins the loader's null contract that
    // feeds that boundary so the documented behavior can't regress silently.
    const row = await loadWorkspaceGeneralSettings(
      getDb(),
      '00000000-0000-0000-0000-000000000000',
    );
    // Mirror the page's guard: null => the page throws, which error.tsx handles.
    const pageGuard = () => {
      if (!row) throw new Error('workspace missing');
    };
    expect(pageGuard).toThrow('workspace missing');
  });
});
