import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { findUnlinkedMentions, getBacklinks, reindexPageLinks } from '@/lib/pages/page-links';
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

async function makePage(workspaceId: string, userId: string, title: string, content?: unknown) {
  const [p] = await db
    .insert(schema.pages)
    .values({
      workspaceId,
      title,
      createdBy: userId,
      content: (content ?? { type: 'doc', content: [] }) as never,
    })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const link = (id: string) => ({ type: 'pageLink', attrs: { targetPageId: id, label: 'X' } });

describe('getBacklinks', () => {
  it('returns the pages that link to a target', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const target = await makePage(u.workspaceId, u.userId, 'Target');
    const src = await makePage(u.workspaceId, u.userId, 'Source');
    await db.transaction((tx) =>
      reindexPageLinks(tx, src.id, {
        type: 'doc',
        content: [{ type: 'paragraph', content: [link(target.id)] }],
      }),
    );
    const backlinks = await getBacklinks(db, target.id);
    expect(backlinks.map((b) => b.sourcePageId)).toEqual([src.id]);
    expect(backlinks[0]?.kind).toBe('link');
  });
});

describe('findUnlinkedMentions', () => {
  it('finds pages mentioning the title in text but not via a page-link node', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const target = await makePage(u.workspaceId, u.userId, 'Roadmap');
    // mentions the word "Roadmap" in prose, no pageLink node
    const mentioner = await makePage(u.workspaceId, u.userId, 'Notes', {
      type: 'doc',
      content: [para('see the Roadmap for details')],
    });
    // a page that DOES link is excluded from unlinked mentions
    const linker = await makePage(u.workspaceId, u.userId, 'Linker', {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [link(target.id), { type: 'text', text: 'Roadmap' }] },
      ],
    });
    await db.transaction((tx) =>
      reindexPageLinks(tx, linker.id, {
        type: 'doc',
        content: [{ type: 'paragraph', content: [link(target.id)] }],
      }),
    );

    const hits = await findUnlinkedMentions(db, {
      workspaceId: u.workspaceId,
      pageId: target.id,
      title: 'Roadmap',
    });
    const ids = hits.map((h) => h.id);
    expect(ids).toContain(mentioner.id);
    expect(ids).not.toContain(linker.id); // already linked
    expect(ids).not.toContain(target.id); // never self
  });

  it('returns [] for an empty/whitespace title', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const target = await makePage(u.workspaceId, u.userId, '   ');
    const hits = await findUnlinkedMentions(db, {
      workspaceId: u.workspaceId,
      pageId: target.id,
      title: '   ',
    });
    expect(hits).toEqual([]);
  });
});
