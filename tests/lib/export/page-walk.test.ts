import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { getDb } from '@/db/client';
import { walkWorkspacePages } from '@/lib/export/page-walk';
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

const U = '11111111-1111-1111-1111-111111111110';
const W = '99999999-9999-9999-9999-999999999990';
const P_ROOT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const P_C1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const P_GC = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
const P_C2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';

beforeEach(async () => {
  await sql`TRUNCATE audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name) VALUES ('${U}', 'a@x', 'h', 'a');
    INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'w', 'w-${Date.now()}');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W}', '${U}', 'owner');
    -- Root @ T+0, Child1 @ T+1, Grandchild @ T+2, Child2 @ T+3 — created_at
    -- governs sibling order. Two roots' pages are seeded with explicit
    -- timestamps to keep ordering deterministic.
    INSERT INTO pages (id, workspace_id, parent_id, title, content, created_by, created_at) VALUES
      ('${P_ROOT}', '${W}', NULL,      'Root',       '{}'::jsonb, '${U}', '2026-01-01 00:00:00+00'),
      ('${P_C1}',   '${W}', '${P_ROOT}','Child1',     '{}'::jsonb, '${U}', '2026-01-01 00:00:01+00'),
      ('${P_GC}',   '${W}', '${P_C1}',  'Grandchild', '{}'::jsonb, '${U}', '2026-01-01 00:00:02+00'),
      ('${P_C2}',   '${W}', '${P_ROOT}','Child2',     '{}'::jsonb, '${U}', '2026-01-01 00:00:03+00');
  `);
});

describe('walkWorkspacePages', () => {
  it('returns pages in depth-first pre-order with depth annotated', async () => {
    const rows = await walkWorkspacePages(getDb(), W);
    expect(rows.map((r) => r.title)).toEqual(['Root', 'Child1', 'Grandchild', 'Child2']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
    expect(rows[1]?.parentId).toBe(P_ROOT);
  });

  it('skips soft-deleted pages', async () => {
    await sql`UPDATE pages SET deleted_at = now() WHERE id = ${P_GC}`;
    const rows = await walkWorkspacePages(getDb(), W);
    expect(rows.map((r) => r.title)).toEqual(['Root', 'Child1', 'Child2']);
  });
});
