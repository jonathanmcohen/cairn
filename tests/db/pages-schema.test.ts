import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, invite_tokens, sessions, accounts RESTART IDENTITY CASCADE`;
});

describe('pages schema', () => {
  it('inserts a page with content jsonb and defaults', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'Hello',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        createdBy: u.userId,
      })
      .returning();
    if (!p) throw new Error('insert failed');
    expect(p.parentId).toBeNull();
    expect(p.deletedAt).toBeNull();
    expect(p.deletedRoot).toBe(false);
    expect(p.icon).toBeNull();
  });

  it('updates content_text and content_tsv via trigger on insert', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.pages).values({
      workspaceId: u.workspaceId,
      title: 'Meeting Notes',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Discuss roadmap' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Action items' }] },
        ],
      },
      createdBy: u.userId,
    });
    const [row] = await sql<{ content_text: string; tsv_count: number }[]>`
      SELECT content_text, length(content_tsv::text) AS tsv_count FROM pages LIMIT 1
    `;
    expect(row?.content_text).toContain('Discuss roadmap');
    expect(row?.content_text).toContain('Action items');
    expect(Number(row?.tsv_count)).toBeGreaterThan(0);
  });

  it('cascades parent → child on parent delete', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [parent] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'Parent', createdBy: u.userId })
      .returning();
    if (!parent) throw new Error('insert failed');
    await db.insert(schema.pages).values({
      workspaceId: u.workspaceId,
      title: 'Child',
      parentId: parent.id,
      createdBy: u.userId,
    });
    await db.delete(schema.pages).where(eq(schema.pages.id, parent.id));
    const rows = await db.select().from(schema.pages);
    expect(rows).toHaveLength(0);
  });
});
