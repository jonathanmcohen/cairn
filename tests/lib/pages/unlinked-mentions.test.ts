import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { findUnlinkedMentions } from '@/lib/pages/unlinked-mentions';
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
  await sql`TRUNCATE pages, page_links, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

async function makePage(workspaceId: string, userId: string, title: string, bodyText?: string) {
  const content = bodyText
    ? { type: 'doc', content: [para(bodyText)] }
    : { type: 'doc', content: [] };
  const [p] = await db
    .insert(schema.pages)
    .values({
      workspaceId,
      title,
      createdBy: userId,
      content: content as never,
      // The trigger normally maintains content_text, but the test inserts
      // directly — set it explicitly so the FTS column populates.
      contentText: bodyText ?? '',
    })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

describe('findUnlinkedMentions', () => {
  it('returns pages mentioning the target title and not already linked', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const target = await makePage(u.workspaceId, u.userId, 'Roadmap', 'High-level plan.');

    // a: mentions "Roadmap" in body, NOT linked → unlinked mention
    const a = await makePage(u.workspaceId, u.userId, 'Notes', 'See the Roadmap for details.');
    // b: mentions "Roadmap" AND has a page_links row to target → already linked, exclude
    const b = await makePage(u.workspaceId, u.userId, 'Plan', 'The Roadmap is our north star.');
    await db.insert(schema.pageLinks).values({
      sourcePageId: b.id,
      targetPageId: target.id,
      kind: 'link',
    });
    // c: doesn't mention Roadmap → not in result
    await makePage(u.workspaceId, u.userId, 'Other', 'Unrelated content.');

    const result = await findUnlinkedMentions(db, {
      pageId: target.id,
      workspaceId: u.workspaceId,
    });
    expect(result.map((p) => p.id)).toEqual([a.id]);
    expect(result[0]).toMatchObject({ id: a.id, title: 'Notes' });
    expect(typeof result[0]?.snippet).toBe('string');
  });

  it('excludes the target page itself even if its own body contains its title', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const target = await makePage(u.workspaceId, u.userId, 'Roadmap', 'This is the Roadmap.');
    const result = await findUnlinkedMentions(db, {
      pageId: target.id,
      workspaceId: u.workspaceId,
    });
    expect(result.map((p) => p.id)).not.toContain(target.id);
  });

  it('is workspace-scoped — other workspaces are never searched', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const target = await makePage(a.workspaceId, a.userId, 'Roadmap', '.');
    await makePage(b.workspaceId, b.userId, 'BNotes', 'See the Roadmap for details.');
    const result = await findUnlinkedMentions(db, {
      pageId: target.id,
      workspaceId: a.workspaceId,
    });
    expect(result).toHaveLength(0);
  });

  it('excludes soft-deleted pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const target = await makePage(u.workspaceId, u.userId, 'Roadmap', '.');
    const deleted = await makePage(u.workspaceId, u.userId, 'Old', 'See the Roadmap.');
    await sql`UPDATE pages SET deleted_at = NOW() WHERE id = ${deleted.id}`;
    const result = await findUnlinkedMentions(db, {
      pageId: target.id,
      workspaceId: u.workspaceId,
    });
    expect(result.map((p) => p.id)).not.toContain(deleted.id);
  });

  it('clamps the result count (<= 20) to keep the panel snappy', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const target = await makePage(u.workspaceId, u.userId, 'Roadmap', '.');
    for (let i = 0; i < 25; i++) {
      await makePage(u.workspaceId, u.userId, `P${i}`, 'A Roadmap reference here.');
    }
    const result = await findUnlinkedMentions(db, {
      pageId: target.id,
      workspaceId: u.workspaceId,
    });
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('returns [] for an empty/whitespace title', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const target = await makePage(u.workspaceId, u.userId, '   ', '.');
    const result = await findUnlinkedMentions(db, {
      pageId: target.id,
      workspaceId: u.workspaceId,
    });
    expect(result).toEqual([]);
  });
});
