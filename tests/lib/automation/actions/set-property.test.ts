import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { BadConfigError } from '@/lib/automation/actions';
import { runSetProperty } from '@/lib/automation/actions/set-property';
import { startPostgres, stopPostgres } from '../../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;
let userId: string;
let databaseId: string;
let propertyId: string;
let rowId: string;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE db_cells, db_rows, db_properties, databases, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'a@b.c', passwordHash: 'h', name: 'A' })
    .returning();
  if (!u) throw new Error('user insert failed');
  userId = u.id;
  const [w] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!w) throw new Error('workspace insert failed');
  workspaceId = w.id;
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', content: { type: 'doc', content: [] }, createdBy: userId })
    .returning();
  if (!page) throw new Error('page insert failed');
  const [d] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, name: 'D', createdBy: userId })
    .returning();
  if (!d) throw new Error('database insert failed');
  databaseId = d.id;
  const [p] = await db
    .insert(schema.dbProperties)
    .values({ databaseId, name: 'Status', type: 'text', position: 0 })
    .returning();
  if (!p) throw new Error('property insert failed');
  propertyId = p.id;
  const [r] = await db.insert(schema.dbRows).values({ databaseId, createdBy: userId }).returning();
  if (!r) throw new Error('row insert failed');
  rowId = r.id;
});

describe('runSetProperty', () => {
  it('writes a db_cell for the configured property', async () => {
    await runSetProperty(
      { databaseId, propertyId, rowId, value: 'Done' },
      { row: { id: rowId } },
      { ruleId: 'rule-1', workspaceId, createdBy: userId },
    );
    const cells = await db
      .select()
      .from(schema.dbCells)
      .where(and(eq(schema.dbCells.rowId, rowId), eq(schema.dbCells.propertyId, propertyId)));
    expect(cells).toHaveLength(1);
    expect(cells[0]?.value).toBe('Done');
  });

  it('falls back to payload.row.id when action_config.rowId is missing', async () => {
    await runSetProperty(
      { databaseId, propertyId, value: 'FromPayload' },
      { row: { id: rowId } },
      { ruleId: 'rule-1', workspaceId, createdBy: userId },
    );
    const cells = await db
      .select()
      .from(schema.dbCells)
      .where(and(eq(schema.dbCells.rowId, rowId), eq(schema.dbCells.propertyId, propertyId)));
    expect(cells[0]?.value).toBe('FromPayload');
  });

  it('throws BadConfigError when databaseId/propertyId/value missing', async () => {
    await expect(
      runSetProperty({}, { row: { id: rowId } }, { ruleId: 'r', workspaceId, createdBy: userId }),
    ).rejects.toThrow(BadConfigError);
  });

  it('throws when row id cannot be resolved', async () => {
    await expect(
      runSetProperty(
        { databaseId, propertyId, value: 'x' },
        {},
        { ruleId: 'r', workspaceId, createdBy: userId },
      ),
    ).rejects.toThrow(BadConfigError);
  });
});
