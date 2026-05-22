import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createReverseRelationProperty, syncRelationCells } from '@/lib/databases/relations';
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

/** Build two databases A,B with a paired relation A.fwd <-> B.rev, return ids + props. */
async function fixture() {
  const u = await createTestWorkspaceWithUser(db);
  const [pageA] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'A', createdBy: u.userId })
    .returning();
  const [pageB] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'B', createdBy: u.userId })
    .returning();
  const [dbA] = await db
    .insert(schema.databases)
    .values({ workspaceId: u.workspaceId, pageId: pageA!.id, createdBy: u.userId, name: 'A' })
    .returning();
  const [dbB] = await db
    .insert(schema.databases)
    .values({ workspaceId: u.workspaceId, pageId: pageB!.id, createdBy: u.userId, name: 'B' })
    .returning();
  const [fwd] = await db
    .insert(schema.dbProperties)
    .values({
      databaseId: dbA!.id,
      name: 'B',
      type: 'relation',
      position: 0,
      config: { targetDatabaseId: dbB!.id },
    })
    .returning();
  const rev = await db.transaction((tx) =>
    createReverseRelationProperty(tx, { sourcePropertyId: fwd!.id, reverseName: 'A' }),
  );
  // a row in A and two rows in B
  const [a1] = await db
    .insert(schema.dbRows)
    .values({ databaseId: dbA!.id, createdBy: u.userId })
    .returning();
  const [b1] = await db
    .insert(schema.dbRows)
    .values({ databaseId: dbB!.id, createdBy: u.userId })
    .returning();
  const [b2] = await db
    .insert(schema.dbRows)
    .values({ databaseId: dbB!.id, createdBy: u.userId })
    .returning();
  return { u, dbA: dbA!, dbB: dbB!, fwd: fwd!, rev, a1: a1!, b1: b1!, b2: b2! };
}

/** Read a relation cell's id array for (rowId, propId). */
async function relCell(rowId: string, propId: string): Promise<string[]> {
  const [c] = await db
    .select({ value: schema.dbCells.value })
    .from(schema.dbCells)
    .where(and(eq(schema.dbCells.rowId, rowId), eq(schema.dbCells.propertyId, propId)));
  return Array.isArray(c?.value) ? (c!.value as string[]) : [];
}

describe('syncRelationCells', () => {
  it('mirrors an ADD: A.fwd += b1  =>  b1.rev += a1', async () => {
    const f = await fixture();
    const props = await db
      .select()
      .from(schema.dbProperties)
      .where(inArray(schema.dbProperties.id, [f.fwd.id, f.rev.id]));
    await db.transaction((tx) =>
      syncRelationCells(tx, {
        rowId: f.a1.id,
        props,
        before: { [f.fwd.id]: [] },
        after: { [f.fwd.id]: [f.b1.id] },
      }),
    );
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([f.a1.id]);
  });

  it('mirrors a REMOVE: A.fwd -= b1  =>  b1.rev -= a1', async () => {
    const f = await fixture();
    const props = await db
      .select()
      .from(schema.dbProperties)
      .where(inArray(schema.dbProperties.id, [f.fwd.id, f.rev.id]));
    // seed: a1<->b1 already linked on both sides
    await db
      .insert(schema.dbCells)
      .values({ rowId: f.a1.id, propertyId: f.fwd.id, value: [f.b1.id] });
    await db
      .insert(schema.dbCells)
      .values({ rowId: f.b1.id, propertyId: f.rev.id, value: [f.a1.id] });
    await db.transaction((tx) =>
      syncRelationCells(tx, {
        rowId: f.a1.id,
        props,
        before: { [f.fwd.id]: [f.b1.id] },
        after: { [f.fwd.id]: [] },
      }),
    );
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([]);
  });

  it('handles add+remove in one write: swap b1 -> b2', async () => {
    const f = await fixture();
    const props = await db
      .select()
      .from(schema.dbProperties)
      .where(inArray(schema.dbProperties.id, [f.fwd.id, f.rev.id]));
    await db
      .insert(schema.dbCells)
      .values({ rowId: f.a1.id, propertyId: f.fwd.id, value: [f.b1.id] });
    await db
      .insert(schema.dbCells)
      .values({ rowId: f.b1.id, propertyId: f.rev.id, value: [f.a1.id] });
    await db.transaction((tx) =>
      syncRelationCells(tx, {
        rowId: f.a1.id,
        props,
        before: { [f.fwd.id]: [f.b1.id] },
        after: { [f.fwd.id]: [f.b2.id] },
      }),
    );
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([]); // removed
    expect(await relCell(f.b2.id, f.rev.id)).toEqual([f.a1.id]); // added
  });

  it('does NOT loop: an explicit reentrancy guard suppresses re-sync of the mirror write', async () => {
    const f = await fixture();
    const props = await db
      .select()
      .from(schema.dbProperties)
      .where(inArray(schema.dbProperties.id, [f.fwd.id, f.rev.id]));
    const guard = new Set<string>();
    await db.transaction((tx) =>
      syncRelationCells(tx, {
        rowId: f.a1.id,
        props,
        before: { [f.fwd.id]: [] },
        after: { [f.fwd.id]: [f.b1.id] },
        guard,
      }),
    );
    // the forward cell key is guarded so a nested sync would skip it; mirror applied exactly once
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([f.a1.id]);
    expect(guard.has(`${f.b1.id}:${f.rev.id}`)).toBe(true);
  });

  it('is a no-op for plain (unpaired) relations', async () => {
    const f = await fixture();
    // a plain relation on A (no reverse)
    const [plain] = await db
      .insert(schema.dbProperties)
      .values({
        databaseId: f.dbA.id,
        name: 'Plain',
        type: 'relation',
        position: 9,
        config: { targetDatabaseId: f.dbB.id },
      })
      .returning();
    await db.transaction((tx) =>
      syncRelationCells(tx, {
        rowId: f.a1.id,
        props: [plain!],
        before: { [plain!.id]: [] },
        after: { [plain!.id]: [f.b1.id] },
      }),
    );
    // no rev cell was touched
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([]);
  });

  it('appends without duplicating when the mirror already contains the row', async () => {
    const f = await fixture();
    const props = await db
      .select()
      .from(schema.dbProperties)
      .where(inArray(schema.dbProperties.id, [f.fwd.id, f.rev.id]));
    await db
      .insert(schema.dbCells)
      .values({ rowId: f.b1.id, propertyId: f.rev.id, value: [f.a1.id] });
    await db.transaction((tx) =>
      syncRelationCells(tx, {
        rowId: f.a1.id,
        props,
        before: { [f.fwd.id]: [] },
        after: { [f.fwd.id]: [f.b1.id] },
      }),
    );
    expect(await relCell(f.b1.id, f.rev.id)).toEqual([f.a1.id]); // not [a1, a1]
  });
});
