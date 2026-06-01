import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { runOrphanPurgeCli } from '@/lib/pages/orphan-purge-cli';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let uri: string;
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const prevUrl = process.env.DATABASE_URL;

beforeAll(async () => {
  uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  process.env.DATABASE_URL = prevUrl;
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log RESTART IDENTITY CASCADE`;
});

describe('runOrphanPurgeCli', () => {
  it('soft-deletes an aged orphan via its own connection', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const orphan = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await db.execute(drizzleSql`
      UPDATE pages SET created_at = now() - interval '60 days' WHERE id = ${orphan.id}
    `);

    const result = await runOrphanPurgeCli({ olderThanDays: 30, dryRun: false });
    expect(result.purgedCount).toBe(1);

    const [row] = (await db.execute(drizzleSql`
      SELECT deleted_at FROM pages WHERE id = ${orphan.id}
    `)) as unknown as Array<{ deleted_at: Date | null }>;
    expect(row?.deleted_at).not.toBeNull();
  });

  it('dry-run lists without deleting', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const orphan = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await db.execute(drizzleSql`
      UPDATE pages SET created_at = now() - interval '60 days' WHERE id = ${orphan.id}
    `);

    const result = await runOrphanPurgeCli({ olderThanDays: 30, dryRun: true });
    expect(result.purgedCount).toBe(0);
    expect(result.candidates.map((c) => c.pageId)).toContain(orphan.id);
  });
});
