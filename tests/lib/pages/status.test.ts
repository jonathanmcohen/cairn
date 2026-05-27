import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { IllegalStatusTransition, transitionStatus } from '@/lib/pages/status';
import { startPostgres, stopPostgres } from '../../helpers/db';

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
  await sql`TRUNCATE audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seedPage(
  status: schema.PageStatus = 'published',
): Promise<{ userId: string; workspaceId: string; pageId: string }> {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `u-${Date.now()}-${Math.random()}@example.com`,
      name: 'U',
      passwordHash: 'x',
    })
    .returning({ id: schema.users.id });
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })
    .returning({ id: schema.workspaces.id });
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId: w!.id, title: 'P', status, createdBy: u!.id })
    .returning();
  return { userId: u!.id, workspaceId: w!.id, pageId: p!.id };
}

describe('transitionStatus — allowed-transition matrix', () => {
  const matrix: Array<[schema.PageStatus, schema.PageStatus, boolean]> = [
    ['draft', 'review', true],
    ['draft', 'archived', true],
    ['draft', 'published', false],
    ['review', 'draft', true],
    ['review', 'published', true],
    ['review', 'archived', false],
    ['published', 'review', true],
    ['published', 'archived', true],
    ['published', 'draft', false],
    ['archived', 'draft', true],
    ['archived', 'review', false],
    ['archived', 'published', false],
  ];

  for (const [from, to, allowed] of matrix) {
    it(`${from} → ${to}: ${allowed ? 'allowed' : 'refused'}`, async () => {
      const { userId, pageId } = await seedPage(from);
      if (allowed) {
        const out = await transitionStatus(db, { pageId, to, byUserId: userId });
        expect(out.status).toBe(to);
      } else {
        await expect(transitionStatus(db, { pageId, to, byUserId: userId })).rejects.toBeInstanceOf(
          IllegalStatusTransition,
        );
      }
    });
  }

  it('writes a page.status_changed audit row with {from, to} on success', async () => {
    const { userId, pageId, workspaceId } = await seedPage('draft');
    await transitionStatus(db, { pageId, to: 'review', byUserId: userId });
    const [rec] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, pageId));
    expect(rec!.action).toBe('page.status_changed');
    expect(rec!.metadata).toMatchObject({ from: 'draft', to: 'review' });
    expect(rec!.workspaceId).toBe(workspaceId);
  });

  it('no-op transition (same status) is treated as illegal', async () => {
    const { userId, pageId } = await seedPage('published');
    await expect(
      transitionStatus(db, { pageId, to: 'published', byUserId: userId }),
    ).rejects.toBeInstanceOf(IllegalStatusTransition);
  });

  it('throws on missing page', async () => {
    const { userId } = await seedPage();
    await expect(
      transitionStatus(db, {
        pageId: '00000000-0000-0000-0000-000000000000',
        to: 'review',
        byUserId: userId,
      }),
    ).rejects.toThrow();
  });
});
