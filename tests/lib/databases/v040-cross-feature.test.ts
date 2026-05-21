import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createProperty } from '@/lib/databases/properties';
import { archiveRow, createRow, listRows } from '@/lib/databases/rows';
import { createView } from '@/lib/databases/views';
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

async function makeDb(workspaceId: string, userId: string) {
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!page) throw new Error('page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, createdBy: userId })
    .returning();
  if (!database) throw new Error('db');
  return database.id;
}

describe('v0.4.0 cross-feature: formula + relation + rollup + calendar in one database', () => {
  it('computes formula + rollup, resolves relation labels (dropping a dangling id), and accepts calendar/timeline views', async () => {
    const u = await createTestWorkspaceWithUser(db);

    // --- Target ("Tasks") database: a text Title (the relation label) + a numeric Estimate.
    const tasks = await makeDb(u.workspaceId, u.userId);
    const taskTitle = await createProperty(db, {
      databaseId: tasks,
      workspaceId: u.workspaceId,
      name: 'Title',
      type: 'text',
    });
    const estimate = await createProperty(db, {
      databaseId: tasks,
      workspaceId: u.workspaceId,
      name: 'Estimate',
      type: 'number',
    });
    const t1 = await createRow(db, {
      databaseId: tasks,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [taskTitle.id]: 'Design', [estimate.id]: 2 },
    });
    const t2 = await createRow(db, {
      databaseId: tasks,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [taskTitle.id]: 'Build', [estimate.id]: 3 },
    });
    // A third live task that we relate, then archive — to prove read-time dangling filtering.
    const t3 = await createRow(db, {
      databaseId: tasks,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [taskTitle.id]: 'Ship', [estimate.id]: 5 },
    });

    // --- Primary ("Projects") database: number + formula + relation + rollup + date.
    const projects = await makeDb(u.workspaceId, u.userId);
    const budget = await createProperty(db, {
      databaseId: projects,
      workspaceId: u.workspaceId,
      name: 'Budget',
      type: 'number',
    });
    // Formula references the sibling property BY NAME ("Budget").
    const doubleBudget = await createProperty(db, {
      databaseId: projects,
      workspaceId: u.workspaceId,
      name: 'DoubleBudget',
      type: 'formula',
      config: { expression: 'Budget * 2' },
    });
    const relatedTasks = await createProperty(db, {
      databaseId: projects,
      workspaceId: u.workspaceId,
      name: 'RelatedTasks',
      type: 'relation',
      config: { targetDatabaseId: tasks },
    });
    const totalEstimate = await createProperty(db, {
      databaseId: projects,
      workspaceId: u.workspaceId,
      name: 'TotalEstimate',
      type: 'rollup',
      config: { relationPropertyId: relatedTasks.id, targetPropertyId: estimate.id, fn: 'sum' },
    });
    const due = await createProperty(db, {
      databaseId: projects,
      workspaceId: u.workspaceId,
      name: 'Due',
      type: 'date',
    });

    // --- One project row that relates ALL THREE live tasks (relation writes validate liveness,
    //     so we cannot store a bogus id directly — instead we archive t3 below to create a
    //     dangling reference that read-time resolution must drop).
    const p1 = await createRow(db, {
      databaseId: projects,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: {
        [budget.id]: 100,
        [due.id]: '2026-06-15',
        [relatedTasks.id]: [t1.id, t2.id, t3.id],
      },
    });

    // Archive t3: its id is now dangling in p1's relation cell (the stored value still lists it).
    await archiveRow(db, { rowId: t3.id, databaseId: tasks, workspaceId: u.workspaceId });

    // --- Calendar + timeline views on the date property are accepted (and validated).
    const cal = await createView(db, {
      databaseId: projects,
      workspaceId: u.workspaceId,
      type: 'calendar',
      name: 'Calendar',
      config: { dateProperty: due.id },
    });
    const tl = await createView(db, {
      databaseId: projects,
      workspaceId: u.workspaceId,
      type: 'timeline',
      name: 'Timeline',
      config: { dateProperty: due.id },
    });
    expect(cal.type).toBe('calendar');
    expect((cal.config as { dateProperty?: string }).dateProperty).toBe(due.id);
    expect(tl.type).toBe('timeline');

    // A calendar/timeline view still requires the date property in config (validated).
    await expect(
      createView(db, {
        databaseId: projects,
        workspaceId: u.workspaceId,
        type: 'calendar',
        name: 'BadCalendar',
        config: {},
      }),
    ).rejects.toThrow(/calendar view requires/i);

    // --- listRows runs relations -> rollups -> formulas post-fetch passes.
    const rows = await listRows(db, { databaseId: projects, workspaceId: u.workspaceId });
    const row = rows.find((r) => r.row.id === p1.id);
    if (!row) throw new Error('project row not found');

    // Formula computed from a sibling cell: Budget(100) * 2 = 200.
    expect(row.cells[doubleBudget.id]).toBe(200);

    // Rollup aggregates only the two LIVE related tasks (2 + 3); the archived t3 is excluded.
    expect(row.cells[totalEstimate.id]).toBe(5);

    // Relation resolves to { ids, labels } for live rows only; the dangling t3 id is dropped.
    const rel = row.cells[relatedTasks.id] as { ids: string[]; labels: string[] };
    expect(rel.ids).toEqual([t1.id, t2.id]);
    expect(rel.labels).toEqual(['Design', 'Build']);
    expect(rel.ids).toHaveLength(2);

    // The date cell is untouched (ISO-normalized), available for the calendar view to place.
    expect(String(row.cells[due.id])).toMatch(/^2026-06-15/);
  });
});
