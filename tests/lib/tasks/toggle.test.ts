import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { toggleTaskCheck } from '@/lib/tasks/toggle';
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

const U = '11111111-1111-1111-1111-111111111111';
const W = '99999999-9999-9999-9999-999999999999';
const P = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(async () => {
  await sql`TRUNCATE audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_tasks`;
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name) VALUES ('${U}', 'a@x', 'h', 'a');
    INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'w', 'w');
    INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ('${W}', '${U}', 'owner');
    INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by) VALUES (
      '${P}', '${W}', NULL, 'P',
      '{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"blockId":"b1","text":"x","checked":false,"assignedTo":"${U}"}}]}]}'::jsonb,
      '${U}'
    );
  `);
});

describe('toggleTaskCheck', () => {
  it('flips false → true → false', async () => {
    const r1 = await toggleTaskCheck({ pageId: P, blockId: 'b1', userId: U });
    expect(r1.checked).toBe(true);
    const r2 = await toggleTaskCheck({ pageId: P, blockId: 'b1', userId: U });
    expect(r2.checked).toBe(false);
  });

  it('throws on unknown blockId', async () => {
    await expect(
      toggleTaskCheck({ pageId: P, blockId: 'nope', userId: U }),
    ).rejects.toThrow(/not found/);
  });

  it('throws on encrypted page', async () => {
    await sql`UPDATE pages SET encrypted = true WHERE id = ${P}`;
    await expect(
      toggleTaskCheck({ pageId: P, blockId: 'b1', userId: U }),
    ).rejects.toThrow(/encrypted/);
  });

  it('writes an audit record', async () => {
    await toggleTaskCheck({ pageId: P, blockId: 'b1', userId: U });
    const audit = await sql`SELECT action, metadata FROM audit_log WHERE target_id = ${P}`;
    expect(audit[0]?.action).toBe('task.toggled');
    expect(audit[0]?.metadata).toEqual({ blockId: 'b1', checked: true });
  });
});
