// @vitest-environment node
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { auditLog } from '@/db/schema/audit-log';
import { databases } from '@/db/schema/databases';
import { pages } from '@/db/schema/pages';
import { users } from '@/db/schema/users';
import { workspaces } from '@/db/schema/workspaces';
import { enrichAuditEntries } from '@/lib/audit/enrich';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: PostgresJsDatabase<typeof schema>;

beforeAll(async () => {
  const uri = await startPostgres();
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE audit_log, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('enrichAuditEntries — actor resolution (#91)', () => {
  it('resolves actorUserId to users.name and null actor to null', async () => {
    const [ws] = await db.insert(workspaces).values({ name: 'WS', slug: 'ws' }).returning();
    if (!ws) throw new Error('workspace insert failed');
    const [ada] = await db
      .insert(users)
      .values({ email: 'ada@x.test', name: 'Ada Lovelace', passwordHash: 'x' })
      .returning();
    if (!ada) throw new Error('user insert failed');
    const rows = await db
      .insert(auditLog)
      .values([
        { workspaceId: ws.id, actorUserId: ada.id, action: 'page.published' },
        { workspaceId: ws.id, actorUserId: null, action: 'trash.purged_auto' },
      ])
      .returning();
    const enriched = await enrichAuditEntries(db, rows);
    const byId = new Map(enriched.map((e) => [e.id, e]));
    expect(byId.get(rows[0]?.id ?? '')?.actorName).toBe('Ada Lovelace');
    expect(byId.get(rows[1]?.id ?? '')?.actorName).toBeNull();
  });
});

describe('enrichAuditEntries — target resolution (#92)', () => {
  it('resolves page → title + href, database → name only, other → null', async () => {
    const [ws] = await db.insert(workspaces).values({ name: 'WS', slug: 'ws' }).returning();
    if (!ws) throw new Error('workspace insert failed');
    const [author] = await db
      .insert(users)
      .values({ email: 'author@x.test', name: 'Author', passwordHash: 'x' })
      .returning();
    if (!author) throw new Error('user insert failed');
    const [page] = await db
      .insert(pages)
      .values({ workspaceId: ws.id, title: 'Q3 Roadmap', createdBy: author.id })
      .returning();
    if (!page) throw new Error('page insert failed');
    const [dbRow0] = await db
      .insert(databases)
      .values({ workspaceId: ws.id, pageId: page.id, name: 'Bug Tracker', createdBy: author.id })
      .returning();
    if (!dbRow0) throw new Error('database insert failed');
    const rows = await db
      .insert(auditLog)
      .values([
        { workspaceId: ws.id, action: 'page.published', targetType: 'page', targetId: page.id },
        {
          workspaceId: ws.id,
          action: 'database.deleted',
          targetType: 'database',
          targetId: dbRow0.id,
        },
        {
          workspaceId: ws.id,
          action: 'workspace.settings_changed',
          targetType: 'workspace',
          targetId: ws.id,
        },
      ])
      .returning();
    const enriched = await enrichAuditEntries(db, rows);
    const byId = new Map(enriched.map((e) => [e.id, e]));
    const pageRow = rows[0];
    const dbRow = rows[1];
    const wsRow = rows[2];
    expect(byId.get(pageRow?.id ?? '')?.targetTitle).toBe('Q3 Roadmap');
    expect(byId.get(pageRow?.id ?? '')?.targetHref).toBe(`/pages/${page.id}`);
    expect(byId.get(dbRow?.id ?? '')?.targetTitle).toBe('Bug Tracker');
    expect(byId.get(dbRow?.id ?? '')?.targetHref).toBeNull(); // databases: title only
    expect(byId.get(wsRow?.id ?? '')?.targetTitle).toBeNull(); // unresolved type → fallback in UI
  });
});
