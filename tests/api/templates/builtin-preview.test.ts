import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { seedBuiltinTemplates } from '@/lib/templates/builtins';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

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
  await sql`TRUNCATE templates, pages, workspace_members, workspaces, users, audit_log, sessions, accounts RESTART IDENTITY CASCADE`;
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function call(id: string): Promise<{ status: number; body: unknown }> {
  const { GET } = await import('@/app/api/templates/[id]/route');
  const res = await GET(new Request(`http://localhost/api/templates/${id}`), {
    params: Promise.resolve({ id }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('GET /api/templates/[id] — built-in templates (#134)', () => {
  // REPRO TEST — expected RED before Task 3 fix.
  // This test mirrors what the live app does: seed via seedBuiltinTemplates
  // (no explicit visibility), then fetch the built-in as an authenticated viewer.
  // It MUST fail before the fix so we confirm the real failure mode.
  it('REPRO: seeding without explicit visibility and fetching a built-in → currently fails (not 200)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    // Seed exactly as startup does — no explicit visibility passed.
    await seedBuiltinTemplates(getDb());
    // Retrieve any seeded built-in id.
    const [builtin] = await getDb()
      .select({
        id: schema.templates.id,
        name: schema.templates.name,
        visibility: schema.templates.visibility,
      })
      .from(schema.templates)
      .where(eq(schema.templates.builtIn, true))
      .limit(1);
    if (!builtin) throw new Error('seedBuiltinTemplates produced no rows — seed failed');
    await setUser(u.userId);
    const r = await call(builtin.id);
    // Log the actual outcome so the implementer can see the real failure mode.
    console.log(
      `[REPRO] name=${builtin.name} visibility=${builtin.visibility} status=${r.status} body=${JSON.stringify(r.body)}`,
    );
    // This assertion will FAIL before the fix — the built-in currently cannot be previewed.
    // The test documents the symptom: the user sees "Could not load this preview" because
    // the fetch returns a non-2xx response.
    expect(
      r.status,
      `Built-in template "${builtin.name}" (visibility=${builtin.visibility}) should return 200 after fix`,
    ).toBe(200);
  });

  // GREEN CONTRACT: after the fix, a properly-seeded built-in (visibility='public')
  // is accessible to any authenticated viewer.
  it('a built-in seeded with visibility=public returns 200 + preview shape', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    // Seed a single built-in with the correct visibility (what the fix will produce).
    const [row] = await getDb()
      .insert(schema.templates)
      .values({
        name: 'Meeting notes',
        kind: 'page',
        workspaceId: null,
        builtIn: true,
        visibility: 'public',
        payload: {
          kind: 'page',
          rootPageId: 'mn-root',
          pages: [
            {
              id: 'mn-root',
              parentId: null,
              title: 'Meeting notes',
              icon: '📝',
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Attendees' }],
                  },
                ],
              },
            },
          ],
          databases: [],
        } as never,
      } as never)
      .returning({ id: schema.templates.id });
    if (!row) throw new Error('seed failed');
    await setUser(u.userId);
    const r = await call(row.id);
    expect(r.status).toBe(200);
    const body = r.body as { id: string; name: string; kind: string; blocks: unknown[] };
    expect(body.id).toBe(row.id);
    expect(body.name).toBe('Meeting notes');
    expect(body.kind).toBe('page');
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  // GUARD: workspace templates in a foreign workspace still 404 (ACL not relaxed).
  it('a workspace-visibility template in a foreign workspace is still 404', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [row] = await getDb()
      .insert(schema.templates)
      .values({
        name: 'Theirs',
        kind: 'page',
        workspaceId: owner.workspaceId,
        builtIn: false,
        visibility: 'workspace',
        payload: { kind: 'page', rootPageId: 'x', pages: [], databases: [] } as never,
      } as never)
      .returning({ id: schema.templates.id });
    if (!row) throw new Error('seed failed');
    const outsider = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser(outsider.userId);
    const r = await call(row.id);
    expect(r.status).toBe(404);
  });
});
