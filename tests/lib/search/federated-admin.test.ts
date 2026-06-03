import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { federatedSearch } from '@/lib/search/federated';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log, peer_instances RESTART IDENTITY CASCADE`;
});

describe('federatedSearch — admin cross-workspace', () => {
  it('admin + includeAllWorkspaces=true sees hits in non-member workspaces', async () => {
    const home = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const other = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await createPage(db, {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
      title: 'fishbowl secret',
    });

    const result = await federatedSearch(db, {
      userId: home.userId,
      workspaceId: home.workspaceId,
      role: 'admin',
      query: 'fishbowl',
      filters: {},
      includeAllWorkspaces: true,
    });
    expect(result.local.map((r) => r.title)).toEqual(['fishbowl secret']);
  });

  it('emits search.cross_workspace_admin audit on every admin cross-workspace call', async () => {
    const home = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await federatedSearch(db, {
      userId: home.userId,
      workspaceId: home.workspaceId,
      role: 'admin',
      query: 'anything',
      filters: {},
      includeAllWorkspaces: true,
    });
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'search.cross_workspace_admin'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(home.userId);
    expect(rows[0]?.workspaceId).toBe(home.workspaceId);
    expect(rows[0]?.metadata).toMatchObject({ query: 'anything', scope: 'admin_cross_workspace' });
  });

  it('non-admin caller is NOT allowed to escalate via includeAllWorkspaces', async () => {
    const home = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const other = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await createPage(db, {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
      title: 'forbidden zone',
    });

    const result = await federatedSearch(db, {
      userId: home.userId,
      workspaceId: home.workspaceId,
      role: 'editor', // not admin
      query: 'forbidden',
      filters: {},
      includeAllWorkspaces: true, // ignored
    });
    expect(result.local).toEqual([]);

    // And NO audit row is emitted for non-admin attempts.
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'search.cross_workspace_admin'));
    expect(rows).toEqual([]);
  });
});
