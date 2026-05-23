import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createReverseRelationProperty } from '@/lib/databases/relations';
import { createRow, updateCells } from '@/lib/databases/rows';
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
  await sql`TRUNCATE db_cells, db_rows, db_properties, db_views, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeDatabase(workspaceId: string, createdBy: string, name: string) {
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: name, createdBy })
    .returning();
  if (!page) throw new Error('page insert failed');
  const [d] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, createdBy, name })
    .returning();
  if (!d) throw new Error('database insert failed');
  return d;
}

async function paired() {
  const u = await createTestWorkspaceWithUser(db);
  const dbA = await makeDatabase(u.workspaceId, u.userId, 'A');
  const dbB = await makeDatabase(u.workspaceId, u.userId, 'B');
  const [fwd] = await db
    .insert(schema.dbProperties)
    .values({
      databaseId: dbA.id,
      name: 'B',
      type: 'relation',
      position: 0,
      config: { targetDatabaseId: dbB.id },
    })
    .returning();
  const rev = await db.transaction((tx) =>
    createReverseRelationProperty(tx, { sourcePropertyId: fwd!.id, reverseName: 'A' }),
  );
  const [b1] = await db
    .insert(schema.dbRows)
    .values({ databaseId: dbB.id, createdBy: u.userId })
    .returning();
  return { u, dbA, dbB, fwd: fwd!, rev, b1: b1! };
}

async function relCell(rowId: string, propId: string): Promise<string[]> {
  const [c] = await db
    .select({ value: schema.dbCells.value })
    .from(schema.dbCells)
    .where(and(eq(schema.dbCells.rowId, rowId), eq(schema.dbCells.propertyId, propId)));
  return Array.isArray(c?.value) ? (c!.value as string[]) : [];
}

describe('createRow + reverse relations', () => {
  it('mirrors a relation cell set at row creation', async () => {
    const f = await paired();
    const row = await createRow(db, {
      databaseId: f.dbA.id,
      workspaceId: f.u.workspaceId,
      createdBy: f.u.userId,
      cells: { [f.fwd.id]: [f.b1.id] },
    });
    // forward cell stored
    expect(await relCell(row.id, f.fwd.id)).toEqual([f.b1.id]);
    // reverse mirrored
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([row.id]);
  });

  it('does not mirror a plain relation at creation', async () => {
    const f = await paired();
    const [plain] = await db
      .insert(schema.dbProperties)
      .values({
        databaseId: f.dbA.id,
        name: 'Plain',
        type: 'relation',
        position: 5,
        config: { targetDatabaseId: f.dbB.id },
      })
      .returning();
    const row = await createRow(db, {
      databaseId: f.dbA.id,
      workspaceId: f.u.workspaceId,
      createdBy: f.u.userId,
      cells: { [plain!.id]: [f.b1.id] },
    });
    expect(await relCell(row.id, plain!.id)).toEqual([f.b1.id]);
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([]); // untouched
  });
});

describe('updateCells + reverse relations', () => {
  it('mirrors an add on update', async () => {
    const f = await paired();
    const row = await createRow(db, {
      databaseId: f.dbA.id,
      workspaceId: f.u.workspaceId,
      createdBy: f.u.userId,
    });
    await updateCells(db, {
      rowId: row.id,
      databaseId: f.dbA.id,
      workspaceId: f.u.workspaceId,
      cells: { [f.fwd.id]: [f.b1.id] },
    });
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([row.id]);
  });

  it('mirrors a remove on update (clearing the cell)', async () => {
    const f = await paired();
    const row = await createRow(db, {
      databaseId: f.dbA.id,
      workspaceId: f.u.workspaceId,
      createdBy: f.u.userId,
      cells: { [f.fwd.id]: [f.b1.id] },
    });
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([row.id]); // precondition
    await updateCells(db, {
      rowId: row.id,
      databaseId: f.dbA.id,
      workspaceId: f.u.workspaceId,
      cells: { [f.fwd.id]: [] },
    });
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([]);
  });

  it('editing the reverse side mirrors back to the forward side', async () => {
    const f = await paired();
    const row = await createRow(db, {
      databaseId: f.dbA.id,
      workspaceId: f.u.workspaceId,
      createdBy: f.u.userId,
    });
    // edit b1.rev to point at row -> row.fwd should gain b1
    await updateCells(db, {
      rowId: f.b1.id,
      databaseId: f.dbB.id,
      workspaceId: f.u.workspaceId,
      cells: { [f.rev.id]: [row.id] },
    });
    expect(await relCell(row.id, f.fwd.id)).toEqual([f.b1.id]);
  });
});
