import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { ensureInboxPage } from '@/lib/inbox/lazy-page';
import { getOnboardingState } from '@/lib/onboarding/state';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspace_members, workspaces, users, audit_log RESTART IDENTITY CASCADE`;
});

describe('getOnboardingState', () => {
  it('returns hasAnyUserPages=false for a brand-new workspace (zero pages)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const state = await getOnboardingState(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
    });
    expect(state.hasAnyUserPages).toBe(false);
    expect(typeof state.workspaceName).toBe('string');
    expect(state.workspaceName.length).toBeGreaterThan(0);
  });

  it('returns hasAnyUserPages=false when only the inbox system page exists', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    // P8's lazy-create makes the inbox page; it carries metadata.systemPage = 'inbox'.
    await ensureInboxPage(db, { workspaceId: u.workspaceId, userId: u.userId });
    const state = await getOnboardingState(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
    });
    expect(state.hasAnyUserPages).toBe(false);
  });

  it('returns hasAnyUserPages=true when any non-system page exists', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await db.insert(schema.pages).values({
      workspaceId: u.workspaceId,
      parentId: null,
      title: 'My first page',
      icon: null,
      content: { type: 'doc', content: [] } as never,
      metadata: {} as never,
      createdBy: u.userId,
    } as never);
    const state = await getOnboardingState(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
    });
    expect(state.hasAnyUserPages).toBe(true);
  });

  it('returns the workspace name from the workspaces row', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await db
      .update(schema.workspaces)
      .set({ name: 'My Test Workspace' })
      .where(eq(schema.workspaces.id, u.workspaceId));
    const state = await getOnboardingState(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
    });
    expect(state.workspaceName).toBe('My Test Workspace');
  });
});
