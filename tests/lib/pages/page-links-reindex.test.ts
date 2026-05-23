import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { extractPageLinks, reindexPageLinks } from '@/lib/pages/page-links';
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

async function makePage(workspaceId: string, userId: string, title: string) {
  const [page] = await db
    .insert(schema.pages)
    .values({
      workspaceId,
      title,
      createdBy: userId,
      content: { type: 'doc', content: [] } as never,
    })
    .returning();
  if (!page) throw new Error('page insert failed');
  return page;
}

const A = '11111111-1111-1111-1111-111111111111';
const C = '33333333-3333-3333-3333-333333333333';
function doc(...nodes: unknown[]) {
  return { type: 'doc', content: nodes };
}
const link = (id: string) => ({ type: 'pageLink', attrs: { targetPageId: id, label: 'X' } });
const mention = (id: string) => ({ type: 'pageMention', attrs: { targetPageId: id, label: 'X' } });
const embed = (id: string) => ({ type: 'pageEmbed', attrs: { targetPageId: id, label: 'X' } });

describe('extractPageLinks', () => {
  it('returns [] for a doc with no page-link nodes', () => {
    expect(
      extractPageLinks(doc({ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] })),
    ).toEqual([]);
  });
  it('extracts link/mention/embed targets and dedupes per (target, kind)', () => {
    const result = extractPageLinks(
      doc({ type: 'paragraph', content: [link(A), mention(C)] }, link(A), embed(A)),
    );
    expect(result).toEqual(
      expect.arrayContaining([
        { targetPageId: A, kind: 'link' },
        { targetPageId: C, kind: 'mention' },
        { targetPageId: A, kind: 'embed' },
      ]),
    );
    expect(result).toHaveLength(3);
  });
  it('ignores nodes with a missing/non-uuid targetPageId', () => {
    expect(
      extractPageLinks(
        doc(
          { type: 'pageLink', attrs: { label: 'no id' } },
          { type: 'pageLink', attrs: { targetPageId: 'nope' } },
        ),
      ),
    ).toEqual([]);
  });
});

describe('reindexPageLinks', () => {
  it('upserts index rows for a source page (delete-then-insert)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const src = await makePage(u.workspaceId, u.userId, 'Source');
    const t1 = await makePage(u.workspaceId, u.userId, 'Target 1');
    const t2 = await makePage(u.workspaceId, u.userId, 'Target 2');
    await db.transaction((tx) =>
      reindexPageLinks(
        tx,
        src.id,
        doc({ type: 'paragraph', content: [link(t1.id), mention(t2.id)] }),
      ),
    );
    const rows = await db
      .select()
      .from(schema.pageLinks)
      .where(eq(schema.pageLinks.sourcePageId, src.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.targetPageId}:${r.kind}`).sort()).toEqual(
      [`${t1.id}:link`, `${t2.id}:mention`].sort(),
    );
  });
  it('replaces prior rows on re-save (removed links disappear)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const src = await makePage(u.workspaceId, u.userId, 'Source');
    const t1 = await makePage(u.workspaceId, u.userId, 'T1');
    const t2 = await makePage(u.workspaceId, u.userId, 'T2');
    await db.transaction((tx) =>
      reindexPageLinks(tx, src.id, doc({ type: 'paragraph', content: [link(t1.id), link(t2.id)] })),
    );
    await db.transaction((tx) =>
      reindexPageLinks(tx, src.id, doc({ type: 'paragraph', content: [link(t2.id)] })),
    );
    const rows = await db
      .select()
      .from(schema.pageLinks)
      .where(eq(schema.pageLinks.sourcePageId, src.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetPageId).toBe(t2.id);
  });
  it('skips targets that no longer exist (FK-safe filtering)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const src = await makePage(u.workspaceId, u.userId, 'Source');
    const ghost = '99999999-9999-9999-9999-999999999999';
    await db.transaction((tx) =>
      reindexPageLinks(tx, src.id, doc({ type: 'paragraph', content: [link(ghost)] })),
    );
    const rows = await db
      .select()
      .from(schema.pageLinks)
      .where(eq(schema.pageLinks.sourcePageId, src.id));
    expect(rows).toHaveLength(0);
  });
});
