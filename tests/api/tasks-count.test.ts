import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE page_acls, pages, audit_log, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
  // TRUNCATE doesn't fire the statement-level refresh trigger that page
  // INSERT/UPDATE/DELETE do — clear the materialized view by hand.
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_tasks`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function call() {
  const { GET } = await import('@/app/api/tasks/count/route');
  const res = await GET(new Request('http://localhost/api/tasks/count'));
  return { status: res.status, body: await res.json() };
}

function jsonbLit(o: unknown): string {
  return `'${JSON.stringify(o).replaceAll("'", "''")}'::jsonb`;
}

function taskListContent(
  items: Array<{ blockId: string; text: string; checked: boolean; assignedTo: string }>,
): unknown {
  return {
    type: 'doc',
    content: [{ type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: i })) }],
  };
}

async function seedTaskPage(input: {
  workspaceId: string;
  createdBy: string;
  items: Array<{ blockId: string; text: string; checked: boolean; assignedTo: string }>;
}) {
  await sql.unsafe(`
    INSERT INTO pages (workspace_id, parent_id, title, content, created_by)
    VALUES ('${input.workspaceId}', NULL, 'Tasks', ${jsonbLit(taskListContent(input.items))}, '${input.createdBy}')
  `);
}

describe('GET /api/tasks/count', () => {
  it('401 unauthenticated', async () => {
    await setUser(null);
    const r = await call();
    expect(r.status).toBe(401);
  });

  it('returns the caller’s OPEN task count (done tasks excluded)', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await seedTaskPage({
      workspaceId: me.workspaceId,
      createdBy: me.userId,
      items: [
        { blockId: 'b1', text: 'open-1', checked: false, assignedTo: me.userId },
        { blockId: 'b2', text: 'open-2', checked: false, assignedTo: me.userId },
        { blockId: 'b3', text: 'done', checked: true, assignedTo: me.userId },
      ],
    });
    await setUser(me.userId);

    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ count: 2 });
  });

  it('isolates other users and unreadable workspaces', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    // My open task in my workspace.
    await seedTaskPage({
      workspaceId: me.workspaceId,
      createdBy: me.userId,
      items: [{ blockId: 'b1', text: 'mine', checked: false, assignedTo: me.userId }],
    });
    // Another user's task in my workspace → not mine, not counted.
    await seedTaskPage({
      workspaceId: me.workspaceId,
      createdBy: me.userId,
      items: [{ blockId: 'b2', text: 'theirs', checked: false, assignedTo: other.userId }],
    });
    // Assigned to me, but on a page in a workspace I cannot read → not counted.
    await seedTaskPage({
      workspaceId: other.workspaceId,
      createdBy: other.userId,
      items: [{ blockId: 'b3', text: 'secret', checked: false, assignedTo: me.userId }],
    });
    await setUser(me.userId);

    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ count: 1 });
  });

  it('returns 0 when the caller has no open tasks', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ count: 0 });
  });
});
