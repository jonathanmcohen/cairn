import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
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

beforeEach(async () => {
  await sql`TRUNCATE pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_tasks`;
});

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const W = '99999999-9999-9999-9999-999999999999';
const P = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Helper: escape a JS object for safe embedding as a Postgres jsonb literal.
// We do this rather than parameter binding because postgres.js binds jsonb
// parameters in a way that doesn't recurse through nested objects the way our
// extractor's recursive CTE expects.
function jsonbLit(o: unknown): string {
  return `'${JSON.stringify(o).replaceAll("'", "''")}'::jsonb`;
}

describe('mv_user_tasks', () => {
  it('extracts assigned + mentioned users from taskItem nodes', async () => {
    await sql.unsafe(`
      INSERT INTO users (id, email, password_hash, name) VALUES
        ('${U1}', 'a@x', 'h', 'a'),
        ('${U2}', 'b@x', 'h', 'b');
      INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'w', 'w');
      INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ('${W}', '${U1}', 'owner');
    `);
    const content = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: {
                blockId: 'b1',
                text: 'Buy milk',
                checked: false,
                assignedTo: U1,
                mentionedBy: U2,
                dueAt: '2026-06-01T00:00:00Z',
              },
            },
          ],
        },
      ],
    };
    await sql.unsafe(`
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by)
      VALUES ('${P}', '${W}', NULL, 'P', ${jsonbLit(content)}, '${U1}')
    `);
    const rows = await sql`SELECT * FROM mv_user_tasks ORDER BY user_id`;
    expect(rows.length).toBe(2);
    const u1Row = rows.find((r) => r.user_id === U1);
    expect(u1Row).toBeTruthy();
    expect(u1Row?.text).toBe('Buy milk');
    expect(u1Row?.checked).toBe(false);
    expect(u1Row?.due_at_iso).toBe('2026-06-01T00:00:00Z');
  });

  it('refreshes after pages.content UPDATE', async () => {
    await sql.unsafe(`
      INSERT INTO users (id, email, password_hash, name) VALUES ('${U1}', 'a@x', 'h', 'a');
      INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'w', 'w');
      INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ('${W}', '${U1}', 'owner');
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by)
      VALUES ('${P}', '${W}', NULL, 'P', '{"type":"doc","content":[]}'::jsonb, '${U1}');
    `);
    const initial = await sql`SELECT count(*) AS n FROM mv_user_tasks`;
    expect(Number(initial[0]?.n)).toBe(0);

    const updated = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: {
                blockId: 'b2',
                text: 'Later',
                checked: false,
                assignedTo: U1,
              },
            },
          ],
        },
      ],
    };
    await sql.unsafe(`
      UPDATE pages SET content = ${jsonbLit(updated)}
      WHERE id = '${P}'
    `);
    const after = await sql`SELECT count(*) AS n FROM mv_user_tasks`;
    expect(Number(after[0]?.n)).toBe(1);
  });

  it('excludes soft-deleted pages', async () => {
    await sql.unsafe(`
      INSERT INTO users (id, email, password_hash, name) VALUES ('${U1}', 'a@x', 'h', 'a');
      INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'w', 'w');
      INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ('${W}', '${U1}', 'owner');
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by, deleted_at)
      VALUES (
        '${P}', '${W}', NULL, 'P',
        '{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"blockId":"b","text":"x","checked":false,"assignedTo":"${U1}"}}]}]}'::jsonb,
        '${U1}', now()
      );
    `);
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_tasks`;
    const rows = await sql`SELECT count(*) AS n FROM mv_user_tasks`;
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('excludes encrypted pages', async () => {
    await sql.unsafe(`
      INSERT INTO users (id, email, password_hash, name) VALUES ('${U1}', 'a@x', 'h', 'a');
      INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'w', 'w');
      INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ('${W}', '${U1}', 'owner');
      INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by, encrypted)
      VALUES (
        '${P}', '${W}', NULL, 'P',
        '{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"blockId":"b","text":"secret","checked":false,"assignedTo":"${U1}"}}]}]}'::jsonb,
        '${U1}', true
      );
    `);
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_tasks`;
    const rows = await sql`SELECT count(*) AS n FROM mv_user_tasks`;
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
