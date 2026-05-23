import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listRows } from '@/lib/databases/rows';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, databases, db_properties, db_rows, db_cells, db_views RESTART IDENTITY CASCADE`;
});

async function seed() {
  const u = await createTestWorkspaceWithUser(db);
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
    .returning();
  if (!page) throw new Error('page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId: u.workspaceId, pageId: page.id, createdBy: u.userId })
    .returning();
  if (!database) throw new Error('db');
  const mkProp = async (
    name: string,
    type: schema.PropertyType,
    pos: number,
    config: unknown = {},
  ) => {
    const [p] = await db
      .insert(schema.dbProperties)
      .values({ databaseId: database.id, name, type, position: pos, config })
      .returning();
    if (!p) throw new Error(name);
    return p;
  };
  const title = await mkProp('Title', 'text', 0);
  const num = await mkProp('Num', 'number', 1);
  const due = await mkProp('Due', 'date', 2);
  const stat = await mkProp('Status', 'select', 3, {
    options: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
  });
  const done = await mkProp('Done', 'checkbox', 4);

  const mkRow = async (cells: Record<string, unknown>) => {
    const [r] = await db
      .insert(schema.dbRows)
      .values({ databaseId: database.id, createdBy: u.userId })
      .returning();
    if (!r) throw new Error('row');
    const vals = Object.entries(cells).map(([propertyId, value]) => ({
      rowId: r.id,
      propertyId,
      value,
    }));
    if (vals.length > 0) await db.insert(schema.dbCells).values(vals);
    return r.id;
  };

  const r1 = await mkRow({
    [title.id]: 'Apple pie',
    [num.id]: 5,
    [due.id]: '2026-05-10',
    [stat.id]: 'a',
    [done.id]: true,
  });
  const r2 = await mkRow({
    [title.id]: 'Banana bread',
    [num.id]: 15,
    [due.id]: '2026-05-20',
    [stat.id]: 'b',
    [done.id]: false,
  });
  const r3 = await mkRow({
    [title.id]: 'Cherry cake',
    [num.id]: 25,
    [due.id]: '2026-05-30',
    [stat.id]: 'c',
    // no checkbox cell (treated as false)
  });

  return {
    db,
    ...u,
    databaseId: database.id,
    props: { title, num, due, stat, done },
    ids: { r1, r2, r3 },
  };
}

async function filterIds(
  s: Awaited<ReturnType<typeof seed>>,
  filters: { propertyId: string; op: string; value: unknown }[],
): Promise<string[]> {
  const rows = await listRows(s.db, {
    databaseId: s.databaseId,
    workspaceId: s.workspaceId,
    filters,
  });
  return rows.map((r) => r.row.id).sort();
}

describe('text operators', () => {
  it('contains', async () => {
    const s = await seed();
    expect(
      await filterIds(s, [{ propertyId: s.props.title.id, op: 'contains', value: 'an' }]),
    ).toEqual([s.ids.r2].sort());
  });
  it('starts_with', async () => {
    const s = await seed();
    expect(
      await filterIds(s, [{ propertyId: s.props.title.id, op: 'starts_with', value: 'Ch' }]),
    ).toEqual([s.ids.r3].sort());
  });
  it('ends_with', async () => {
    const s = await seed();
    expect(
      await filterIds(s, [{ propertyId: s.props.title.id, op: 'ends_with', value: 'pie' }]),
    ).toEqual([s.ids.r1].sort());
  });
  it('is_empty', async () => {
    const s = await seed();
    expect(
      await filterIds(s, [{ propertyId: s.props.title.id, op: 'is_empty', value: null }]),
    ).toEqual([]);
  });
});

describe('number operators', () => {
  it('between (inclusive)', async () => {
    const s = await seed();
    expect(
      await filterIds(s, [{ propertyId: s.props.num.id, op: 'between', value: [5, 15] }]),
    ).toEqual([s.ids.r1, s.ids.r2].sort());
  });
  it('neq', async () => {
    const s = await seed();
    expect(await filterIds(s, [{ propertyId: s.props.num.id, op: 'neq', value: 15 }])).toEqual(
      [s.ids.r1, s.ids.r3].sort(),
    );
  });
  it('lte', async () => {
    const s = await seed();
    expect(await filterIds(s, [{ propertyId: s.props.num.id, op: 'lte', value: 15 }])).toEqual(
      [s.ids.r1, s.ids.r2].sort(),
    );
  });
});

describe('date operators', () => {
  it('between (inclusive)', async () => {
    const s = await seed();
    expect(
      await filterIds(s, [
        { propertyId: s.props.due.id, op: 'between', value: ['2026-05-15', '2026-05-31'] },
      ]),
    ).toEqual([s.ids.r2, s.ids.r3].sort());
  });
  it('neq', async () => {
    const s = await seed();
    expect(
      await filterIds(s, [{ propertyId: s.props.due.id, op: 'neq', value: '2026-05-20' }]),
    ).toEqual([s.ids.r1, s.ids.r3].sort());
  });
});

describe('select operators', () => {
  it('is', async () => {
    const s = await seed();
    expect(await filterIds(s, [{ propertyId: s.props.stat.id, op: 'is', value: 'b' }])).toEqual(
      [s.ids.r2].sort(),
    );
  });
  it('is_not', async () => {
    const s = await seed();
    expect(await filterIds(s, [{ propertyId: s.props.stat.id, op: 'is_not', value: 'b' }])).toEqual(
      [s.ids.r1, s.ids.r3].sort(),
    );
  });
  it('is_any_of', async () => {
    const s = await seed();
    expect(
      await filterIds(s, [{ propertyId: s.props.stat.id, op: 'is_any_of', value: ['a', 'c'] }]),
    ).toEqual([s.ids.r1, s.ids.r3].sort());
  });
});

describe('checkbox operators', () => {
  it('is true', async () => {
    const s = await seed();
    expect(await filterIds(s, [{ propertyId: s.props.done.id, op: 'is', value: true }])).toEqual(
      [s.ids.r1].sort(),
    );
  });
  it('is false (includes missing cell)', async () => {
    const s = await seed();
    expect(await filterIds(s, [{ propertyId: s.props.done.id, op: 'is', value: false }])).toEqual(
      [s.ids.r2, s.ids.r3].sort(),
    );
  });
});
