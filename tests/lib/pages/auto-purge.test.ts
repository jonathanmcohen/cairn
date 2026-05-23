import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { autoPurge } from '@/lib/pages/auto-purge';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, system_meta RESTART IDENTITY CASCADE`;
});

describe('autoPurge', () => {
  it('deletes pages whose deleted_at is older than retention', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    await sql`UPDATE pages SET deleted_at = now() - interval '31 days' WHERE id = ${p.id}`;

    const purged = await autoPurge(db, { retentionDays: 30 });
    expect(purged).toBeGreaterThan(0);
    const remaining = await db.select().from(schema.pages);
    expect(remaining).toEqual([]);
  });

  it('does NOT touch pages within the retention window', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    const purged = await autoPurge(db, { retentionDays: 30 });
    expect(purged).toBe(0);
    const remaining = await db.select().from(schema.pages);
    expect(remaining).toHaveLength(1);
  });

  it('is a no-op when last purge was less than 1 hour ago', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    await sql`UPDATE pages SET deleted_at = now() - interval '31 days' WHERE id = ${p.id}`;

    await sql`
      INSERT INTO system_meta (key, value)
      VALUES ('last_purge_at', now()::text)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
    `;

    const purged = await autoPurge(db, { retentionDays: 30 });
    expect(purged).toBe(0);
    const remaining = await db.select().from(schema.pages);
    expect(remaining).toHaveLength(1);
  });
});
