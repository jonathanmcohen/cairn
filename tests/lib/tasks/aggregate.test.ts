import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { listMyTasks } from '@/lib/tasks/aggregate';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const W1 = '99999999-9999-9999-9999-999999999999';
const W2 = '88888888-8888-8888-8888-888888888888';
const P1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeEach(async () => {
  await sql`TRUNCATE page_acls, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_tasks`;
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name) VALUES
      ('${U1}', 'a@x', 'h', 'a'),
      ('${U2}', 'b@x', 'h', 'b');
    INSERT INTO workspaces (id, name, slug) VALUES
      ('${W1}', 'w1', 'w1'),
      ('${W2}', 'w2', 'w2');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
      ('${W1}', '${U1}', 'owner'),
      ('${W2}', '${U2}', 'owner');
  `);
});

function jsonbLit(o: unknown): string {
  return `'${JSON.stringify(o).replaceAll("'", "''")}'::jsonb`;
}

function taskListContent(
  items: Array<{
    blockId: string;
    text: string;
    checked: boolean;
    assignedTo: string;
    dueAt?: string;
  }>,
): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: items.map((i) => ({ type: 'taskItem', attrs: i })),
      },
    ],
  };
}

describe('listMyTasks', () => {
  it('returns tasks for the requested user only', async () => {
    await sql.unsafe(`
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by) VALUES
        ('${P1}', '${W1}', NULL, 'P1', ${jsonbLit(
          taskListContent([
            { blockId: 'b1', text: 'mine', checked: false, assignedTo: U1 },
            { blockId: 'b2', text: 'theirs', checked: false, assignedTo: U2 },
          ]),
        )}, '${U1}');
    `);
    const tasks = await listMyTasks(U1, {});
    expect(tasks.map((t) => t.text)).toEqual(['mine']);
  });

  it('filters by workspaceId', async () => {
    await sql.unsafe(`
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by) VALUES
        ('${P1}', '${W1}', NULL, 'P1', ${jsonbLit(
          taskListContent([{ blockId: 'b1', text: 'w1-task', checked: false, assignedTo: U1 }]),
        )}, '${U1}'),
        ('${P2}', '${W2}', NULL, 'P2', ${jsonbLit(
          taskListContent([{ blockId: 'b2', text: 'w2-task', checked: false, assignedTo: U1 }]),
        )}, '${U2}');
      INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ('${W2}', '${U1}', 'viewer');
    `);
    const all = await listMyTasks(U1, {});
    expect(all.length).toBe(2);
    const filtered = await listMyTasks(U1, { workspaceId: W1 });
    expect(filtered.map((t) => t.text)).toEqual(['w1-task']);
  });

  it('filters by status=open / done / all', async () => {
    await sql.unsafe(`
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by) VALUES
        ('${P1}', '${W1}', NULL, 'P1', ${jsonbLit(
          taskListContent([
            { blockId: 'b1', text: 'open', checked: false, assignedTo: U1 },
            { blockId: 'b2', text: 'done', checked: true, assignedTo: U1 },
          ]),
        )}, '${U1}');
    `);
    expect((await listMyTasks(U1, { status: 'open' })).map((t) => t.text)).toEqual(['open']);
    expect((await listMyTasks(U1, { status: 'done' })).map((t) => t.text)).toEqual(['done']);
    expect((await listMyTasks(U1, { status: 'all' })).length).toBe(2);
  });

  it('filters by dueBy', async () => {
    await sql.unsafe(`
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by) VALUES
        ('${P1}', '${W1}', NULL, 'P1', ${jsonbLit(
          taskListContent([
            {
              blockId: 'b1',
              text: 'soon',
              checked: false,
              assignedTo: U1,
              dueAt: '2026-06-01T00:00:00Z',
            },
            {
              blockId: 'b2',
              text: 'later',
              checked: false,
              assignedTo: U1,
              dueAt: '2027-01-01T00:00:00Z',
            },
          ]),
        )}, '${U1}');
    `);
    const result = await listMyTasks(U1, { dueBy: new Date('2026-12-31T23:59:59Z') });
    expect(result.map((t) => t.text)).toEqual(['soon']);
  });

  it('refuses tasks on pages the user cannot read', async () => {
    await sql.unsafe(`
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by) VALUES
        ('${P2}', '${W2}', NULL, 'P2', ${jsonbLit(
          taskListContent([{ blockId: 'b1', text: 'secret', checked: false, assignedTo: U1 }]),
        )}, '${U2}');
    `);
    // U1 is NOT a member of W2 and has no page_acls. Should not see the task
    // even though assignedTo=U1.
    const tasks = await listMyTasks(U1, {});
    expect(tasks).toEqual([]);
  });

  it('honors page_acls grant when user is not a workspace member', async () => {
    await sql.unsafe(`
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by) VALUES
        ('${P2}', '${W2}', NULL, 'P2', ${jsonbLit(
          taskListContent([{ blockId: 'b1', text: 'shared', checked: false, assignedTo: U1 }]),
        )}, '${U2}');
      INSERT INTO page_acls (page_id, user_id, permission)
        VALUES ('${P2}', '${U1}', 'view');
    `);
    const tasks = await listMyTasks(U1, {});
    expect(tasks.map((t) => t.text)).toEqual(['shared']);
  });
});
